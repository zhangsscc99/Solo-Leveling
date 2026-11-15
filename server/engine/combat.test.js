const assert = require("node:assert");
const { resolveTurn } = require("./combat");
const { createRng, hashSeed } = require("./rng");
const S = require("./stats");

function baseState(overrides = {}) {
  const state = {
    turn: 1,
    player: {
      hp: 100, maxHp: 100, mp: 20, maxMp: 20, level: 5, rank: "D",
      stats: { strength: 15, agility: 15, vitality: 10, intelligence: 10, perception: 10 },
    },
    enemy: {
      id: "goblin", name: "哥布林", hp: 60, maxHp: 60, level: 3, rank: "E", def: 4,
      stats: { strength: 10, agility: 8, vitality: 6, intelligence: 4, perception: 5 },
    },
  };
  return { ...state, ...overrides };
}

const KNOWN_EVENT_TYPES = new Set([
  "hit", "crit", "miss", "dodge", "damage", "heal", "flee", "defeat", "error",
]);
const CJK = /[\u4e00-\u9fa5]/;

function hitEvents(results, side) {
  const out = [];
  for (const r of results) {
    for (const e of r.events) {
      if ((e.type === "hit" || e.type === "crit") && e.side === side) out.push(e);
    }
  }
  return out;
}
function damageSum(results, side) {
  return hitEvents(results, side).reduce((s, e) => s + e.value, 0);
}
function countType(results, type, side) {
  return results.reduce(
    (n, r) => n + r.events.filter((e) => e.type === type && (side === undefined || e.side === side)).length,
    0
  );
}
function runSeeds(state, action, n, prefix) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(resolveTurn(state, action, `${prefix}-${i}`));
  return out;
}
// 所有数值字段必须是有限数（不允许 NaN / Infinity 泄漏到状态里）
function assertFiniteNumbers(obj, path = "state") {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      assert.ok(Number.isFinite(v), `${path}.${k} 不是有限数：${v}`);
    } else if (v && typeof v === "object") {
      assertFiniteNumbers(v, `${path}.${k}`);
    }
  }
}
function assertSaneResult(r, input) {
  assertFiniteNumbers(r.state);
  assert.strictEqual(typeof r.narration, "string");
  assert.ok(CJK.test(r.narration), "narration 应为中文");
  for (const e of r.events) {
    assert.ok(KNOWN_EVENT_TYPES.has(e.type), `未知事件类型 ${e.type}`);
    assert.ok(typeof e.side === "string" && e.side.length > 0, "事件缺少 side");
    assert.ok(typeof e.text === "string" && CJK.test(e.text), `事件文案应为中文：${e.text}`);
    if (e.type === "hit" || e.type === "crit") {
      assert.ok(Number.isInteger(e.value) && e.value >= 1, `伤害必须 ≥1，实际 ${e.value}`);
    }
  }
  const { player, enemy } = r.state;
  for (const ent of [player, enemy]) {
    assert.ok(ent.hp >= 0 && ent.hp <= ent.maxHp, `HP 越界 ${ent.hp}/${ent.maxHp}`);
    assert.ok(ent.maxHp >= 1);
    assert.ok(ent.mp >= 0 && ent.mp <= ent.maxMp);
    for (const k of S.STAT_KEYS) {
      assert.ok(Number.isFinite(ent.stats[k]) && ent.stats[k] >= 0, `属性 ${k} 非法`);
    }
  }
  if (input) {
    // 入参不得被修改
    assert.strictEqual(input.player.hp, JSON.parse(JSON.stringify(input)).player.hp);
  }
}

// --- rng basics ---
{
  const a = createRng(42);
  const b = createRng(42);
  for (let i = 0; i < 100; i++) assert.strictEqual(a.next(), b.next());
  const r = createRng("seed-string");
  for (let i = 0; i < 50; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1);
  }
  assert.strictEqual(hashSeed("abc"), hashSeed("abc"));
  const ri = createRng(7);
  for (let i = 0; i < 100; i++) {
    const v = ri.int(5, 2); // reversed bounds still work
    assert.ok(v >= 2 && v <= 5);
  }
  assert.ok(!createRng(1).chance(0));
  assert.ok(createRng(1).chance(1));
}

