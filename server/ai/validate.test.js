// node:test coverage for the F022 anti-hallucination guard.
// Run: node --test server/ai/validate.test.js
//
// The point of the module is that an AI reply can never move a game number,
// so most of these cases are adversarial: forged HP/MP/gold, unknown intents,
// broken JSON, and a model that never answers.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const v = require("./validate");

const SAVE = { hp: 73, mp: 12, max_hp: 120, max_mp: 30 };

test("INTENTS is a frozen list that matches server/index.js", () => {
  assert.ok(Array.isArray(v.INTENTS));
  assert.ok(Object.isFrozen(v.INTENTS));
  assert.deepStrictEqual(
    [...v.INTENTS],
    [
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
      "choice",
      "sneak",
      "rest",
      "save",
    ]
  );

  // Drift guard: read the server's own whitelist without requiring index.js
  // (which would open the sqlite handle and bind a port).
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const block = source.slice(source.indexOf("const INTENTS = ["));
  const ids = [...block.matchAll(/^\s{4}id:\s*"([a-z_]+)",/gm)].map((m) => m[1]);
  assert.ok(ids.length >= 5, "expected to find intent ids in server/index.js");
  assert.deepStrictEqual([...v.INTENTS].sort(), ids.sort());
});

test("isKnownIntent accepts whitelisted names, case/space tolerant", () => {
  assert.strictEqual(v.isKnownIntent("advance"), true);
  assert.strictEqual(v.isKnownIntent("  REST "), true);
  assert.strictEqual(v.isKnownIntent("SAVE"), true);
  assert.strictEqual(v.isKnownIntent("teleport"), false);
  assert.strictEqual(v.isKnownIntent(""), false);
  assert.strictEqual(v.isKnownIntent("   "), false);
  assert.strictEqual(v.isKnownIntent(null), false);
  assert.strictEqual(v.isKnownIntent(42), false);
  assert.strictEqual(v.isKnownIntent("unknown"), false);
});

