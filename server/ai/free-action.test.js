// node:test coverage for F162 free-action 「动作+对象」解析：
//   extractEntities  名词短语候选抽取（量词/形容词/把字句/的-结构剥皮）
//   resolveTarget    共指消解四级优先级（点名在表 → 点名具体物 →
//                    场景默认 → 四周）与 exists_in_scene 判定
//   verbFamily       拾取族与查看族分流（拾取优先）
//   pickupOutcome    三态后果：可带走 / 嵌死 / 明确否认——否认句必须
//                    同时带拾取动词与否认词，可带走句不得假装入包
// Run: node --test server/ai/free-action.test.js
// 纯模块单测：不联网、不启服务、不依赖数据库。

const test = require("node:test");
const assert = require("node:assert/strict");

const fa = require("./free-action");

const ENTITIES = [
  "石像", "石碑", "石阶", "台阶", "祭坛", "石柱", "石门", "长明灯",
  "壁画", "石座", "光幕", "沙地", "兽骨", "火盆", "画像", "冰面",
  "刻痕", "血迹",
];

// ch1_double_gate 正文摘句：在场实体 = 石门/长明灯/壁画/石像。
const BLOB =
  "D 级委托·石门之下\n石门在矿灯下泛着潮湿的灰光。通道比地图标注的深得多，" +
  "本该出现的岔路变成一座空旷石殿：长明灯、斑驳壁画，还有一整圈靠墙而立" +
  "的人形石像。身后的石门就在这时合拢了。";

// ── extractEntities ─────────────────────────────────────────────────

test("extractEntities: 量词+形容词剥皮，头名词在候选里", () => {
  const r = fa.extractEntities("我蹲下身，捡起地上一枚发烫的碎片");
  assert.ok(r.includes("碎片"), JSON.stringify(r));
  // 最长匹配优先：完整名词短语排在头名词之前
  assert.ok(r.indexOf("发烫的碎片") < r.indexOf("碎片"), JSON.stringify(r));
});

test("extractEntities: 指示词+否定形容词剥皮", () => {
  const r = fa.extractEntities("我捡起那把不存在的青铜钥匙");
  assert.ok(r.includes("青铜钥匙"), JSON.stringify(r));
});

test("extractEntities: 方位前缀剥皮", () => {
  const r = fa.extractEntities("我捡起地上的石屑");
  assert.ok(r.includes("石屑"), JSON.stringify(r));
});

test("extractEntities: 把字句宾语在动词左边也能切出来", () => {
  const r = fa.extractEntities("我把钥匙揣进怀里");
  assert.ok(r.includes("钥匙"), JSON.stringify(r));
});

test("extractEntities: 畸形输入不抛、返回数组", () => {
  for (const bad of [null, undefined, 42, {}, "", "   ", "!!!"]) {
    const r = fa.extractEntities(bad);
    assert.ok(Array.isArray(r), JSON.stringify(bad));
  }
});

// ── resolveTarget ───────────────────────────────────────────────────

test("resolveTarget: ① 玩家点名且在实体表 → 用该实体", () => {
  const r = fa.resolveTarget("我摸摸那座石像", ENTITIES, BLOB);
  assert.equal(r.target, "石像");
  assert.equal(r.named_by_player, true);
  assert.equal(r.exists_in_scene, true);
});

test("resolveTarget: ② 点名不在表的具体物 → 仍认玩家所指", () => {
  const r = fa.resolveTarget(
    "我蹲下身，捡起地上一枚发烫的碎片",
    ENTITIES,
    BLOB
  );
  assert.equal(r.target, "碎片");
  assert.equal(r.named_by_player, true);
  assert.equal(r.exists_in_scene, false);
});

test("resolveTarget: 场景正文里真有该物 → exists_in_scene=true 即使不在表", () => {
  const r = fa.resolveTarget("我捡起那把矿灯", ENTITIES, BLOB);
  assert.equal(r.target, "矿灯");
  assert.equal(r.named_by_player, true);
  assert.equal(r.exists_in_scene, true);
});