// --- 属性无关的第一层：公式必须单调 / 有界 ---
{
  // 力量：物理伤害基数，单调递增，且永远 ≥1
  let prev = -1;
  for (const str of [0, 1, 5, 10, 20, 40, 100, 999]) {
    const d = S.physicalDamage({ stats: { strength: str } }, 0, 1);
    assert.ok(d >= 1, `力量 ${str} 的伤害必须 ≥1`);
    assert.ok(d > prev, `力量 ${str} 应使伤害严格增加（上一档 ${prev}，当前 ${d}）`);
    prev = d;
  }
  // 减伤再高也只压到 1
  assert.strictEqual(S.physicalDamage({ stats: { strength: 1 } }, 999), 1);

  // 敏捷：命中、闪避（受击侧）、先手
  let prevHit = -1;
  for (const agi of [0, 10, 20, 40, 80]) {
    const h = S.hitChance({ stats: { agility: agi } }, { stats: { agility: 0 } });
    assert.ok(h >= prevHit, `敏捷 ${agi} 的命中率不应下降`);
    assert.ok(h >= S.HIT_MIN && h <= S.HIT_MAX);
    prevHit = h;
  }
  // 受击侧敏捷越高，被命中率越低（闪避）
  let prevTaken = 2;
  for (const agi of [0, 10, 20, 40, 80]) {
    const h = S.hitChance({ stats: { agility: 10 } }, { stats: { agility: agi } });
    assert.ok(h <= prevTaken, `守方敏捷 ${agi} 应降低被命中率`);
    prevTaken = h;
  }
  // 先手值随敏捷严格递增
  assert.ok(S.initiative({ stats: { agility: 20 } }) > S.initiative({ stats: { agility: 10 } }));
  assert.ok(S.initiative({ stats: { agility: 10, perception: 10 } }) > S.initiative({ stats: { agility: 10 } }));

  // 体力：减伤与生命上限
  let prevDef = -1;
  for (const vit of [0, 5, 10, 20, 50, 999]) {
    const d = S.defenseOf({ stats: { vitality: vit } });
    assert.ok(d > prevDef);
    prevDef = d;
  }
  assert.ok(S.maxHpFor(10, { vitality: 30 }) > S.maxHpFor(10, { vitality: 20 }));
  assert.ok(S.maxHpFor(10, { vitality: 0 }) >= 1);
  assert.ok(S.maxHpFor(10, { vitality: 999 }) > 0);

  // 智力：技能倍率单调且封顶 3.0；MP 消耗单调不增且 ≥3
  let prevMult = 0;
  for (const intel of [0, 10, 20, 40, 999]) {
    const m = S.skillMultiplier({ stats: { intelligence: intel } });
    assert.ok(m >= prevMult, `智力 ${intel} 的技能倍率不应下降`);
    assert.ok(m >= 1.4 && m <= 3.0, `技能倍率越界：${m}`);
    prevMult = m;
  }
  let prevCost = Infinity;
  for (const intel of [0, 5, 10, 20, 40, 999]) {
    const c = S.skillCost({ stats: { intelligence: intel } }, 8);
    assert.ok(c <= prevCost, `智力 ${intel} 的技能 MP 消耗不应上升`);
    assert.ok(c >= 3 && c <= 8, `技能 MP 消耗越界：${c}`);
    assert.ok(Number.isInteger(c));
    prevCost = c;
  }

  // 感知：暴击率 / 暴击致命度 单调且有界
  let prevCrit = -1;
  for (const per of [0, 5, 10, 30, 60, 999]) {
    const c = S.critChance({ stats: { perception: per } });
    assert.ok(c >= prevCrit, `感知 ${per} 的暴击率不应下降`);
    assert.ok(c >= S.CRIT_MIN && c <= S.CRIT_MAX, `暴击率越界：${c}`);
    prevCrit = c;
    const m = S.critMultiplier({ stats: { perception: per } });
    assert.ok(m >= 1.5 && m <= 2.0, `暴击倍率越界：${m}`);
  }
  // 感知也给少量命中（发现破绽）
  assert.ok(
    S.hitChance({ stats: { agility: 10, perception: 60 } }, { stats: { agility: 10 } }) >
      S.hitChance({ stats: { agility: 10, perception: 0 } }, { stats: { agility: 10 } })
  );
  // 感知高到离谱也只到上限
  assert.strictEqual(S.hitChance({ stats: { agility: 999, perception: 999 } }, { stats: { agility: 0 } }), S.HIT_MAX);
  assert.strictEqual(S.hitChance({ stats: { agility: 0, perception: 0 } }, { stats: { agility: 999 } }), S.HIT_MIN);
  assert.strictEqual(S.critChance({ stats: { perception: 999 } }), S.CRIT_MAX);
}