test("valid decision passes through with normalized intent and args", () => {
  const r = v.normalizeDecision({
    intent: "  Advance ",
    args: { target: "  石门  ", direction: "north" },
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.intent, "advance");
  assert.deepStrictEqual(r.args, { target: "石门", direction: "north" });
  assert.deepStrictEqual(r.discarded, []);
  assert.deepStrictEqual(r.truncated, []);
});

test("unknown intent is rejected with code unknown-intent", () => {
  const r = v.normalizeDecision({ intent: "spawn_dragon", args: { target: "门" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "unknown-intent");
  assert.match(r.error, /not in the whitelist/);
  assert.strictEqual(r.args, undefined, "a rejected decision carries no args");
});

test("missing intent is rejected, not defaulted", () => {
  const r = v.normalizeDecision({ args: { target: "门" } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "unknown-intent");
});

test("forged hp/gold inside args are discarded, never returned", () => {
  const r = v.normalizeDecision({
    intent: "rest",
    args: { hp: 9999, mp: 9999, gold: 999999, xp: 999999999, damage: 9999, target: "石柱" },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, { target: "石柱" });
  assert.strictEqual(r.args.hp, undefined);
  assert.strictEqual(r.args.gold, undefined);
  const keys = r.discarded.map((d) => d.key).sort();
  assert.deepStrictEqual(keys, ["damage", "gold", "hp", "mp", "xp"]);
  assert.ok(r.discarded.every((d) => d.reason === "engine-state"));
});

test("forged numbers at the root are discarded even outside args", () => {
  const r = v.normalizeDecision({ intent: "advance", hp: 9999, gold: 999999, args: { target: "门" } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, { target: "门" });
  const keys = r.discarded.map((d) => d.key).sort();
  assert.deepStrictEqual(keys, ["gold", "hp"]);
});

test("numeric values under a whitelisted arg key are still dropped", () => {
  const r = v.normalizeDecision({ intent: "observe", args: { target: 7, text: " 环顾四周 " } });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, { text: "环顾四周" });
  assert.deepStrictEqual(r.discarded, [{ key: "target", reason: "numeric" }]);
});

test("unknown and non-string arg keys are dropped", () => {
  const r = v.normalizeDecision({
    intent: "status",
    args: { item_id: "potion_1", evil: "x", nested: { a: 1 }, flag: true, empty: "   " },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, { item_id: "potion_1" });
  assert.deepStrictEqual(r.discarded, [
    { key: "evil", reason: "unknown-key" },
    { key: "nested", reason: "unknown-key" },
    { key: "flag", reason: "unknown-key" },
    { key: "empty", reason: "unknown-key" },
  ]);
});

test("whitelisted keys with blank or non-string values are dropped", () => {
  const r = v.normalizeDecision({
    intent: "status",
    args: { target: "   ", text: null, direction: false, stat: ["a"], skill_id: "slash" },
  });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.args, { skill_id: "slash" });
  assert.deepStrictEqual(r.discarded, [
    { key: "target", reason: "empty" },
    { key: "text", reason: "type" },
    { key: "direction", reason: "type" },
    { key: "stat", reason: "type" },
  ]);
});

test("args passed as a JSON string are parsed; bad JSON drops args only", () => {
  const good = v.normalizeDecision({ intent: "status", args: '{"target":"面板"}' });
  assert.strictEqual(good.ok, true);
  assert.deepStrictEqual(good.args, { target: "面板" });

  const bad = v.normalizeDecision({ intent: "status", args: "{not json" });
  assert.strictEqual(bad.ok, true, "intent is still usable");
  assert.deepStrictEqual(bad.args, {});
  assert.deepStrictEqual(bad.discarded, [{ key: "args", reason: "unparsable" }]);
});

test("string payload: valid JSON is accepted", () => {
  const r = v.normalizeDecision('{"intent":"sneak","args":{"direction":"left"}}');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.intent, "sneak");
  assert.deepStrictEqual(r.args, { direction: "left" });
});

test("string payload: malformed JSON degrades with code parse", () => {
  const r = v.normalizeDecision('{"intent": "advance", "args": {"target": "门"');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, "parse");
  assert.ok(Array.isArray(r.discarded));
});

test("string payload: non-object JSON and empty strings are rejected", () => {
  assert.strictEqual(v.normalizeDecision("[1,2,3]").code, "shape");
  assert.strictEqual(v.normalizeDecision("42").code, "shape");
  assert.strictEqual(v.normalizeDecision("   ").code, "empty");
  assert.strictEqual(v.normalizeDecision(null).code, "shape");
  assert.strictEqual(v.normalizeDecision(undefined).code, "shape");
  assert.strictEqual(v.normalizeDecision(42).code, "shape");
});

test("over-long strings are truncated and recorded", () => {
  const long = "查".repeat(500);
  const r = v.normalizeDecision({ intent: "observe", args: { text: long, target: "门" } }, { maxStringLength: 10 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.args.text.length, 10);
  assert.strictEqual(r.args.text, "查".repeat(10));
  assert.strictEqual(r.args.target, "门");
  assert.deepStrictEqual(r.truncated, [{ key: "text", length: 500, kept: 10 }]);
});

test("default max string length is applied without opts", () => {
  const r = v.normalizeDecision({ intent: "observe", args: { text: "x".repeat(v.DEFAULT_MAX_STRING + 50) } });
  assert.strictEqual(r.args.text.length, v.DEFAULT_MAX_STRING);
  assert.strictEqual(r.truncated.length, 1);
});

test("arg count is capped", () => {
  const r = v.normalizeDecision(
    {
      intent: "observe",
      args: { target: "a", text: "b", direction: "c", stat: "d", item_id: "e", skill_id: "f" },
    },
    { maxArgs: 2 }
  );
  assert.strictEqual(Object.keys(r.args).length, 2);
  assert.strictEqual(r.discarded.filter((d) => d.reason === "too-many").length, 4);
});

test("normalizeDecision never throws on hostile shapes", () => {
  const hostile = [
    { get intent() { throw new Error("boom"); } },
    Object.create(null),
    { intent: "advance", args: [] },
    { intent: { nested: true } },
    { intent: "advance", args: { toString: 1 } },
  ];
  for (const raw of hostile) {
    assert.doesNotThrow(() => v.normalizeDecision(raw));
  }
  assert.strictEqual(v.normalizeDecision({ intent: "advance", args: [] }).ok, true);
});

test("clampVitals clamps negatives and overflow into range", () => {
  assert.deepStrictEqual(v.clampVitals({ hp: -50, mp: 9999 }, SAVE), { hp: 0, mp: 30 });
  assert.deepStrictEqual(v.clampVitals({ hp: 9999, mp: -1 }, SAVE), { hp: 120, mp: 0 });
});

test("clampVitals truncates fractions toward zero", () => {
  assert.deepStrictEqual(v.clampVitals({ hp: 55.9, mp: 3.2 }, SAVE), { hp: 55, mp: 3 });
  assert.deepStrictEqual(v.clampVitals({ hp: 119.999, mp: 29.5 }, SAVE), { hp: 119, mp: 29 });
});

test("clampVitals falls back to the save value for NaN/invalid input", () => {
  assert.deepStrictEqual(v.clampVitals({ hp: NaN, mp: Infinity }, SAVE), { hp: 73, mp: 12 });
  assert.deepStrictEqual(v.clampVitals({ hp: "abc", mp: "" }, SAVE), { hp: 73, mp: 12 });
  assert.deepStrictEqual(v.clampVitals({}, SAVE), { hp: 73, mp: 12 });
  assert.deepStrictEqual(v.clampVitals(null, SAVE), { hp: 73, mp: 12 });
});

test("clampVitals also repairs an out-of-range current save value", () => {
  const broken = { hp: 500, mp: -3, max_hp: 100, max_mp: 20 };
  assert.deepStrictEqual(v.clampVitals({ hp: NaN, mp: NaN }, broken), { hp: 100, mp: 0 });
});

test("clampVitals survives a garbage save (defaults apply, no throw)", () => {
  assert.doesNotThrow(() => v.clampVitals({ hp: 5 }, null));
  assert.deepStrictEqual(v.clampVitals({ hp: 5, mp: 5 }, null), { hp: 5, mp: 5 });
  const weird = { hp: "x", mp: undefined, max_hp: -1, max_mp: "nope" };
  const r = v.clampVitals({ hp: 1, mp: 1 }, weird);
  assert.ok(Number.isInteger(r.hp) && Number.isInteger(r.mp));
  assert.ok(r.hp >= 0 && r.mp >= 0);
});

test("withDeadline resolves the fast path without flagging a timeout", async () => {
  const r = await v.withDeadline(() => "ok-value", 1000, "fallback");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.value, "ok-value");
  assert.ok(Number.isFinite(r.ms));
  assert.strictEqual(r.error, undefined);
});

test("withDeadline awaits async results on the fast path", async () => {
  const r = await v.withDeadline(async () => ({ intent: "rest" }), 1000, null);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.timedOut, false);
  assert.deepStrictEqual(r.value, { intent: "rest" });
});

test("withDeadline returns the fallback on timeout", async () => {
  const startedAt = Date.now();
  const r = await v.withDeadline(
    () => new Promise((resolve) => setTimeout(() => resolve("too late"), 1000)),
    25,
    { degraded: true }
  );
  const elapsed = Date.now() - startedAt;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timedOut, true);
  assert.deepStrictEqual(r.value, { degraded: true });
  assert.match(r.error, /deadline exceeded after 25ms/);
  assert.ok(elapsed < 500, `expected to give up early, took ${elapsed}ms`);
});

test("withDeadline swallows a late rejection (no unhandled rejection)", async () => {
  const seen = [];
  const onUnhandled = (err) => seen.push(err);
  process.on("unhandledRejection", onUnhandled);
  try {
    const r = await v.withDeadline(
      () =>
        new Promise((_resolve, reject) => {
          setTimeout(() => reject(new Error("late failure")), 60);
        }),
      15,
      "fallback"
    );
    assert.strictEqual(r.timedOut, true);
    assert.strictEqual(r.value, "fallback");
    // Let the late rejection actually fire before checking.
    await new Promise((resolve) => setTimeout(resolve, 600));
    assert.deepStrictEqual(seen, []);
  } finally {
    process.removeListener("unhandledRejection", onUnhandled);
  }
});

test("withDeadline catches synchronous throws", async () => {
  const r = await v.withDeadline(() => {
    throw new Error("engine exploded");
  }, 1000, "fallback");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.value, "fallback");
  assert.match(r.error, /engine exploded/);
});

