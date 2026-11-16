// F051 review 回归（BLOCKING 1）：七条既有 intent 恢复 main 的子串匹配语义。
// index.js 的 resolveAction 与 fallback.parse 共用本模块的 INTENT_MATCHERS，
// 这里直接断言共享解析函数 resolveIntent —— 即 /action 实际走的解析。
// Run: node --test server/ai/keywords.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const keywords = require("./keywords");
const fallback = require("./fallback");

test("resolveIntent: 指令词在句中也命中，/action 不得落占位（review 四句回归）", () => {
  const cases = [
    ["我要休息一下", "rest"],
    ["继续前进", "advance"],
    ["先观察四周", "observe"],
    ["查看状态", "status"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(keywords.resolveIntent(input), expected, `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, expected, `fallback.parse "${input}"`);
  }
});

test("resolveIntent: 影子三条仍句首锚定，叙述句不触发", () => {
  assert.equal(keywords.resolveIntent("影子出战 贝尔"), "shadow_deploy");
  assert.equal(keywords.resolveIntent("影子编队"), "shadow_formation");
  assert.equal(keywords.resolveIntent("影子撤回 贝尔"), "shadow_undeploy");
  assert.equal(keywords.resolveIntent("他说影子出战才算赢"), null);
});

test("resolveIntent: 无关键词/空输入返回 null（/action 走 unknown 占位）", () => {
  assert.equal(keywords.resolveIntent("阿巴阿巴"), null);
  assert.equal(keywords.resolveIntent(""), null);
  assert.equal(keywords.resolveIntent(42), null);
  assert.equal(fallback.parse("阿巴阿巴").intent, "observe");
});

// F137 review 回归：口语化攻击/脱离表述必须落到正确意图，
// 「离开」归 flee 不再被 advance 抢走；裸「打」仍不得进 attack。
test("resolveIntent: F137 意图覆盖（挥拳/出手/劈=attack，离开/撤离/回到=flee）", () => {
  const cases = [
    ["对着石像挥一拳", "attack"],
    ["出手打它", "attack"],
    ["劈它一刀", "attack"],
    ["挥拳打它", "attack"],
    ["揍他", "attack"],
    ["离开这里", "flee"],
    ["撤离副本", "flee"],
    ["回到第1章", "flee"],
    ["走人", "flee"],
    ["脱战", "flee"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(keywords.resolveIntent(input), expected, `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, expected, `fallback.parse "${input}"`);
  }
});

// F140 review 回归：「往回走」「回头」「退回去」「原路返回」是后退语义，
// 不得被 advance 的裸「走」抢走；「继续走」「向前走」必须仍是 advance。
test("resolveIntent: F140 后退词组归 flee，推进说法不被抢坏", () => {
  const cases = [
    ["往回走", "flee"],
    ["回头", "flee"],
    ["退回去", "flee"],
    ["原路返回", "flee"],
    ["继续走", "advance"],
    ["向前走", "advance"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(keywords.resolveIntent(input), expected, `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, expected, `fallback.parse "${input}"`);
  }
});

test("resolveIntent: F137 反例——裸「打」不吞非战斗输入", () => {
  // 「打开背包」「打招呼」绝不能落 attack；它们落 unknown/observe 都可以，
  // 唯一硬约束是不许结算成攻击。
  for (const input of ["打开背包", "打招呼", "打包行李"]) {
    assert.notEqual(keywords.resolveIntent(input), "attack", `resolveIntent "${input}"`);
    assert.notEqual(fallback.parse(input).intent, "attack", `fallback.parse "${input}"`);
  }
});