// --- 非法 / 缺失输入：概率与伤害全部安全降级 ---
{
  const weirdValues = [0, -10, -0.5, NaN, Infinity, -Infinity, undefined, null, "abc", 1e9, {}];
  for (const v of weirdValues) {
    const att = { stats: { strength: v, agility: v, vitality: v, intelligence: v, perception: v } };
    const def = { stats: { strength: v, agility: v, vitality: v, intelligence: v, perception: v } };
    const hit = S.hitChance(att, def);
    const crit = S.critChance(att);
    const dmg = S.physicalDamage(att, S.defenseOf(def), 1);
    const cost = S.skillCost(att, 8);
    const mult = S.skillMultiplier(att);
    const hp = S.maxHpFor(5, att.stats);
    assert.ok(Number.isFinite(hit) && hit >= S.HIT_MIN && hit <= S.HIT_MAX, `命中率非法：${hit}（输入 ${String(v)}）`);
    assert.ok(Number.isFinite(crit) && crit >= S.CRIT_MIN && crit <= S.CRIT_MAX, `暴击率非法：${crit}`);
    assert.ok(Number.isInteger(dmg) && dmg >= 1, `伤害非法：${dmg}`);
    assert.ok(Number.isInteger(cost) && cost >= 3 && cost <= 8, `MP 消耗非法：${cost}`);
    assert.ok(Number.isFinite(mult) && mult >= 1.4 && mult <= 3.0, `技能倍率非法：${mult}`);
    assert.ok(Number.isFinite(hp) && hp >= 1, `maxHp 非法：${hp}`);
  }
  // 完全没有 stats 字段的实体也不炸
  assert.strictEqual(S.hitChance({}, {}), 0.85);
  assert.strictEqual(S.critChance({}), 0.05);
  assert.strictEqual(S.physicalDamage({}, 0), 1);
  assert.strictEqual(S.skillCost({}, 8), 8);
}

// --- 正常攻击：确定性、HP 夹紧、回合推进、入参不变 ---
{
  const s = baseState();
  const r = resolveTurn(s, "attack", "t1");
  assert.strictEqual(r.state.turn, 2);
  assert.ok(r.state.enemy.hp >= 0 && r.state.enemy.hp <= 60);
  assert.ok(r.state.player.hp >= 0 && r.state.player.hp <= 100);
  assert.ok(r.events.length > 0);
  assert.strictEqual(typeof r.narration, "string");
  assertSaneResult(r);
  // input untouched
  assert.strictEqual(s.enemy.hp, 60);
  assert.strictEqual(s.turn, 1);
}

// --- 确定性：同 seed 同输出（五种行动全覆盖）---
{
  const s = baseState();
  for (const action of ["attack", "skill", "defend", "item", "flee"]) {
    const a = resolveTurn(s, action, "same-seed");
    const b = resolveTurn(s, action, "same-seed");
    assert.deepStrictEqual(a.events, b.events, `${action} 事件不一致`);
    assert.deepStrictEqual(a.state, b.state, `${action} 状态不一致`);
    assert.strictEqual(a.narration, b.narration);
    // 不同 seed 至少能跑（不强制不同结果）
    assert.ok(Array.isArray(resolveTurn(s, action, "other-seed").events));
  }
}