test("withDeadline catches rejected promises", async () => {
  const r = await v.withDeadline(async () => {
    throw new Error("network down");
  }, 1000, "fallback");
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.timedOut, false);
  assert.strictEqual(r.value, "fallback");
  assert.match(r.error, /network down/);
});

test("withDeadline tolerates a missing fn and a bad limit", async () => {
  const r = await v.withDeadline(undefined, 1000, "fallback");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, undefined);

  const bad = await v.withDeadline(() => "fast", 0, "fallback");
  assert.strictEqual(bad.ok, true);
  assert.strictEqual(bad.value, "fast");
});

test("withDeadline works end-to-end with normalizeDecision as the fallback path", async () => {
  const decision = await v.withDeadline(
    async () => v.normalizeDecision('{"intent":"teleport","args":{"hp":9999}}'),
    1000,
    { ok: false, code: "timeout" }
  );
  assert.strictEqual(decision.ok, true);
  assert.strictEqual(decision.value.ok, false);
  assert.strictEqual(decision.value.code, "unknown-intent");
});

test("module exports the documented surface", () => {
  for (const name of [
    "INTENTS",
    "isKnownIntent",
    "normalizeDecision",
    "clampVitals",
    "withDeadline",
  ]) {
    assert.ok(name in v, `missing export ${name}`);
  }
  assert.strictEqual(v.DEFAULT_DEADLINE_MS, 20000);
  assert.strictEqual(typeof v.withDeadline, "function");
  assert.strictEqual(v.withDeadline.length, 1, "only fn is required; ms and fallback default");
});
