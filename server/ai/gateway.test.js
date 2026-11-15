// node:test coverage for the AI gateway's contract (no real network calls).
// Run: node --test server/ai/gateway.test.js

const test = require("node:test");
const assert = require("node:assert");

const gatewayPath = require.resolve("./gateway");

function freshGateway() {
  delete require.cache[gatewayPath];
  return require("./gateway");
}

function withEnv(vars, fn) {
  const saved = {};
  for (const key of Object.keys(vars)) {
    saved[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    });
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}

test("no key: isConfigured false, no network call, code no-key", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: undefined }, async () => {
    const gateway = freshGateway();
    let called = 0;
    const fetchImpl = () => {
      called += 1;
      throw new Error("should not be called");
    };
    assert.strictEqual(gateway.isConfigured(), false);
    const r = await gateway.generate({
      messages: [{ role: "user", content: "hi" }],
      fetchImpl,
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "no-key");
    assert.strictEqual(called, 0);
    assert.strictEqual(typeof r.sessionId, "string");
  });
});

test("misconfigured key (whitespace) also counts as absent", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "   " }, async () => {
    const gateway = freshGateway();
    assert.strictEqual(gateway.isConfigured(), false);
    const r = await gateway.generate({ messages: [], fetchImpl: () => {
      throw new Error("should not be called");
    } });
    assert.strictEqual(r.code, "no-key");
  });
});

test("success: sends model, bearer auth and x-opencode-session", async () => {
  await withEnv(
    { OPENCODE_GO_API_KEY: "test-key", OPENCODE_GO_BASE_URL: "https://example.test/v1/" },
    async () => {
      const gateway = freshGateway();
      let seen = null;
      const fetchImpl = async (url, opts) => {
        seen = { url, opts };
        return jsonResponse({
          model: "deepseek-v4.1-flash",
          choices: [{ message: { role: "assistant", content: "hi there" } }],
        });
      };
      const r = await gateway.generate({
        messages: [{ role: "user", content: "hi" }],
        sessionId: "sess-123",
        fetchImpl,
      });
      assert.strictEqual(r.ok, true);
      assert.strictEqual(r.text, "hi there");
      assert.strictEqual(r.model, "deepseek-v4.1-flash");
      assert.strictEqual(r.sessionId, "sess-123");
      assert.ok(Number.isFinite(r.ms));
      assert.strictEqual(seen.url, "https://example.test/v1/chat/completions");
      assert.strictEqual(seen.opts.method, "POST");
      assert.strictEqual(seen.opts.headers.Authorization, "Bearer test-key");
      assert.strictEqual(seen.opts.headers["x-opencode-session"], "sess-123");
      const body = JSON.parse(seen.opts.body);
      assert.strictEqual(body.model, gateway.MODEL);
      assert.strictEqual(body.model, "deepseek-v4.1-flash");
      assert.strictEqual(body.messages.length, 1);
    }
  );
});

test("session id defaults to a generated uuid", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "test-key" }, async () => {
    const gateway = freshGateway();
    const fetchImpl = async () =>
      jsonResponse({ choices: [{ message: { content: "ok" } }] });
    const r = await gateway.generate({ messages: [], fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.match(r.sessionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

test("timeout: aborts and reports code timeout", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "test-key" }, async () => {
    const gateway = freshGateway();
    const fetchImpl = (url, opts) =>
      new Promise((resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const r = await gateway.generate({ messages: [], timeoutMs: 25, fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "timeout");
  });
});

test("http error: reports status, never throws", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "test-key" }, async () => {
    const gateway = freshGateway();
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      text: async () => "unauthorized",
    });
    const r = await gateway.generate({ messages: [], fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "http");
    assert.strictEqual(r.status, 401);
  });
});

test("parse error: non-JSON body yields code parse", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "test-key" }, async () => {
    const gateway = freshGateway();
    const fetchImpl = async () => ({ ok: true, status: 200, text: async () => "<html>nope" });
    const r = await gateway.generate({ messages: [], fetchImpl });
    assert.strictEqual(r.code, "parse");
  });
});

test("network error: thrown fetch is caught", async () => {
  await withEnv({ OPENCODE_GO_API_KEY: "test-key" }, async () => {
    const gateway = freshGateway();
    const fetchImpl = async () => {
      throw new Error("ECONNREFUSED");
    };
    const r = await gateway.generate({ messages: [], fetchImpl });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, "network");
  });
});
