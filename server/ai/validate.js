// Anti-hallucination guard for AI-authored decisions (F022).
// CommonJS, no npm dependencies, never throws — every entry point returns a
// plain object describing what happened. The AI is allowed to pick *what*
// happens (an intent from the server's whitelist) and to phrase things, but
// it is never allowed to author game numbers: HP/MP/XP/gold/damage are always
// discarded here and recomputed by the deterministic engine.
//
// Contract:
//   normalizeDecision(raw, opts) -> { ok: true,  intent, args, discarded, truncated }
//                                 | { ok: false, code, error, discarded, truncated }
//   clampVitals(vitals, save)    -> { hp, mp }            (integers, in range)
//   withDeadline(fn, ms, fb)     -> { ok, timedOut, value, ms, error? }

// Mirrors the `id` fields of the INTENTS array in server/index.js (read-only
// copy: this module must not require the server entry point, which owns the
// listener and the sqlite handle). Keep in sync if that list changes.
const INTENTS = Object.freeze([
  "shadow_deploy",
  "shadow_undeploy",
  "shadow_formation",
  "attack",
  "skill",
  "defend",
  "item",
  "flee",
  "status",
  "help",
  "observe",
  "advance",
  "sneak",
  "rest",
  "save",
]);

const INTENT_IDS = new Set(INTENTS);

// Argument keys the AI may fill in. Everything else is dropped.
// All of them are strings by design: nothing here can move a number.
const ARG_KEYS = Object.freeze(["target", "item_id", "skill_id", "stat", "direction", "text"]);

// Save columns the AI loves to invent. Anything carrying one of these names
// (at the root of the payload or inside args) is treated as an attempt to
// write engine-owned state and is thrown away.
const STATE_KEYS = Object.freeze([
  "hp",
  "mp",
  "max_hp",
  "max_mp",
  "xp",
  "gold",
  "damage",
  "heal",
  "level",
  "chapter",
  "rank",
  "free_points",
  "stats",
  "crit",
  "def",
  "atk",
  "exp",
  "reward",
]);

const STATE_KEY_SET = new Set(STATE_KEYS);
const ARG_KEY_SET = new Set(ARG_KEYS);

// Keys that are structural, not game state, so they must not be reported as
// discarded when they appear at the root.
const ENVELOPE_KEYS = new Set(["intent", "action", "name", "args", "arguments", "narration", "role", "text"]);

const { extractJson } = require("./sanitize");

