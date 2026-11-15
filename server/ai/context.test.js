// node:test coverage for F023 context compression (pure functions, no network/db).
// Run: node --test server/ai/context.test.js

const test = require("node:test");
const assert = require("node:assert");

const context = require("./context");

const SAVE = {
  id: 1,
  player_name: "夜影",
  rank: "B",
  level: 7,
  chapter: 3,
  hp: 82,
  max_hp: 100,
  mp: 14,
  max_mp: 20,
  gold: 1234,
  xp: 340,
  xp_to_next: 560,
  free_points: 2,
  stats: { strength: 12, agility: 14, vitality: 10, intelligence: 11, perception: 13 },
  stats_json: '{"strength":12}',
  created_at: "2026-01-01 00:00:00",
  updated_at: "2026-01-01 00:00:00",
};

function log(role, content) {
  return { id: 1, role, content, created_at: "2026-01-01 00:00:00" };
}

function makeLogs(n, len = 10) {
  const roles = ["narrator", "system", "user", "ai"];
  return Array.from({ length: n }, (_, i) =>
    log(roles[i % roles.length], `第${i}条` + "文".repeat(Math.max(0, len - 4)))
  );
}

test("exports the documented API surface", () => {
  assert.ok(Array.isArray(context.STATE_SUMMARY_FIELDS));
  for (const field of [
    "player_name",
    "rank",
    "level",
    "chapter",
    "hp",
    "max_hp",
    "mp",
    "max_mp",
    "gold",
    "xp",
    "free_points",
  ]) {
    assert.ok(context.STATE_SUMMARY_FIELDS.includes(field), `missing ${field}`);
  }
  assert.strictEqual(context.DEFAULT_LOG_LIMIT, 6);
  assert.strictEqual(typeof context.summarizeState, "function");
  assert.strictEqual(typeof context.tailLogs, "function");
  assert.strictEqual(typeof context.buildContext, "function");
  assert.strictEqual(typeof context.pickStateFields, "function");
});

test("pickStateFields keeps only whitelisted fields", () => {
  const picked = context.pickStateFields(SAVE);
  assert.strictEqual(picked.player_name, "夜影");
  assert.strictEqual(picked.level, 7);
  assert.deepStrictEqual(picked.stats, SAVE.stats);
  assert.strictEqual(picked.id, undefined);
  assert.strictEqual(picked.stats_json, undefined);
  assert.strictEqual(picked.created_at, undefined);
  assert.strictEqual(picked.updated_at, undefined);
});

test("summarizeState is a single compact line with padded numbers", () => {
  const summary = context.summarizeState(SAVE);
  assert.strictEqual(typeof summary, "string");
  assert.strictEqual(summary.includes("\n"), false);
  assert.match(summary, /【状态】夜影/);
  assert.match(summary, /Lv\. 7/);
  assert.match(summary, /B 级猎人/);
  assert.match(summary, /第 3 章/);
  assert.match(summary, /HP  82\/100/);
  assert.match(summary, /MP  14\/ 20/);
  assert.match(summary, /金币   1234/);
  assert.match(summary, /自由点数  2/);
  // every stat appears
  for (const label of ["力", "敏", "体", "智", "感"]) {
    assert.ok(summary.includes(label), `missing stat ${label}`);
  }
});

test("summarizeState tolerates a save with missing fields (never throws)", () => {
  assert.doesNotThrow(() => context.summarizeState({}));
  const partial = context.summarizeState({ player_name: "无名" });
  assert.match(partial, /【状态】无名/);
  assert.match(partial, /Lv\. 1/);
  assert.match(partial, /E 级猎人/);
  assert.doesNotThrow(() => context.summarizeState(null));
  assert.doesNotThrow(() => context.summarizeState(undefined));
  assert.doesNotThrow(() => context.summarizeState("not-a-save"));
  assert.doesNotThrow(() => context.summarizeState({ stats: "broken", hp: "NaN", level: {} }));
});

test("summarizeState appends extra deterministically", () => {
  const a = context.summarizeState(SAVE, { 影子: 2, 背包: 5 });
  const b = context.summarizeState(SAVE, { 背包: 5, 影子: 2 });
  assert.strictEqual(a, b);
  assert.match(a, /影子=2/);
  assert.strictEqual(context.summarizeState(SAVE, ""), context.summarizeState(SAVE));
});

test("tailLogs on empty / non-array input returns []", () => {
  assert.deepStrictEqual(context.tailLogs([]), []);
  assert.deepStrictEqual(context.tailLogs(null), []);
  assert.deepStrictEqual(context.tailLogs(undefined), []);
  assert.deepStrictEqual(context.tailLogs("nope"), []);
  assert.deepStrictEqual(context.tailLogs({ length: 3 }), []);
});

