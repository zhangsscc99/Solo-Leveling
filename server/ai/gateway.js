// OpenCode Go AI gateway: the only place in the server that talks to an LLM.
// CommonJS, no npm dependencies (global fetch from Node 24).
//
// generate(...) never throws and never resolves with anything but
// { ok: true, text, model, ms, sessionId } or { ok: false, error, code }.
// The API key is read at call time and is never logged or returned.

const crypto = require("crypto");

const MODEL = "deepseek-v4.1-flash";
const DEFAULT_BASE_URL = "https://opencode.ai/zen/go/v1";
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_TOKENS = 800;
const ERROR_BODY_LIMIT = 300;

function readKey() {
  const raw = process.env.OPENCODE_GO_API_KEY;
  if (typeof raw !== "string") return "";
  return raw.trim();
}

// Reads the env at call time so a key set after module load still counts.
function isConfigured() {
  return readKey().length > 0;
}

function baseUrl() {
  const raw = process.env.OPENCODE_GO_BASE_URL;
  const value = typeof raw === "string" ? raw.trim() : "";
  // Trailing slashes would produce "//chat/completions" on some proxies.
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function resolveSessionId(sessionId) {
  if (typeof sessionId === "string" && sessionId.trim()) return sessionId.trim();
  return crypto.randomUUID();
}

function numberOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fail(code, error, extra = {}) {
  return { ok: false, error, code, ...extra };
}

function extractText(payload) {
  const choice = payload && Array.isArray(payload.choices) ? payload.choices[0] : null;
  const content = choice && choice.message ? choice.message.content : null;
  if (typeof content === "string") return content;
  // Some gateways return content as an array of parts.
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => (part && typeof part.text === "string" ? part.text : ""))
      .join("")
      .trim();
    if (joined) return joined;
  }
  return "";
}

async function generate({
  messages = [],
  sessionId,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = DEFAULT_TEMPERATURE,
  maxTokens = DEFAULT_MAX_TOKENS,
  fetchImpl,
} = {}) {
  const sid = resolveSessionId(sessionId);
  const key = readKey();

  if (!key) {
    // No key: report it locally, never hit the network.
    console.warn(`[ai] skipped request (session ${sid}): no API key configured`);
    return fail("no-key", "OPENCODE_GO_API_KEY is not set", { sessionId: sid });
  }

  const doFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  if (typeof doFetch !== "function") {
    return fail("network", "global fetch is unavailable in this runtime", { sessionId: sid });
  }

  const timeout = numberOr(timeoutMs, DEFAULT_TIMEOUT_MS);
  const url = `${baseUrl()}/chat/completions`;
  const body = JSON.stringify({
    model: MODEL,
    messages: Array.isArray(messages) ? messages : [],
    temperature: Number.isFinite(Number(temperature)) ? Number(temperature) : DEFAULT_TEMPERATURE,
    max_tokens: numberOr(maxTokens, DEFAULT_MAX_TOKENS),
    stream: false,
  });

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);
  const startedAt = Date.now();

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "x-opencode-session": sid,
      },
      body,
      signal: controller.signal,
    });

    if (!res || !res.ok) {
      const status = res ? res.status : 0;
      let detail = "";
      try {
        const raw = await res.text();
        detail = String(raw || "").slice(0, ERROR_BODY_LIMIT);
      } catch {
        detail = "";
      }
      console.warn(`[ai] http ${status} (session ${sid})`);
      return fail("http", `upstream returned ${status}${detail ? `: ${detail}` : ""}`, {
        sessionId: sid,
        status,
        ms: Date.now() - startedAt,
      });
    }

    const raw = await res.text();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.warn(`[ai] unparsable response (session ${sid})`);
      return fail("parse", "upstream response was not valid JSON", {
        sessionId: sid,
        ms: Date.now() - startedAt,
      });
    }

    const text = extractText(payload);
    if (!text) {
      console.warn(`[ai] empty completion (session ${sid})`);
      return fail("parse", "upstream response contained no message content", {
        sessionId: sid,
        ms: Date.now() - startedAt,
      });
    }

    return {
      ok: true,
      text,
      model: (payload && typeof payload.model === "string" && payload.model) || MODEL,
      ms: Date.now() - startedAt,
      sessionId: sid,
    };
  } catch (err) {
    const aborted = timedOut || (err && err.name === "AbortError");
    if (aborted) {
      console.warn(`[ai] timeout after ${timeout}ms (session ${sid})`);
      return fail("timeout", `request aborted after ${timeout}ms`, {
        sessionId: sid,
        ms: Date.now() - startedAt,
      });
    }
    const message = err && err.message ? err.message : String(err);
    console.warn(`[ai] network error (session ${sid})`);
    return fail("network", message, { sessionId: sid, ms: Date.now() - startedAt });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { MODEL, isConfigured, generate };
