// node:test coverage for F025 /ai-action hardening:
//   - 规则兜底解析器（fallback.parse）对常见输入返回白名单 intent
//   - ```json 围栏/前后叙述剥离（sanitize.extractJson + normalizeDecision 链路）
//   - 陈旧快照合并（validate.applyVitalsDelta）：增量套到新快照并夹紧
// Run: node --test server/ai/fallback.test.js
// 纯模块单测：不联网、不启服务、不依赖 3020 端口。

const test = require("node:test");
const assert = require("node:assert/strict");

const fallback = require("./fallback");
const sanitize = require("./sanitize");
const v = require("./validate");

// ── 规则解析器 ──────────────────────────────────────────────────

test("fallback.parse maps common inputs to whitelisted intents", () => {
  const cases = [
    ["继续前进", "advance"],
    ["explore ahead, advance", "advance"],
    ["休息一下", "rest"],
    ["rest now", "rest"],
    ["查看状态面板", "status"],
    ["help", "help"],
    ["潜行过去", "sneak"],
    ["保存存档", "save"],
  ];
  for (const [input, expected] of cases) {
    const r = fallback.parse(input);
    assert.equal(r.intent, expected, `input "${input}"`);
    assert.ok(v.INTENT_IDS.has(r.intent), `intent ${r.intent} must be whitelisted`);
    assert.deepEqual(r.args, {});
  }
});

test("fallback.parse maps shadow commands to the F051 intents", () => {
  const cases = [
    ["影子出战 伊格利特", "shadow_deploy"],
    ["出战 贝尔", "shadow_deploy"],
    ["影子撤回 伊格利特", "shadow_undeploy"],
    ["召回 贝尔", "shadow_undeploy"],
    ["影子编队", "shadow_formation"],
    ["影子", "shadow_formation"],
    ["查看影子", "shadow_formation"],
  ];
  for (const [input, expected] of cases) {
    const r = fallback.parse(input);
    assert.equal(r.intent, expected, `input "${input}"`);
    assert.ok(v.INTENT_IDS.has(r.intent), `intent ${r.intent} must be whitelisted`);
    assert.deepEqual(r.args, {});
  }
});

test("fallback.parse: 影子叙述句不触发影子指令；含既有指令词按子串语义命中", () => {
  // 「影子出战」不在句首 → 不触发 shadow_deploy；但句中「休息」沿用
  // main 的子串匹配语义命中 rest（与 /action 的 resolveAction 一致）。
  assert.equal(fallback.parse("我想让影子出战后休息").intent, "rest");
  for (const input of ["影子在风中飘散", "他说影子出战才算赢"]) {
    const r = fallback.parse(input);
    assert.equal(r.intent, "observe", `input "${input}"`);
  }
});

test("fallback.parse: 背包/观察类输入落到 observe", () => {
  for (const input of ["查看背包里有什么", "环顾四周", "look around"]) {
    const r = fallback.parse(input);
    assert.equal(r.intent, "observe", `input "${input}"`);
    assert.ok(v.INTENT_IDS.has(r.intent));
  }
});

test("fallback.parse never returns empty: garbage falls back to observe", () => {
  for (const input of ["asdfgh zzz qqq", "🌀🌀🌀", "", "   ", null, undefined, 42, {}]) {
    const r = fallback.parse(input);
    assert.equal(r.intent, "observe", `input ${JSON.stringify(input)}`);
    assert.ok(v.INTENT_IDS.has(r.intent));
  }
});

test("fallback.parse never throws on hostile input", () => {
  const hostile = [Symbol("x"), { toString() { throw new Error("boom"); } }];
  for (const input of hostile) {
    assert.doesNotThrow(() => fallback.parse(input));
  }
});

// ── 围栏剥离 ────────────────────────────────────────────────────

test("extractJson: bare JSON passes through", () => {
  const s = '{"intent":"rest","args":{}}';
  assert.equal(sanitize.extractJson(s), s);
});

test("extractJson strips ```json fences", () => {
  const r = sanitize.extractJson('```json\n{"intent":"rest","args":{}}\n```');
  assert.equal(JSON.parse(r).intent, "rest");
});

test("extractJson strips ``` fences without language tag", () => {
  const r = sanitize.extractJson('```\n{"intent":"sneak"}\n```');
  assert.equal(JSON.parse(r).intent, "sneak");
});

test("extractJson strips fences plus surrounding narration", () => {
  const raw =
    '好的，我来解析这个指令。\n```json\n{"intent":"advance","args":{}}\n```\n以上是解析结果。';
  const r = sanitize.extractJson(raw);
  assert.equal(JSON.parse(r).intent, "advance");
});