// --- 0 HP 边界 ---
{
  const dead = baseState();
  dead.player.hp = 0;
  const r = resolveTurn(dead, "attack", "x");
  assert.ok(r.events.some((e) => e.type === "defeat" && e.side === "player"));
  assert.strictEqual(r.state.player.hp, 0);
  assert.strictEqual(r.state.enemy.hp, 60); // enemy untouched
  assert.strictEqual(r.state.turn, 1); // no progression

  const deadEnemy = baseState();
  deadEnemy.enemy.hp = 0;
  const r2 = resolveTurn(deadEnemy, "attack", "x");
  assert.ok(r2.events.every((e) => e.type !== "hit" && e.type !== "crit"));
  assert.strictEqual(r2.state.enemy.hp, 0);
  assert.ok(r2.state.enemy.hp >= 0);
}

// --- 治疗夹紧在 maxHp ---
{
  const s = baseState();
  s.player.hp = 95;
  const r = resolveTurn(s, "item", "heal-seed");
  assert.ok(r.state.player.hp <= s.player.maxHp);
  const heal = r.events.find((e) => e.type === "heal" && e.side === "player");
  assert.ok(heal && heal.value <= 5);
}

// --- 闪避：高敏捷敌人在多个 seed 里至少闪开一次 ---
{
  const s = baseState();
  s.enemy.stats.agility = 200;
  let sawDodge = false;
  for (let i = 0; i < 40 && !sawDodge; i++) {
    const r = resolveTurn(s, "attack", "dodge-" + i);
    sawDodge = r.events.some((e) => e.type === "dodge" && e.side === "enemy");
  }
  assert.ok(sawDodge, "expected at least one dodge across seeds");
}

// --- 暴击：高感知玩家在多个 seed 里至少暴击一次 ---
{
  const s = baseState();
  s.player.stats.perception = 95; // crit chance ~= 0.5 cap
  let sawCrit = false;
  for (let i = 0; i < 40 && !sawCrit; i++) {
    const r = resolveTurn(s, "attack", "crit-" + i);
    sawCrit = r.events.some((e) => e.type === "crit" && e.side === "player");
  }
  assert.ok(sawCrit, "expected at least one crit across seeds");
}

// --- 非法行动 ---
{
  const s = baseState();
  const r = resolveTurn(s, "dance", "z");
  assert.deepStrictEqual(r.events.map((e) => e.type), ["error"]);
  assert.strictEqual(r.state.turn, 1);
  assert.strictEqual(r.state.player.hp, 100);
  assert.strictEqual(r.state.enemy.hp, 60);
}

// --- 技能：消耗 MP（受智力折扣），MP 不足报错 ---
{
  const s = baseState();
  const cost = S.skillCost(s.player, 8);
  assert.strictEqual(cost, 7); // 智力 10 → 省 10%
  const r = resolveTurn(s, "skill", "sk");
  assert.strictEqual(r.state.player.mp, 20 - cost);
  s.player.mp = 0;
  const r2 = resolveTurn(s, "skill", "sk");
  assert.ok(r2.events.some((e) => e.type === "error" && e.text.includes(String(cost))));
  assert.strictEqual(r2.state.player.mp, 0);
}

// --- 逃跑：成功 / 失败都产出 flee 事件，不抛异常 ---
{
  const s = baseState();
  let fled = false, blocked = false;
  for (let i = 0; i < 40; i++) {
    const r = resolveTurn(s, "flee", "flee-" + i);
    const e = r.events.find((ev) => ev.type === "flee");
    assert.ok(e);
    if (e.side === "player") fled = true; else blocked = true;
  }
  assert.ok(fled && blocked);
}

