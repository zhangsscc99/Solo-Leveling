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