test("tailLogs keeps every entry when fewer than the limit", () => {
  const logs = makeLogs(3);
  const tail = context.tailLogs(logs);
  assert.strictEqual(tail.length, 3);
  assert.deepStrictEqual(
    tail.map((item) => item.content),
    logs.map((item) => item.content)
  );
  assert.deepStrictEqual(
    tail.map((item) => item.role),
    logs.map((item) => item.role)
  );
});

test("tailLogs keeps only the newest 6, in original order", () => {
  const logs = makeLogs(10);
  const tail = context.tailLogs(logs);
  assert.strictEqual(tail.length, 6);
  assert.deepStrictEqual(
    tail.map((item) => item.content),
    logs.slice(-6).map((item) => item.content)
  );
  // stable ordering: oldest of the kept window first
  assert.strictEqual(tail[tail.length - 1].content, logs[9].content);
});

test("tailLogs truncates one over-long entry to 240 chars with an ellipsis", () => {
  const long = "长".repeat(1000);
  const tail = context.tailLogs([log("narrator", long), log("system", "短")]);
  assert.strictEqual(tail.length, 2);
  const clipped = tail[0];
  assert.strictEqual(Array.from(clipped.content).length, context.DEFAULT_MAX_ENTRY_CHARS);
  assert.ok(clipped.content.endsWith("…"));
  assert.strictEqual(clipped.truncated, true);
  assert.strictEqual(tail[1].content, "短");
  assert.strictEqual(tail[1].truncated, false);
});

test("tailLogs honors a custom limit and max entry length, ignores junk entries", () => {
  const tail = context.tailLogs(makeLogs(5), 2, 6);
  assert.strictEqual(tail.length, 2);
  for (const item of tail) assert.ok(Array.from(item.content).length <= 6);
  // malformed entries are skipped instead of throwing
  const junk = [...makeLogs(5), null, { role: "system" }, log("system", ""), "raw-string"];
  assert.deepStrictEqual(context.tailLogs(junk, 4), []);
  // bogus limit falls back to the default window
  assert.strictEqual(context.tailLogs(makeLogs(10), 0).length, 6);
  assert.strictEqual(context.tailLogs(makeLogs(10), -3).length, 6);
});

test("tailLogs normalizes roles but keeps the four legal ones", () => {
  const tail = context.tailLogs([
    log("SYSTEM", "a"),
    log("user", "b"),
    log("ai", "c"),
    log("narrator", "d"),
    log("hacker", "e"),
  ]);
  assert.deepStrictEqual(
    tail.map((item) => item.role),
    ["system", "user", "ai", "narrator", "narrator"]
  );
});

test("tailLogs never mutates the input array", () => {
  const logs = makeLogs(8);
  const snapshot = JSON.parse(JSON.stringify(logs));
  context.tailLogs(logs);
  assert.deepStrictEqual(logs, snapshot);
});

test("buildContext returns { summary, history, input } plus budget bookkeeping", () => {
  const logs = makeLogs(8);
  const ctx = context.buildContext({ save: SAVE, logs, playerInput: "前进" });
  assert.strictEqual(ctx.summary, context.summarizeState(SAVE));
  assert.strictEqual(ctx.input, "前进");
  assert.strictEqual(ctx.history.length, 6);
  assert.deepStrictEqual(Object.keys(ctx.history[0]), ["role", "content"]);
  assert.strictEqual(ctx.maxChars, context.DEFAULT_MAX_CHARS);
  assert.strictEqual(ctx.truncated, false);
  assert.strictEqual(ctx.droppedLogs, 0);
  const expected =
    ctx.summary.length + ctx.input.length + ctx.history.reduce((n, item) => n + item.content.length, 0);
  assert.strictEqual(ctx.usedChars, expected);
  assert.strictEqual(ctx.usedChars, context.estimateChars(ctx));
  assert.ok(ctx.usedChars <= ctx.maxChars);
});

test("buildContext on empty logs yields summary + input only", () => {
  const ctx = context.buildContext({ save: SAVE, logs: [], playerInput: "环顾四周" });
  assert.deepStrictEqual(ctx.history, []);
  assert.strictEqual(ctx.input, "环顾四周");
  assert.strictEqual(ctx.usedChars, ctx.summary.length + 4);
  assert.strictEqual(ctx.truncated, false);
});