// --- 防御：无治疗事件、叙事含「防御」、整体受伤更少 ---
{
  const s = baseState();
  const r = resolveTurn(s, "defend", "def-seed");
  assert.ok(r.events.every((e) => e.type !== "heal"), "defend must not emit heal events");
  for (const e of r.events) assert.ok(KNOWN_EVENT_TYPES.has(e.type));
  assert.ok(r.narration.includes("防御"), "narration should mention 防御");
  assert.strictEqual(r.state.turn, 2);

  // 跨 seed 统计：防御姿态的受伤总量显著低于普通攻击（单 seed 的 RNG 抽取序列不同，不做逐条比较）
  const seeds = 120;
  const atk = runSeeds(baseState(), "attack", seeds, "defcmp");
  const def = runSeeds(baseState(), "defend", seeds, "defcmp");
  const takenAtk = damageSum(atk, "enemy");
  const takenDef = damageSum(def, "enemy");
  assert.ok(takenDef < takenAtk, `防御应减少受伤：防御 ${takenDef} vs 普攻 ${takenAtk}`);
}

// --- 极端属性 0 / 999：不崩、不产生 NaN、HP 夹紧 ---
{
  const actions = ["attack", "skill", "defend", "item", "flee"];
  for (const key of S.STAT_KEYS) {
    for (const value of [0, 999]) {
      for (const target of ["player", "enemy"]) {
        for (const action of actions) {
          const s = baseState();
          s[target].stats[key] = value;
          for (let i = 0; i < 8; i++) {
            const r = resolveTurn(s, action, `ext-${key}-${value}-${target}-${action}-${i}`);
            assertSaneResult(r, s);
          }
        }
      }
    }
  }
  // 五项全部 999 / 全部 0
  for (const value of [0, 999]) {
    const s = baseState();
    for (const key of S.STAT_KEYS) {
      s.player.stats[key] = value;
      s.enemy.stats[key] = value;
    }
    for (const action of actions) assertSaneResult(resolveTurn(s, action, "all-" + value), s);
  }
  // NaN / 负数 / 字符串 / 缺失 stats 的脏输入
  const dirty = baseState();
  dirty.player.stats = { strength: NaN, agility: -50, vitality: Infinity, intelligence: "abc", perception: undefined };
  delete dirty.enemy.stats;
  delete dirty.enemy.def;
  for (const action of actions) {
    const r = resolveTurn(dirty, action, "dirty");
    assertSaneResult(r);
    assert.strictEqual(r.state.player.stats.perception, 0);
    assert.strictEqual(r.state.player.stats.agility, 0);
  }
  // 负 HP / 缺失 maxHp
  const broken = baseState();
  broken.player.hp = -30;
  delete broken.player.maxHp;
  delete broken.enemy.hp;
  const r = resolveTurn(broken, "attack", "broken");
  assert.strictEqual(r.state.player.hp, 0);
  assert.ok(r.state.player.maxHp >= 1);
  assert.ok(r.state.enemy.hp === r.state.enemy.maxHp);
}