test("resolveTarget: 表内实体不在场 → exists_in_scene=false（点名了非场景物）", () => {
  const r = fa.resolveTarget("我蹲下检查石阶上的刻痕", ENTITIES, BLOB);
  assert.equal(r.target, "刻痕");
  assert.equal(r.named_by_player, true);
  assert.equal(r.exists_in_scene, false);
});

test("resolveTarget: ③ 没点名 → 场景默认实体；④ 无场景 → 四周", () => {
  const r = fa.resolveTarget("我摸一摸", ENTITIES, BLOB);
  assert.equal(r.target, "石像");
  assert.equal(r.named_by_player, false);
  const none = fa.resolveTarget("我摸一摸", ENTITIES, "");
  assert.equal(none.target, "四周");
  assert.equal(none.named_by_player, false);
});

test("resolveTarget: 环境词不算点名（动静/空气）", () => {
  for (const inp of ["我听一听周围的动静", "我闻了一下空气"]) {
    const r = fa.resolveTarget(inp, ENTITIES, BLOB);
    assert.equal(r.named_by_player, false, inp);
    assert.equal(r.target, "石像", inp);
  }
});

// ── verbFamily ──────────────────────────────────────────────────────

test("verbFamily: 拾取动词识别，且优先于查看", () => {
  for (const inp of [
    "我蹲下身，捡起地上一枚发烫的碎片",
    "拾起那块骨头",
    "把钥匙揣进怀里",
    "我拿起那盏长明灯",
    "收进背包",
  ]) {
    assert.equal(fa.verbFamily(inp), "pickup", inp);
  }
});

test("verbFamily: 查看动词识别", () => {
  for (const inp of ["我摸摸石碑", "敲一敲墙", "仔细端详壁画", "我蹲下来看看"]) {
    assert.equal(fa.verbFamily(inp), "inspect", inp);
  }
});

test("verbFamily: 听/闻不成拾取也不成查看", () => {
  assert.equal(fa.verbFamily("我听一听周围的动静"), null);
  assert.equal(fa.verbFamily("我闻一下空气"), null);
});

// ── pickupOutcome ───────────────────────────────────────────────────

test("pickupOutcome: 不存在 → 明确否认 + 拾取动词 + 不得偷换场景物", () => {
  for (let v = 0; v < 3; v++) {
    const line = fa.pickupOutcome(
      "我捡起那把不存在的青铜钥匙",
      "青铜钥匙",
      false,
      { anchor: "石像和石门", variant: v }
    );
    assert.match(line, /没有/, line);
    assert.match(line, /[捡拾收拿]/, line);
    assert.match(line, /青铜钥匙/, line);
    // 场景实体只能出现在「只有…」的否认部分，不得当宾语
    assert.ok(!line.startsWith(`你捡起石像`), line);
  }
});

test("pickupOutcome: 存在但带不走 → 纹丝不动", () => {
  const line = fa.pickupOutcome("我拿起那盏长明灯", "长明灯", true, {
    takeable: false,
    variant: 0,
  });
  assert.match(line, /长明灯/, line);
  assert.match(line, /纹丝不动/, line);
  assert.ok(!/背包/.test(line), line);
});

test("pickupOutcome: 可带走 → 拾取动词 + 诚实标注没入包", () => {
  for (let v = 0; v < 3; v++) {
    const line = fa.pickupOutcome("我捡起兽骨", "兽骨", true, {
      takeable: true,
      variant: v,
    });
    assert.match(line, /[捡拾起]/, line);
    assert.match(line, /兽骨/, line);
    assert.match(line, /没带走什么值钱的/, line);
  }
});

test("denyLine: 查看族点名非场景物 → 否认句含目标与否认词", () => {
  const line = fa.denyLine("玉佩", "石像和石门", 0);
  assert.match(line, /玉佩/, line);
  assert.match(line, /没有|没找到/, line);
});

test("sceneAnchor: 场景在场实体拼接，缺省给中性说法", () => {
  assert.equal(fa.sceneAnchor(ENTITIES, BLOB), "石像和石门");
  assert.equal(fa.sceneAnchor(ENTITIES, ""), "四壁的陈设");
});