test("extractJson strips prose around bare JSON", () => {
  const r = sanitize.extractJson('决定如下：{"intent":"observe"} 完毕');
  assert.equal(JSON.parse(r).intent, "observe");
});

test("extractJson returns null for non-JSON / empty / non-string input", () => {
  assert.equal(sanitize.extractJson("没有任何对象"), null);
  assert.equal(sanitize.extractJson(""), null);
  assert.equal(sanitize.extractJson("   "), null);
  assert.equal(sanitize.extractJson(null), null);
  assert.equal(sanitize.extractJson(42), null);
  assert.equal(sanitize.extractJson("{}"), "{}"); // braces alone are extractable
});

test("normalizeDecision accepts fenced AI output end-to-end", () => {
  const fenced = '```json\n{"intent":"rest","args":{}}\n```';
  const r = v.normalizeDecision(fenced);
  assert.equal(r.ok, true);
  assert.equal(r.intent, "rest");
});

test("normalizeDecision accepts fenced output wrapped in narration", () => {
  const raw = '解析结果：\n```json\n{"intent":"sneak","args":{"direction":"left"}}\n```\n完毕。';
  const r = v.normalizeDecision(raw);
  assert.equal(r.ok, true);
  assert.equal(r.intent, "sneak");
  assert.deepEqual(r.args, { direction: "left" });
});

test("normalizeDecision: invalid JSON still degrades to code parse (never throws)", () => {
  for (const raw of ["```json\n{oops}\n```", "完全不是 JSON", '{"intent":"advance"']) {
    const r = v.normalizeDecision(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.code, "parse");
  }
});

test("sanitize + fallback chain: fenced garbage resolves to a whitelisted intent", () => {
  // Simulate the /ai-action degrade path without the server: normalizeDecision
  // fails → caller falls back to rule parsing of the original player input.
  const aiText = "```json\n{not valid at all}\n```";
  const decision = v.normalizeDecision(aiText);
  assert.equal(decision.ok, false);
  const rule = fallback.parse("休息一下");
  const intent = v.INTENT_IDS.has(rule.intent) ? rule.intent : "observe";
  assert.equal(intent, "rest");
});

// ── 陈旧快照合并 ────────────────────────────────────────────────

test("applyVitalsDelta reapplies the patch delta onto the fresh snapshot", () => {
  // AI 调用前 hp=50 → 模板算出 patch.hp=47（-3）。期间引擎把 hp 扣到 40。
  const base = { hp: 50, mp: 10, max_hp: 100, max_mp: 20 };
  const fresh = { hp: 40, mp: 10, max_hp: 100, max_mp: 20 };
  const patch = { hp: 47, mp: 8 }; // -3 hp / -2 mp relative to base
  const r = v.applyVitalsDelta(base, fresh, patch);
  assert.equal(r.hp, 37, "delta -3 must land on fresh 40, not roll back to 47");
  assert.equal(r.mp, 8);
});

test("applyVitalsDelta never lets values escape 0..max", () => {
  const base = { hp: 50, mp: 10, max_hp: 100, max_mp: 20 };
  const fresh = { hp: 5, mp: 19, max_hp: 100, max_mp: 20 };
  const r = v.applyVitalsDelta(base, fresh, { hp: 40, mp: 12 }); // -10 hp / +2 mp
  assert.equal(r.hp, 0, "5 - 10 clamps to 0");
  assert.equal(r.mp, 20, "19 + 2 clamps to max_mp");
});

test("applyVitalsDelta keeps fresh vitals when patch is empty or missing keys", () => {
  const base = { hp: 50, mp: 10, max_hp: 100, max_mp: 20 };
  const fresh = { hp: 40, mp: 7, max_hp: 100, max_mp: 20 };
  assert.deepEqual(v.applyVitalsDelta(base, fresh, {}), { hp: 40, mp: 7 });
  assert.deepEqual(v.applyVitalsDelta(base, fresh, { mp: 8 }), { hp: 40, mp: 5 });
});

test("applyVitalsDelta survives a missing fresh snapshot (falls back to base)", () => {
  const base = { hp: 50, mp: 10, max_hp: 100, max_mp: 20 };
  const r = v.applyVitalsDelta(base, null, { hp: 47 });
  assert.equal(r.hp, 47);
  assert.equal(r.mp, 10);
});

test("applyVitalsDelta never throws on garbage", () => {
  assert.doesNotThrow(() => v.applyVitalsDelta(null, undefined, "junk"));
  const r = v.applyVitalsDelta({}, {}, { hp: "x", mp: NaN });
  assert.ok(Number.isInteger(r.hp) && Number.isInteger(r.mp));
  assert.ok(r.hp >= 0 && r.mp >= 0);
});