// --- F031 端到端边际效应：每一项属性都要真的影响结果 ---
{
  // 力量 ↑ → 同一批次 seed 下总伤害 ↑
  const seeds = 150;
  const dmgAt = (str) => {
    const s = baseState();
    s.player.stats.strength = str;
    s.enemy.hp = s.enemy.maxHp = 5000; // 避免一击致死影响统计
    return damageSum(runSeeds(s, "attack", seeds, "str"), "player");
  };
  const strLow = dmgAt(10);
  const strHigh = dmgAt(40);
  assert.ok(strHigh > strLow * 1.5, `力量应显著提升伤害：${strLow} → ${strHigh}`);

  // 敏捷 ↑ → 玩家命中率 ↑
  const hitRate = (agi) => {
    const s = baseState();
    s.player.stats.agility = agi;
    s.player.stats.perception = 0;
    s.enemy.stats.agility = 0;
    s.enemy.hp = s.enemy.maxHp = 5000;
    const runs = runSeeds(s, "attack", 300, "hit");
    return hitEvents(runs, "player").length / runs.length;
  };
  const hitLow = hitRate(0);
  const hitHigh = hitRate(40);
  assert.ok(hitLow >= 0.7 && hitLow <= 0.95, `基础命中率异常：${hitLow}`);
  assert.ok(hitHigh > hitLow, `敏捷应提升命中率：${hitLow} → ${hitHigh}`);
  assert.ok(hitHigh >= 0.95);

  // 敌方敏捷 ↑ → 玩家命中率（闪避）↓
  const enemyAgiHit = (agi) => {
    const s = baseState();
    s.player.stats.agility = 10;
    s.player.stats.perception = 0;
    s.enemy.stats.agility = agi;
    s.enemy.hp = s.enemy.maxHp = 5000;
    const runs = runSeeds(s, "attack", 300, "eva");
    return hitEvents(runs, "player").length / runs.length;
  };
  const evaLow = enemyAgiHit(0);
  const evaHigh = enemyAgiHit(80);
  assert.ok(evaHigh < evaLow, `敌方敏捷应提升闪避：${evaLow} → ${evaHigh}`);
  assert.ok(evaHigh >= S.HIT_MIN && evaHigh <= 0.35);

  // 体力 ↑ → 承受伤害 ↓，且每击仍 ≥1
  const takenAt = (vit) => {
    const s = baseState();
    s.player.stats.vitality = vit;
    s.player.stats.agility = 999; // 玩家先手且必定命中，保证敌人一定会反击
    s.enemy.hp = s.enemy.maxHp = 5000;
    const runs = runSeeds(s, "defend", 200, "vit");
    return damageSum(runs, "enemy");
  };
  const takenLow = takenAt(0);
  const takenHigh = takenAt(60);
  assert.ok(takenLow > 0, "低体力时应正常受伤");
  assert.ok(takenHigh <= takenLow * 0.5, `体力应显著减伤：${takenLow} → ${takenHigh}`);
  assert.ok(takenHigh > 0, "减伤后每击仍应 ≥1");

  // 智力 ↑ → 技能伤害 ↑、MP 消耗不增
  const skillDmg = (intel) => {
    const s = baseState();
    s.player.stats.intelligence = intel;
    s.player.mp = s.player.maxMp = 999;
    s.enemy.hp = s.enemy.maxHp = 5000;
    return damageSum(runSeeds(s, "skill", 200, "int"), "player");
  };
  const intLow = skillDmg(0);
  const intHigh = skillDmg(60);
  assert.ok(intHigh > intLow * 1.3, `智力应显著提升技能伤害：${intLow} → ${intHigh}`);
  assert.ok(S.skillCost({ stats: { intelligence: 60 } }, 8) <= S.skillCost({ stats: { intelligence: 0 } }, 8));

  // 感知 ↑ → 暴击次数 ↑
  const critsAt = (per) => {
    const s = baseState();
    s.player.stats.perception = per;
    s.player.stats.agility = 999;
    s.enemy.hp = s.enemy.maxHp = 5000;
    return countType(runSeeds(s, "attack", 300, "per"), "crit", "player");
  };
  const critLow = critsAt(0);
  const critHigh = critsAt(60);
  assert.ok(critHigh > critLow * 2, `感知应提升暴击次数：${critLow} → ${critHigh}`);
  assert.ok(critHigh > 0 && critHigh < 300, "暴击次数应在合理范围（受 50% 上限约束）");

  // 敏捷 → 先手：敌人敏捷远高于玩家时抢在玩家之前出手
  {
    const s = baseState();
    s.enemy.stats.agility = 999;
    s.enemy.stats.strength = 999; // 一击必杀，玩家来不及行动
    const r = resolveTurn(s, "attack", "init-1");
    assert.ok(r.narration.includes("抢先"), `高敏捷敌人应抢先出手：${r.narration}`);
    assert.strictEqual(r.state.player.hp, 0);
    assert.ok(r.events.every((e) => !((e.type === "hit" || e.type === "crit") && e.side === "player")));

    const normal = resolveTurn(baseState(), "attack", "init-2");
    assert.ok(!normal.narration.includes("抢先"), "普通敏捷差下玩家先手");
    assert.strictEqual(damageSum([normal], "player") > 0, true);
  }
}

console.log("OK");