test("buildContext drops the oldest logs first when over budget, keeping summary and input", () => {
  const logs = Array.from({ length: 6 }, (_, i) => log("narrator", `L${i}` + "甲".repeat(38)));
  const summaryLen = context.summarizeState(SAVE).length;
  const input = "前进";
  const maxChars = summaryLen + input.length + 100; // room for ~2.5 entries of 40

  const ctx = context.buildContext({ save: SAVE, logs, playerInput: input, maxChars });
  assert.strictEqual(ctx.summary, context.summarizeState(SAVE), "summary must never be cut");
  assert.strictEqual(ctx.input, input, "input must never be cut");
  assert.ok(ctx.droppedLogs > 0);
  assert.strictEqual(ctx.truncated, true);
  assert.ok(ctx.usedChars <= maxChars, `used ${ctx.usedChars} > ${maxChars}`);
  // survivors are the newest ones, still in ascending order
  assert.ok(ctx.history.length >= 1);
  assert.strictEqual(ctx.history[ctx.history.length - 1].content, logs[5].content);
  assert.deepStrictEqual(
    ctx.history.map((item) => item.content),
    logs.slice(logs.length - ctx.history.length).map((item) => item.content)
  );
  assert.strictEqual(ctx.droppedLogs, logs.length - ctx.history.length);
});

test("buildContext clips the last remaining entry rather than dropping summary/input", () => {
  const big = log("narrator", "乙".repeat(900));
  const summaryLen = context.summarizeState(SAVE).length;
  const input = "九字输入文本";
  const maxChars = summaryLen + input.length + 40;

  const ctx = context.buildContext({ save: SAVE, logs: [big], playerInput: input, maxChars });
  assert.strictEqual(ctx.summary, context.summarizeState(SAVE));
  assert.strictEqual(ctx.input, input);
  assert.strictEqual(ctx.history.length, 1);
  assert.strictEqual(Array.from(ctx.history[0].content).length, 40);
  assert.ok(ctx.history[0].content.endsWith("…"));
  assert.strictEqual(ctx.clippedLogs, 1);
  assert.strictEqual(ctx.truncated, true);
  assert.ok(ctx.usedChars <= maxChars);
});

test("buildContext keeps summary and input even when they alone exceed the budget", () => {
  const summaryLen = context.summarizeState(SAVE).length;
  const ctx = context.buildContext({
    save: SAVE,
    logs: makeLogs(6),
    playerInput: "前进",
    maxChars: 10,
  });
  assert.strictEqual(ctx.summary, context.summarizeState(SAVE));
  assert.strictEqual(ctx.input, "前进");
  assert.deepStrictEqual(ctx.history, []);
  assert.strictEqual(ctx.droppedLogs, 6);
  assert.strictEqual(ctx.truncated, true);
  assert.ok(ctx.usedChars > summaryLen, "used chars reports the unavoidable summary+input cost");
});

test("buildContext degrades invalid inputs to an empty structure (never throws)", () => {
  for (const bad of [undefined, null, "x", 42, [], { save: null, logs: "nope", playerInput: 7 }]) {
    let ctx;
    assert.doesNotThrow(() => {
      ctx = context.buildContext(bad);
    });
    assert.strictEqual(typeof ctx.summary, "string");
    assert.ok(Array.isArray(ctx.history));
    assert.strictEqual(typeof ctx.input, "string");
    assert.strictEqual(typeof ctx.usedChars, "number");
    assert.strictEqual(typeof ctx.truncated, "boolean");
  }
  const empty = context.buildContext(null);
  assert.deepStrictEqual(empty.history, []);
  assert.strictEqual(empty.input, "");
  assert.strictEqual(empty.usedChars, empty.summary.length);
});

test("buildContext is deterministic for identical input", () => {
  const logs = makeLogs(12, 60);
  const opts = { save: SAVE, logs, playerInput: "潜行", maxChars: 500, limit: 6 };
  const a = context.buildContext(opts);
  const b = context.buildContext(opts);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
  // same data, freshly built objects -> same result
  const c = context.buildContext({ save: { ...SAVE, stats: { ...SAVE.stats } }, logs: logs.map((l) => ({ ...l })), playerInput: "潜行", maxChars: 500, limit: 6 });
  assert.strictEqual(c.usedChars, a.usedChars);
  assert.deepStrictEqual(c.history, a.history);
});

test("buildContext respects a custom limit and never exceeds the per-entry cap", () => {
  const logs = makeLogs(10, 400);
  const ctx = context.buildContext({ save: SAVE, logs, playerInput: "观察", limit: 2, maxChars: 100000 });
  assert.strictEqual(ctx.history.length, 2);
  for (const item of ctx.history) {
    assert.ok(Array.from(item.content).length <= context.DEFAULT_MAX_ENTRY_CHARS);
  }
  assert.strictEqual(ctx.truncated, true);
});