const DEFAULT_MAX_STRING = 200;
const DEFAULT_MAX_ARGS = 12;
const DEFAULT_DEADLINE_MS = 20000;
const DEFAULT_MAX_HP = 100;
const DEFAULT_MAX_MP = 20;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Property reads on model output can throw (getters, Proxies); treat those as
// "absent" instead of letting them escape.
function read(obj, key) {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

function messageOf(err) {
  if (err && typeof err.message === "string" && err.message) return err.message;
  return String(err);
}

function isKnownIntent(name) {
  if (typeof name !== "string") return false;
  const normalized = name.trim().toLowerCase();
  return normalized.length > 0 && INTENT_IDS.has(normalized);
}

// Number -> finite number or null. Strings like "42" are accepted; anything
// non-finite ("", "abc", NaN, Infinity, objects) becomes null.
function toFiniteNumber(value) {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIntegerOrNull(value) {
  const n = toFiniteNumber(value);
  return n === null ? null : Math.trunc(n);
}

function clampInt(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function result(extra) {
  return {
    ok: false,
    code: "shape",
    error: "invalid decision payload",
    discarded: [],
    truncated: [],
    ...extra,
  };
}

// Parses the AI payload. Strings are treated as JSON; a parse failure is a
// soft error (code "parse") so the caller can fall back to narration only.
function parsePayload(raw) {
  if (typeof raw === "string") {
    const text = raw.trim();
    if (!text) return { ok: false, code: "empty", error: "empty decision payload" };
    // F025：先原样解析；失败再剥 ```json 围栏/前后叙述后重试，
    // 仍失败才是 parse 错误（调用方降级到规则兜底，不 5xx）。
    const candidates = [text];
    const stripped = extractJson(text);
    if (stripped && stripped !== text) candidates.push(stripped);
    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (!isPlainObject(parsed)) {
          return { ok: false, code: "shape", error: "decision JSON was not an object" };
        }
        return { ok: true, value: parsed };
      } catch {
        // try the next candidate
      }
    }
    return { ok: false, code: "parse", error: "decision payload was not valid JSON" };
  }
  if (isPlainObject(raw)) return { ok: true, value: raw };
  return { ok: false, code: "shape", error: "decision payload must be an object or a JSON string" };
}

function pickIntentSource(payload) {
  for (const key of ["intent", "action", "name"]) {
    const value = read(payload, key);
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function collectRootDiscards(payload, discarded) {
  let keys = [];
  try {
    keys = Object.keys(payload);
  } catch {
    return;
  }
  for (const key of keys) {
    if (ENVELOPE_KEYS.has(key)) continue;
    const value = read(payload, key);
    const numeric = typeof value === "number" || (STATE_KEY_SET.has(key) && value !== undefined);
    if (!numeric) continue;
    // Root-level engine state: always dropped, always recorded.
    discarded.push({ key, reason: STATE_KEY_SET.has(key) ? "engine-state" : "numeric" });
  }
}

function sanitizeArgs(rawArgs, opts, discarded, truncated) {
  if (rawArgs === undefined || rawArgs === null) return {};
  let source = rawArgs;
  if (typeof rawArgs === "string") {
    try {
      source = JSON.parse(rawArgs);
    } catch {
      discarded.push({ key: "args", reason: "unparsable" });
      return {};
    }
  }
  if (!isPlainObject(source)) {
    discarded.push({ key: "args", reason: "shape" });
    return {};
  }

  const maxString = opts.maxStringLength;
  const out = {};
  let kept = 0;

  let argKeys = [];
  try {
    argKeys = Object.keys(source);
  } catch {
    discarded.push({ key: "args", reason: "shape" });
    return {};
  }

  for (const key of argKeys) {
    const value = read(source, key);
    // Engine-owned numbers never cross this boundary, whatever they are called.
    if (typeof value === "number" || STATE_KEY_SET.has(key)) {
      discarded.push({ key, reason: STATE_KEY_SET.has(key) ? "engine-state" : "numeric" });
      continue;
    }
    if (!ARG_KEY_SET.has(key)) {
      discarded.push({ key, reason: "unknown-key" });
      continue;
    }
    if (typeof value === "boolean" || value === null) {
      discarded.push({ key, reason: "type" });
      continue;
    }
    if (typeof value !== "string") {
      discarded.push({ key, reason: "type" });
      continue;
    }
    let text = value.trim();
    if (!text) {
      discarded.push({ key, reason: "empty" });
      continue;
    }
    if (kept >= opts.maxArgs) {
      discarded.push({ key, reason: "too-many" });
      continue;
    }
    if (text.length > maxString) {
      text = text.slice(0, maxString);
      truncated.push({ key, length: value.trim().length, kept: maxString });
    }
    out[key] = text;
    kept += 1;
  }

  return out;
}

/**
 * Normalizes an AI decision into a server-owned shape.
 *
 * @param {object|string} raw           model output (object or JSON string)
 * @param {object} [opts]
 * @param {number} [opts.maxStringLength=200]
 * @param {number} [opts.maxArgs=12]
 */
function normalizeDecision(raw, opts = {}) {
  const options = isPlainObject(opts) ? opts : {};
  const maxStringLength = (() => {
    const n = toIntegerOrNull(options.maxStringLength);
    return n !== null && n > 0 ? n : DEFAULT_MAX_STRING;
  })();
  const maxArgs = (() => {
    const n = toIntegerOrNull(options.maxArgs);
    return n !== null && n > 0 ? n : DEFAULT_MAX_ARGS;
  })();

  const parsed = parsePayload(raw);
  if (!parsed.ok) return result({ code: parsed.code, error: parsed.error });

  const payload = parsed.value;
  const discarded = [];
  const truncated = [];

  try {
    collectRootDiscards(payload, discarded);

    const rawIntent = pickIntentSource(payload);
    const intent = typeof rawIntent === "string" ? rawIntent.trim().toLowerCase() : "";
    if (!intent) {
      return result({ code: "unknown-intent", error: "decision carried no intent", discarded, truncated });
    }
    if (!INTENT_IDS.has(intent)) {
      return result({
        code: "unknown-intent",
        error: `intent "${intent.slice(0, 64)}" is not in the whitelist`,
        intent,
        discarded,
        truncated,
      });
    }

    const rawArgs = read(payload, "args") !== undefined ? read(payload, "args") : read(payload, "arguments");
    const args = sanitizeArgs(rawArgs, { maxStringLength, maxArgs }, discarded, truncated);

    return { ok: true, intent, args, discarded, truncated };
  } catch (err) {
    // Last resort: a hostile payload must never crash the request handler.
    return result({ code: "shape", error: messageOf(err), discarded, truncated });
  }
}

/**
 * Clamps HP/MP into [0, max] for the save that is about to be patched.
 * Unusable input falls back to the save's current value, everything is
 * truncated to an integer. Never throws, even for a garbage save.
 */
function clampVitals(vitals, save) {
  const current = isPlainObject(save) ? save : {};
  const incoming = isPlainObject(vitals) ? vitals : {};

  const maxHp = (() => {
    const n = toIntegerOrNull(current.max_hp);
    return n !== null && n >= 0 ? n : DEFAULT_MAX_HP;
  })();
  const maxMp = (() => {
    const n = toIntegerOrNull(current.max_mp);
    return n !== null && n >= 0 ? n : DEFAULT_MAX_MP;
  })();

  const hpNow = clampInt(toIntegerOrNull(current.hp) ?? 0, 0, maxHp);
  const mpNow = clampInt(toIntegerOrNull(current.mp) ?? 0, 0, maxMp);

  const hp = toIntegerOrNull(incoming.hp);
  const mp = toIntegerOrNull(incoming.mp);

  return {
    hp: clampInt(hp === null ? hpNow : hp, 0, maxHp),
    mp: clampInt(mp === null ? mpNow : mp, 0, maxMp),
  };
}

/**
 * F025 陈旧快照合并：intent 模板算出的 patch 是相对「AI 调用前」的旧快照
 * 产生的绝对值。AI 返回后存档可能已被其它写入改动，直接写旧快照的绝对值
 * 会把期间的增量回退掉。这里把 patch 隐含的增量（patch - base）重新套到
 * 新快照上，再用 clampVitals 夹紧到 0..max。
 *
 * applyVitalsDelta(base, fresh, patch) -> { hp, mp }
 *   base  AI 调用前读到的快照（patch 的参照系）
 *   fresh AI 返回后重读的快照（增量的落点；缺失时退回 base）
 *   patch intent 模板产出的 { hp?, mp? } 绝对值
 * 永不抛异常；patch 里没有的字段回落到 fresh 当前值。
 */
function applyVitalsDelta(base, fresh, patch) {
  const b = isPlainObject(base) ? base : {};
  const f = isPlainObject(fresh) ? fresh : b;
  const p = isPlainObject(patch) ? patch : {};

  const vitals = {};
  for (const key of ["hp", "mp"]) {
    const target = toIntegerOrNull(p[key]);
    if (target === null) continue;
    const baseVal = toIntegerOrNull(b[key]);
    const freshVal = toIntegerOrNull(f[key]);
    vitals[key] =
      freshVal === null ? target : freshVal + (baseVal === null ? 0 : target - baseVal);
  }
  return clampVitals(vitals, f);
}

/**
 * Awaits fn() but gives up after `ms` (default 20s). Timeouts and thrown
 * errors both resolve with the supplied fallback — nothing is thrown and the
 * timer is always cleared, so a fast path never keeps the loop alive.
 *
 * Resolves with { ok, timedOut, value, ms, error? }:
 *   ok:true                    -> value is fn()'s result
 *   ok:false, timedOut:true    -> value is `fallback`
 *   ok:false, timedOut:false   -> fn threw; value is `fallback`, error is set
 */
function withDeadline(fn, ms = DEFAULT_DEADLINE_MS, fallback) {
  const startedAt = Date.now();
  const limit = (() => {
    const n = toIntegerOrNull(ms);
    return n !== null && n > 0 ? n : DEFAULT_DEADLINE_MS;
  })();

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(payload);
    };

    timer = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        error: `deadline exceeded after ${limit}ms`,
        value: fallback,
        ms: Date.now() - startedAt,
      });
    }, limit);
    // Do not hold the event loop open just for the watchdog.
    if (typeof timer.unref === "function") timer.unref();

    let pending;
    try {
      pending = typeof fn === "function" ? fn() : undefined;
    } catch (err) {
      finish({
        ok: false,
        timedOut: false,
        error: messageOf(err),
        value: fallback,
        ms: Date.now() - startedAt,
      });
      return;
    }

    // The rejection handler is attached immediately, so a late failure after
    // the deadline can never surface as an unhandled rejection.
    Promise.resolve(pending).then(
      (value) =>
        finish({ ok: true, timedOut: false, value, ms: Date.now() - startedAt }),
      (err) =>
        finish({
          ok: false,
          timedOut: false,
          error: messageOf(err),
          value: fallback,
          ms: Date.now() - startedAt,
        })
    );
  });
}

module.exports = {
  INTENTS,
  INTENT_IDS,
  ARG_KEYS,
  STATE_KEYS,
  DEFAULT_DEADLINE_MS,
  DEFAULT_MAX_STRING,
  isKnownIntent,
  normalizeDecision,
  clampVitals,
  applyVitalsDelta,
  withDeadline,
};
