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

// F144/F145 review 回归：「使用/服用/喝/吃 + 药名」归 item；
// 「释放技能 X」「使用技能 X」必须仍走 skill，不被 item 抢走。
test("resolveIntent: F144 点名补给归 item，技能说法不被 item 抢走", () => {
  const cases = [
    ["使用治疗药水", "item"],
    ["喝治疗药水", "item"],
    ["服用魔力药剂", "item"],
    ["使用道具 低级治疗药水", "item"],
    ["喝药", "item"],
    ["释放技能 猛虎猛击", "skill"],
    ["使用技能 猛虎猛击", "skill"],
    ["施放技能", "skill"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(keywords.resolveIntent(input), expected, `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, expected, `fallback.parse "${input}"`);
  }
});

test("resolveIntent: F144 反例——喝彩/吃面不落 item", () => {
  for (const input of ["喝彩", "吃面", "吃饭"]) {
    assert.notEqual(keywords.resolveIntent(input), "item", `resolveIntent "${input}"`);
    assert.notEqual(fallback.parse(input).intent, "item", `fallback.parse "${input}"`);
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

// F150 review 回归：守关者门前的文字叫阵与主按钮「叫阵守关者」同一个
// 真实入口——「叫阵」「挑战」「叫阵守关者」必须归 attack，不落 unknown。
test("resolveIntent: F150 叫阵/挑战归 attack（含叫阵守关者）", () => {
  for (const input of ["叫阵", "挑战", "叫阵守关者", "向守关者叫阵", "挑战它"]) {
    assert.equal(keywords.resolveIntent(input), "attack", `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, "attack", `fallback.parse "${input}"`);
  }
});

// F151 review 回归：疑问句形态（？结尾 / 还是 / 吗 / 要不要 / 是不是）
// 不命中战斗意图——系统兜底句被复述回输入时不得结算成一次攻击；
// 正常陈述句的攻击说法照旧生效。
test("resolveIntent: F151 疑问句不命中战斗意图，陈述句照旧", () => {
  const questions = [
    "你是想攻击还是想离开？",
    "你想攻击还是想离开?",
    "要不要攻击它",
    "攻击它行吗",
    "我是不是该攻击",
    "攻击还是防御",
    "要不要逃跑？",
    "要不要继续前进？",
  ];
  for (const input of questions) {
    const got = keywords.resolveIntent(input);
    assert.notEqual(got, "attack", `resolveIntent "${input}" -> ${got}`);
    assert.notEqual(got, "flee", `resolveIntent "${input}" -> ${got}`);
    assert.notEqual(got, "advance", `resolveIntent "${input}" -> ${got}`);
    assert.notEqual(fallback.parse(input).intent, "attack", `fallback.parse "${input}"`);
  }
  for (const input of ["攻击", "我攻击它", "攻击它", "我攻击它，然后离开"]) {
    assert.equal(keywords.resolveIntent(input), "attack", `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, "attack", `fallback.parse "${input}"`);
  }
});

// F154 review 回归：「使用 X」要补给词尾才判 item——「喝水」「喝彩」
// 「使用钥匙开门」不烧补给；点名真实补给仍生效，背包里词尾表之外的
// 补给全名被点名时由 supplyNames 兜底接住。
test("resolveIntent: F154 item 意图收窄 + 点名兜底", () => {
  for (const input of ["喝水", "喝彩", "使用钥匙开门", "使用 力量加点", "吃面"]) {
    assert.notEqual(keywords.resolveIntent(input), "item", `resolveIntent "${input}"`);
    assert.notEqual(fallback.parse(input).intent, "item", `fallback.parse "${input}"`);
  }
  for (const input of ["使用治疗药水", "喝魔力药剂", "使用道具", "使用圣水", "喝低级治疗药水", "吃药"]) {
    assert.equal(keywords.resolveIntent(input), "item", `resolveIntent "${input}"`);
    assert.equal(fallback.parse(input).intent, "item", `fallback.parse "${input}"`);
  }
  // 词尾表之外的补给名：使用动词 + 点名背包实有补给 → item；
  // 没点名（「喝水」对「生命圣水」）或没搭使用动词都不算。
  assert.equal(keywords.resolveIntent("喝能量饮", ["能量饮"]), "item");
  assert.equal(keywords.resolveIntent("喝能量饮", []), null);
  assert.equal(keywords.resolveIntent("喝水", ["生命圣水"]), null);
  assert.equal(keywords.resolveIntent("背包里有能量饮", ["能量饮"]), null);
});
