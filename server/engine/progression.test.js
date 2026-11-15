const assert = require("node:assert/strict");
const path = require("path");
const { xpToNext, applyXp, spendPoint } = require("./progression");
const LEVELS = require(path.join(__dirname, "..", "data", "levels.json"));

function baseState(over = {}) {
  return {
    level: 1,
    xp: 0,
    rank: "E",
    hp: 50,
    mp: 5,
    maxHp: 100,
    maxMp: 20,
    freePoints: 0,
    stats: { strength: 10, agility: 12, vitality: 8, intelligence: 10, perception: 14 },
    ...over,
  };
}

// 1. 单级升级
{
  const need = xpToNext(1);
  const { state, events } = applyXp(baseState(), need);
  assert.equal(state.level, 2);
  assert.equal(state.xp, 0);
  assert.ok(events.some((e) => e.type === "levelup" && e.level === 2));
  assert.equal(state.freePoints, 3);
  assert.equal(state.hp, state.maxHp);
  assert.equal(state.mp, state.maxMp);
}

// 2. 跨多级连升 + 溢出经验保留
{
  const total = xpToNext(1) + xpToNext(2) + xpToNext(3) + 7;
  const { state, events } = applyXp(baseState(), total);
  assert.equal(state.level, 4);
  assert.equal(state.xp, 7);
  assert.equal(events.filter((e) => e.type === "levelup").length, 3);
}

// 3. 满级封顶
{
  const { state } = applyXp(baseState({ level: 60, xp: 0 }), 999999);
  assert.equal(state.level, 60);
  assert.equal(state.xp, 0);
  const { state: s2 } = applyXp(baseState({ level: 59 }), 10 ** 7);
  assert.equal(s2.level, 60);
  assert.equal(s2.xp, 0);
}

// 4. 非法属性 → 错误事件，不抛异常
{
  const { state, events } = spendPoint(baseState({ freePoints: 3 }), "luck");
  assert.equal(events[0].type, "error");
  assert.equal(state.freePoints, 3);
}

// 5. 无剩余点 → 错误事件
{
  const { state, events } = spendPoint(baseState(), "strength");
  assert.equal(events[0].type, "error");
  assert.equal(state.stats.strength, 10);
}

// 5b. 正常加点 + vitality/intelligence 提升上限
{
  const s0 = baseState({ freePoints: 2 });
  const { state: s1 } = spendPoint(s0, "vitality");
  assert.equal(s1.stats.vitality, 9);
  assert.equal(s1.freePoints, 1);
  assert.ok(s1.maxHp > s0.maxHp);
  const { state: s2 } = spendPoint(s1, "intelligence");
  assert.ok(s2.maxMp > s1.maxMp);
}

// 6. 纯函数性：入参不被修改
{
  const s0 = baseState({ freePoints: 5 });
  const snapshot = JSON.parse(JSON.stringify(s0));
  const a = applyXp(s0, xpToNext(1) * 3);
  const b = spendPoint(s0, "strength");
  assert.deepEqual(s0, snapshot);
  assert.notEqual(a.state, s0);
  assert.notEqual(b.state, s0);
  const c = spendPoint(s0, "luck");
  assert.deepEqual(c.state, snapshot, "非法加点不应改动任何字段");
}

// 6b. gained<=0 不变
{
  const s0 = baseState();
  const { state, events } = applyXp(s0, 0);
  assert.equal(state.level, 1);
  assert.equal(events.length, 0);
  assert.deepEqual(applyXp(s0, -50).events, []);
}

// 7. levels.json 曲线检查
{
  assert.equal(LEVELS.length, 60);
  const rankAt = {};
  for (let i = 0; i < LEVELS.length; i++) {
    const e = LEVELS[i];
    assert.equal(e.level, i + 1);
    assert.ok(Number.isInteger(e.xpToNext) && e.xpToNext > 0, `xpToNext 必须是正整数（Lv.${e.level}）`);
    assert.ok(Number.isInteger(e.freePoints) && e.freePoints > 0);
    if (e.rank) rankAt[e.level] = e.rank;
    if (i > 0) {
      assert.ok(e.xpToNext > LEVELS[i - 1].xpToNext, `xpToNext 非单调递增：Lv.${e.level}`);
    }
    if (e.level < 60) assert.equal(xpToNext(e.level), e.xpToNext, `xpToNext(${e.level}) 与曲线不一致`);
  }
  // 早期平缓、后期陡：末段每级增量应显著大于首段
  const early = LEVELS[1].xpToNext - LEVELS[0].xpToNext;
  const late = LEVELS[59].xpToNext - LEVELS[58].xpToNext;
  assert.ok(late > early * 2, "曲线后段应明显陡于前段");
  assert.equal(LEVELS[0].freePoints, 3, "早期每级 3 点");
  assert.equal(LEVELS[59].freePoints, 5, "后期每级 5 点");
  assert.deepEqual(rankAt, { 10: "D", 20: "C", 30: "B", 40: "A", 50: "S" });
  assert.equal(xpToNext(0), 0);
  assert.equal(xpToNext(-3), 0);
  assert.equal(xpToNext(60), 0, "满级无下一级");
  assert.equal(xpToNext(999), 0);
  assert.equal(xpToNext("x"), 0);
  assert.equal(xpToNext(undefined), 0);
}

// rank 晋升事件
{
  const s = baseState({ level: 9, rank: "E" });
  const { state, events } = applyXp(s, xpToNext(9));
  assert.equal(state.level, 10);
  assert.equal(state.rank, "D");
  assert.ok(events.some((e) => e.type === "rankup" && e.rank === "D"));
  const msgs = events.filter((e) => e.message).map((e) => e.message).join("|");
  assert.ok(/Lv\.10/.test(msgs) && /属性点/.test(msgs), "升级播报应含等级与属性点");
}

console.log("OK");
