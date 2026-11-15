// F050 影子提取（Arise）引擎单测。
// 运行：env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE node --test server/engine/shadow.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const shadow = require("./shadow");
const statsLib = require("./stats");

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------

function makePlayer(overrides = {}) {
  return {
    id: 1,
    name: "成振宇",
    level: 20,
    hp: 100,
    maxHp: 100,
    stats: { strength: 20, agility: 22, vitality: 18, intelligence: 20, perception: 14 },
    ...overrides,
  };
}

function makeEnemy(overrides = {}) {
  return {
    id: "dungeon_wolf",
    name: "地下城狼",
    rank: "E",
    level: 5,
    hp: 0,
    skills: ["撕咬", "低吼"],
    ...overrides,
  };
}

function deadEnemy(overrides = {}) {
  return makeEnemy({ hp: 0, ...overrides });
}

// 找出能让判定成功 / 失败的 seed（成功率 <= 0.95，两种分支必然都能构造出来）。
function findRoll(enemy, player, wantSuccess) {
  for (let seed = 0; seed < 2000; seed += 1) {
    const result = shadow.rollExtraction({ enemy, player, seed, now: 1700000000000 });
    if (result.success === wantSuccess) return { seed, result };
  }
  throw new Error(`未找到 success=${wantSuccess} 的 seed`);
}

// ---------------------------------------------------------------------------
// canExtract
// ---------------------------------------------------------------------------

test("canExtract: 敌人存活（hp>0）时拒绝提取", () => {
  const res = shadow.canExtract({ enemy: makeEnemy({ hp: 12 }), player: makePlayer() });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "enemy_alive");
});

test("canExtract: 敌人 hp<=0 且玩家存活时允许", () => {
  const res = shadow.canExtract({ enemy: deadEnemy(), player: makePlayer() });
  assert.deepEqual(res, { ok: true, reason: "ok" });
});

test("canExtract: 战斗事件为 enemy 的 defeat 也算已死亡", () => {
  const events = [
    { type: "hit", side: "player", value: 10 },
    { type: "defeat", side: "enemy", text: "地下城狼倒下了" },
  ];
  const enemy = makeEnemy({ hp: 30 }); // 状态里 hp 未同步，但事件已判定击败
  const res = shadow.canExtract({ enemy, player: makePlayer(), events });
  assert.equal(res.ok, true);
  assert.equal(res.reason, "ok");

  const alive = makeEnemy({ hp: 30, defeated: false });
  assert.equal(shadow.canExtract({ enemy: alive, player: makePlayer(), events: [] }).reason, "enemy_alive");
});

test("canExtract: 玩家死亡 / 实体缺失 / 已提取 都拒绝", () => {
  assert.equal(
    shadow.canExtract({ enemy: deadEnemy(), player: makePlayer({ hp: 0 }) }).reason,
    "player_dead",
  );
  assert.equal(shadow.canExtract({ enemy: null, player: makePlayer() }).reason, "missing_enemy");
  assert.equal(shadow.canExtract({ enemy: deadEnemy(), player: null }).reason, "missing_player");
  assert.equal(shadow.canExtract({}).reason, "missing_enemy");
  assert.equal(shadow.canExtract().reason, "missing_enemy");
  assert.equal(
    shadow.canExtract({ enemy: deadEnemy({ arisen: true }), player: makePlayer() }).reason,
    "already_extracted",
  );
});

test("canExtract: Boss 需要更高玩家等级（S→40 / A→30），普通小怪无此限制", () => {
  const bossS = deadEnemy({ id: "boss_ant", name: "蚁王", rank: "S", level: 50, isBoss: true });

  assert.equal(shadow.canExtract({ enemy: bossS, player: makePlayer({ level: 30 }) }).reason, "boss_rank_locked");
  assert.equal(shadow.canExtract({ enemy: bossS, player: makePlayer({ level: 39 }) }).reason, "boss_rank_locked");
  assert.equal(shadow.canExtract({ enemy: bossS, player: makePlayer({ level: 40 }) }).ok, true);

  const bossA = deadEnemy({ rank: "A", level: 40, boss: true });
  assert.equal(shadow.canExtract({ enemy: bossA, player: makePlayer({ level: 29 }) }).reason, "boss_rank_locked");
  assert.equal(shadow.canExtract({ enemy: bossA, player: makePlayer({ level: 30 }) }).ok, true);

  // 低段位 Boss（不在 rankRequirement 里）不受等级门槛限制
  const bossD = deadEnemy({ rank: "D", level: 12, isBoss: true });
  assert.equal(shadow.canExtract({ enemy: bossD, player: makePlayer({ level: 5 }) }).ok, true);

  // 普通（非 Boss）S 级敌人不被 boss 规则拦截
  const normalS = deadEnemy({ rank: "S", level: 50, isBoss: false });
  assert.equal(shadow.canExtract({ enemy: normalS, player: makePlayer({ level: 1 }) }).ok, true);
});

test("canExtract: Boss 拒绝名单可配置", () => {
  const config = { boss: { denyRanks: ["S"] } };
  const bossS = deadEnemy({ rank: "S", level: 50, isBoss: true });
  const res = shadow.canExtract({ enemy: bossS, player: makePlayer({ level: 60 }) }, config);
  assert.equal(res.reason, "boss_rank_locked");
});

// ---------------------------------------------------------------------------
// extractionChance
// ---------------------------------------------------------------------------

test("extractionChance: 恒在 [0, 0.95] 区间内", () => {
  const player = makePlayer();
  for (const rank of shadow.RANK_ORDER) {
    for (const level of [1, 5, 10, 20, 35, 50, 60, 99]) {
      const chance = shadow.extractionChance({ enemy: deadEnemy({ rank, level }), player });
      assert.ok(chance >= 0 && chance <= 0.95, `${rank}/${level} → ${chance}`);
      assert.ok(Number.isFinite(chance));
    }
  }
});

test("extractionChance: 等级差越大成功率越低（单调不增）", () => {
  const player = makePlayer({ level: 20, stats: { perception: 14 } });
  let prev = Infinity;
  for (let enemyLevel = 1; enemyLevel <= 60; enemyLevel += 1) {
    const chance = shadow.extractionChance({
      enemy: deadEnemy({ rank: "C", level: enemyLevel }),
      player,
    });
    assert.ok(chance <= prev, `enemyLevel=${enemyLevel} chance=${chance} 应 <= ${prev}`);
    prev = chance;
  }
});

test("extractionChance: 同一敌人等级下 rank 越高成功率越低", () => {
  const player = makePlayer();
  let prev = Infinity;
  for (const rank of shadow.RANK_ORDER) {
    const chance = shadow.extractionChance({ enemy: deadEnemy({ rank, level: 20 }), player });
    assert.ok(chance < prev, `${rank} 应低于前一档（${chance} vs ${prev}）`);
    prev = chance;
  }
});

test("extractionChance: 感知加成有上限，稀有度修正生效，Boss 折扣生效", () => {
  const enemy = deadEnemy({ rank: "B", level: 20 });
  const low = shadow.extractionChance({ enemy, player: makePlayer({ stats: { perception: 0 } }) });
  const high = shadow.extractionChance({ enemy, player: makePlayer({ stats: { perception: 999 } }) });
  assert.ok(high > low);
  assert.ok(high - low <= 0.12 + 1e-9, "感知加成不得超过 0.12");

  const common = shadow.extractionChance({ enemy: deadEnemy({ rank: "B", level: 20, rarity: "common" }), player: makePlayer() });
  const epic = shadow.extractionChance({ enemy: deadEnemy({ rank: "B", level: 20, rarity: "epic" }), player: makePlayer() });
  assert.ok(epic < common, "epic 敌人应比 common 更难提取");

  const normal = shadow.extractionChance({ enemy: deadEnemy({ rank: "A", level: 25 }), player: makePlayer() });
  const boss = shadow.extractionChance({ enemy: deadEnemy({ rank: "A", level: 25, isBoss: true }), player: makePlayer() });
  assert.ok(boss < normal, "Boss 折扣应降低成功率");
});

test("extractionChance: 玩家死亡或实体缺失时返回 0", () => {
  assert.equal(shadow.extractionChance({ enemy: deadEnemy(), player: makePlayer({ hp: 0 }) }), 0);
  assert.equal(shadow.extractionChance({ enemy: null, player: makePlayer() }), 0);
  assert.equal(shadow.extractionChance({ enemy: deadEnemy(), player: null }), 0);
});

// ---------------------------------------------------------------------------
// rollExtraction
// ---------------------------------------------------------------------------

test("rollExtraction: 敌人未死亡时直接拒绝，不消耗随机数", () => {
  const res = shadow.rollExtraction({ enemy: makeEnemy({ hp: 5 }), player: makePlayer(), seed: 42 });
  assert.deepEqual(res, { success: false, chance: 0, roll: null, shadow: null, reason: "enemy_alive" });
});

test("rollExtraction: 成功分支返回 Lv.1 影子结构", () => {
  const enemy = deadEnemy({ id: "stone_guardian", name: "石像守卫", rank: "D", level: 8 });
  const player = makePlayer();
  const { result } = findRoll(enemy, player, true);

  assert.equal(result.success, true);
  assert.equal(result.reason, "ok");
  assert.equal(typeof result.roll, "number");
  assert.ok(result.roll >= 0 && result.roll < 1);
  assert.ok(result.roll < result.chance, "roll 必须小于 chance 才算成功");

  const s = result.shadow;
  assert.match(s.id, /^sh_[edcbas]_[0-9a-f]{8}$/);
  assert.equal(s.name, "石像守卫");
  assert.equal(s.rank, "D");
  assert.equal(s.level, 1, "新影子固定 Lv.1");
  assert.equal(s.source, "石像守卫");
  assert.deepEqual(s.skills, ["撕咬", "低吼"], "技能按敌人原样带入");
  assert.equal(s.createdAt, new Date(1700000000000).toISOString());

  // 结构可直接 JSON 序列化（要落库 skills TEXT 列）
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(s)));
});

test("rollExtraction: 失败分支 shadow 为 null 且理由为 failed_roll", () => {
  const enemy = deadEnemy({ rank: "S", level: 60 }); // 低成功率，容易掷失败
  const player = makePlayer({ level: 1 });
  const { result } = findRoll(enemy, player, false);

  assert.equal(result.success, false);
  assert.equal(result.shadow, null);
  assert.equal(result.reason, "failed_roll");
  assert.ok(result.roll >= result.chance);
  assert.ok(result.chance > 0, "失败分支同样回传当次成功率，便于前端展示");
});

test("rollExtraction: 同 seed 同结果（确定性），now 只影响 createdAt", () => {
  const enemy = deadEnemy({ rank: "C", level: 15, id: "venom_serpent" });
  const player = makePlayer();

  const a = shadow.rollExtraction({ enemy, player, seed: "boss-1", now: 1700000000000 });
  const b = shadow.rollExtraction({ enemy, player, seed: "boss-1", now: 1700000000000 });
  assert.deepEqual(a, b);

  const c = shadow.rollExtraction({ enemy, player, seed: "boss-1", now: 1700000099999 });
  assert.equal(c.success, a.success);
  assert.equal(c.roll, a.roll);
  assert.equal(c.chance, a.chance);
  if (a.shadow) {
    assert.equal(c.shadow.id, a.shadow.id, "影子 id 不应随挂钟时间变化");
    assert.notEqual(c.shadow.createdAt, a.shadow.createdAt);
  }

  const d = shadow.rollExtraction({ enemy, player, seed: "boss-2", now: 1700000000000 });
  assert.notEqual(d.roll, a.roll, "不同 seed 应产生不同随机数");
});

test("rollExtraction: 技能缺省时为空数组，不污染敌人对象", () => {
  const enemy = deadEnemy({ rank: "E", level: 1, skills: undefined });
  const player = makePlayer();
  const { result } = findRoll(enemy, player, true);
  assert.deepEqual(result.shadow.skills, []);
  assert.equal(enemy.skills, undefined);

  const withSkills = { ...enemy, skills: [{ name: "撕咬", power: 1.2 }] };
  const res2 = shadow.rollExtraction({ enemy: withSkills, player, seed: 1, now: 1700000000000 });
  if (res2.success) {
    assert.notEqual(res2.shadow.skills[0], withSkills.skills[0], "技能应为浅拷贝");
    assert.deepEqual(res2.shadow.skills[0], withSkills.skills[0]);
  }
});

// ---------------------------------------------------------------------------
// shadowCap
// ---------------------------------------------------------------------------

test("shadowCap: 1 + floor(level/10)，封顶 10", () => {
  assert.equal(shadow.shadowCap(1), 1);
  assert.equal(shadow.shadowCap(9), 1);
  assert.equal(shadow.shadowCap(10), 2);
  assert.equal(shadow.shadowCap(19), 2);
  assert.equal(shadow.shadowCap(20), 3);
  assert.equal(shadow.shadowCap(55), 6);
  assert.equal(shadow.shadowCap(60), 7);
  assert.equal(shadow.shadowCap(90), 10);
  assert.equal(shadow.shadowCap(999), 10, "超过上限按上限");
});

test("shadowCap: 非法输入安全降级为 1，允许注入配置", () => {
  assert.equal(shadow.shadowCap(0), 1);
  assert.equal(shadow.shadowCap(-5), 1);
  assert.equal(shadow.shadowCap(NaN), 1);
  assert.equal(shadow.shadowCap(undefined), 1);
  assert.equal(shadow.shadowCap("12"), 2, "数字字符串可解析");
  assert.equal(shadow.shadowCap(100, { caps: { perLevels: 5, max: 4 } }), 4);
});

// ---------------------------------------------------------------------------
// 配置：数据文件 + 缺字段安全降级
// ---------------------------------------------------------------------------

test("数据文件 shadow.json 可加载且各段位配置齐全", () => {
  const cfg = shadow.loadConfig();
  for (const rank of shadow.RANK_ORDER) {
    assert.ok(cfg.ranks[rank], `缺少 ${rank} 档配置`);
    assert.ok(cfg.ranks[rank].baseChance > 0 && cfg.ranks[rank].baseChance <= 1);
    assert.ok(cfg.ranks[rank].gapScale > 0);
  }
  assert.ok(cfg.limits.maxChance <= 0.95);
  assert.ok(cfg.caps.max >= 1);
});

test("配置缺字段 / 类型错误时静默降级到默认值", () => {
  const empty = shadow.normalizeConfig({});
  const def = shadow.normalizeConfig(shadow.DEFAULT_CONFIG);
  assert.deepEqual(empty, def);

  assert.deepEqual(shadow.normalizeConfig(null), def);
  assert.deepEqual(shadow.normalizeConfig("坏数据"), def);
  assert.deepEqual(shadow.normalizeConfig([1, 2, 3]), def);

  const broken = shadow.normalizeConfig({
    version: "x",
    ranks: { E: { baseChance: "高", gapScale: -3 }, Z: { baseChance: 0.5 } },
    levelGap: { penaltyPerLevel: null },
    perception: 42,
    rarityModifier: { rare: "n/a" },
    boss: { flags: "nope", rankRequirement: { S: "many" }, denyRanks: [1, "Z"] },
    limits: { minChance: -1, maxChance: 3 },
    caps: { perLevels: 0, max: "ten" },
  });

  assert.equal(broken.version, 1);
  assert.equal(broken.ranks.E.baseChance, shadow.DEFAULT_CONFIG.ranks.E.baseChance);
  assert.equal(broken.ranks.E.gapScale, shadow.DEFAULT_CONFIG.ranks.E.gapScale);
  assert.ok(!broken.ranks.Z, "未知段位被忽略");
  assert.equal(broken.levelGap.penaltyPerLevel, shadow.DEFAULT_CONFIG.levelGap.penaltyPerLevel);
  assert.equal(broken.perception.weight, shadow.DEFAULT_CONFIG.perception.weight);
  assert.equal(broken.rarityModifier.rare, 0);
  assert.deepEqual(broken.boss.flags, shadow.DEFAULT_CONFIG.boss.flags);
  assert.equal(broken.boss.rankRequirement.S, shadow.DEFAULT_CONFIG.boss.rankRequirement.S);
  assert.deepEqual(broken.boss.denyRanks, []);
  assert.equal(broken.limits.minChance, 0);
  assert.equal(broken.limits.maxChance, 0.95);
  assert.equal(broken.caps.perLevels, 1);
  assert.equal(broken.caps.max, shadow.DEFAULT_CONFIG.caps.max);

  // 坏配置仍可正常调用，不抛异常
  const enemy = deadEnemy({ rank: "E", level: 3 });
  const player = makePlayer();
  const chance = shadow.extractionChance({ enemy, player }, broken);
  assert.ok(chance >= 0 && chance <= 0.95);
  assert.doesNotThrow(() => shadow.rollExtraction({ enemy, player, seed: 3 }, broken));
  assert.doesNotThrow(() => shadow.shadowCap(20, broken));
});

test("配置可注入：自定义 ranks / limits 生效", () => {
  const config = {
    ranks: { E: { baseChance: 0.02, gapScale: 1 } },
    limits: { minChance: 0.0, maxChance: 0.5 },
    perception: { weight: 0, bonusCap: 0 },
  };
  const enemy = deadEnemy({ rank: "E", level: 1 });
  const player = makePlayer({ level: 1, stats: { perception: 0 } });
  assert.equal(shadow.extractionChance({ enemy, player }, config), 0.02);

  const configMax = { ranks: { E: { baseChance: 0.9, gapScale: 0 } }, limits: { minChance: 0.01, maxChance: 0.5 } };
  assert.equal(shadow.extractionChance({ enemy, player }, configMax), 0.5, "不得超过 maxChance");
});

// ---------------------------------------------------------------------------
// F052 影子成长：xpForLevel / grantXp / inheritSkills
// ---------------------------------------------------------------------------

const GROWTH_CFG = {
  growth: {
    maxLevel: 10,
    xp: { base: 100, exponent: 1 },
    perLevel: { strength: 2, agility: 1, vitality: 1, intelligence: 1, perception: 1 },
    inherit: { slots: 2, chance: 1, levelDiscount: 0.5 },
  },
};

test("xpForLevel: 曲线单调递增且最小为 1", () => {
  let prev = 0;
  for (let lv = 1; lv <= 20; lv += 1) {
    const need = shadow.xpForLevel(lv);
    assert.ok(need >= 1);
    assert.ok(need > prev, `level=${lv} need=${need} 应 > ${prev}`);
    prev = need;
  }
  assert.equal(shadow.xpForLevel(1, GROWTH_CFG), 100, "base=100 exponent=1 → lv1 需 100");
});

test("grantXp: 经验累积升级并加属性，不可变返回新对象", () => {
  const s = {
    name: "狼影", level: 1, xp: 0,
    stats: { strength: 5, agility: 4, vitality: 6, intelligence: 3, perception: 3 },
  };
  const res = shadow.grantXp(s, 550, GROWTH_CFG); // lv1→2 花 100，lv2→3 花 200，余 250 不够 lv3(300)
  assert.equal(res.leveledTo, 3);
  assert.equal(res.gained, 2);
  assert.equal(res.shadow.level, 3);
  assert.equal(res.shadow.xp, 250);
  assert.equal(res.shadow.stats.strength, 9, "strength 每级 +2，升 2 级 → +4");
  assert.equal(res.shadow.stats.agility, 6);
  assert.equal(res.shadow.stats.vitality, 8);
  assert.equal(res.shadow.stats.intelligence, 5);
  assert.equal(res.shadow.stats.perception, 5);
  for (const k of ["atk", "def", "hp"]) {
    assert.ok(!(k in res.shadow.stats), `旧键 ${k} 不再产出`);
  }
  assert.equal(s.level, 1, "原对象不被修改");
  assert.equal(s.stats.strength, 5);
});

test("grantXp: 成长落在五项属性上，sanitizeStats 不再清零（F072 回归锁）", () => {
  const s = {
    level: 1, xp: 0,
    stats: { strength: 6, agility: 5, vitality: 6, intelligence: 3, perception: 4 },
  };
  const res = shadow.grantXp(s, 550, GROWTH_CFG); // → Lv.3
  const sanitized = statsLib.sanitizeStats(res.shadow);
  let total = 0;
  for (const key of statsLib.STAT_KEYS) {
    assert.equal(sanitized[key], res.shadow.stats[key], `sanitizeStats 应保留 ${key}`);
    total += sanitized[key];
  }
  assert.ok(total > 0, "消毒后五项总和必须 > 0（旧实现此处全被清零）");
});

test("growth.perLevel 键集合恰为五项属性（无 atk/def/hp）", () => {
  const keys = Object.keys(shadow.loadConfig().growth.perLevel).sort();
  assert.deepEqual(keys, [...statsLib.STAT_KEYS].sort());
});

test("normalizeConfig: 旧版 atk/def/hp perLevel 被忽略，回落默认五项", () => {
  const cfg = shadow.normalizeConfig({ growth: { perLevel: { atk: 9, def: 9, hp: 99 } } });
  assert.deepEqual(cfg.growth.perLevel, shadow.DEFAULT_CONFIG.growth.perLevel);
});

test("grantXp: 到 maxLevel 封顶不越级，剩余经验清零", () => {
  const s = {
    name: "封顶影", level: 9, xp: 0,
    stats: { strength: 0, agility: 0, vitality: 0, intelligence: 0, perception: 0 },
  };
  const res = shadow.grantXp(s, 999999, GROWTH_CFG);
  assert.equal(res.leveledTo, 10);
  assert.equal(res.gained, 1);
  assert.equal(res.shadow.level, 10);
  assert.equal(res.shadow.xp, 0, "到顶后经验清零");

  const maxed = shadow.grantXp(res.shadow, 500, GROWTH_CFG);
  assert.equal(maxed.leveledTo, 10);
  assert.equal(maxed.gained, 0);
});

test("grantXp: 缺省/坏输入安全降级，不抛异常", () => {
  const res = shadow.grantXp(null, "abc");
  assert.equal(res.shadow.level, 1);
  assert.equal(res.gained, 0);
  assert.doesNotThrow(() => shadow.grantXp(undefined, 10, { growth: null }));
});

test("inheritSkills: 继承数量受 slots 限制，技能等级按折扣折算", () => {
  const s = { name: "空影", level: 1, skills: [] };
  const enemy = {
    skills: [
      { name: "爪击", level: 8 },
      { name: "咆哮", level: 4 },
      { name: "疾奔", level: 6 },
      "蛮力",
    ],
  };
  // chance=1 → 全部掷中，但 slots=2 只取前两个
  const out = shadow.inheritSkills(s, enemy, 42, GROWTH_CFG);
  assert.equal(out.skills.length, 2);
  assert.equal(out.skills[0].name, "爪击");
  assert.equal(out.skills[0].level, 4, "level 8 * 0.5 折扣 → 4");
  assert.equal(out.skills[1].name, "咆哮");
  assert.equal(out.skills[1].level, 2);
  assert.equal(s.skills.length, 0, "原对象不被修改");
});

test("inheritSkills: 已有技能跳过不占槽，chance=0 时不继承", () => {
  const s = { name: "影", skills: [{ name: "爪击", level: 1 }] };
  const enemy = { skills: [{ name: "爪击", level: 9 }, { name: "新招", level: 2 }] };
  const out = shadow.inheritSkills(s, enemy, "seed-x", GROWTH_CFG);
  assert.equal(out.skills.length, 2, "爪击跳过不占槽，新招继承进来");
  assert.equal(out.skills[1].name, "新招");

  const none = shadow.inheritSkills(s, enemy, "seed-x", {
    growth: { inherit: { slots: 3, chance: 0, levelDiscount: 1 } },
  });
  assert.equal(none.skills.length, 1, "chance=0 → 不继承任何技能");
});

test("inheritSkills: 同 seed 同结果（确定性随机）", () => {
  const s = { name: "影", skills: [] };
  const enemy = { skills: ["a", "b", "c", "d", "e", "f"] };
  const cfg = { growth: { inherit: { slots: 3, chance: 0.5, levelDiscount: 1 } } };
  const a = shadow.inheritSkills(s, enemy, "fixed-seed", cfg);
  const b = shadow.inheritSkills(s, enemy, "fixed-seed", cfg);
  assert.deepEqual(a, b);
  assert.ok(a.skills.length <= 3);
});

// ---------------------------------------------------------------------------
// F072 stats → 战斗折算 / 初始五项属性
// ---------------------------------------------------------------------------

test("combatProfile: 五项属性按 stats.js 公式折算为战斗数值", () => {
  const prof = shadow.combatProfile({
    level: 5,
    stats: { strength: 10, agility: 8, vitality: 12, intelligence: 5, perception: 6 },
  });
  assert.equal(prof.atk, 16); // round(1.6 × 10)
  assert.ok(Math.abs(prof.def - 9.6) < 1e-9, `def 应为 9.6，实际 ${prof.def}`); // 0.8 × 12
  assert.equal(prof.maxHp, 220); // 80 + 4×5 + 10×12
  assert.equal(prof.initiative, 11); // 8 + 0.5×6
  assert.deepEqual(Object.keys(prof.stats).sort(), [...statsLib.STAT_KEYS].sort());
});

test("combatProfile: 坏输入安全降级不抛异常", () => {
  assert.doesNotThrow(() => shadow.combatProfile(null));
  assert.doesNotThrow(() => shadow.combatProfile(undefined));
  assert.doesNotThrow(() =>
    shadow.combatProfile({ level: NaN, stats: { strength: -3, vitality: "x" } }),
  );
  const p = shadow.combatProfile(null);
  assert.ok(p.atk >= 1 && Number.isFinite(p.def) && Number.isFinite(p.maxHp));
});

test("rollExtraction: 成功影子携带 growth.baseStats 初始五项属性", () => {
  const enemy = deadEnemy({ rank: "E", level: 1 });
  const player = makePlayer();
  const { result } = findRoll(enemy, player, true);
  assert.deepEqual(result.shadow.stats, {
    strength: 6,
    agility: 5,
    vitality: 6,
    intelligence: 3,
    perception: 4,
  });
});

// ---------------------------------------------------------------------------
// 老影子兜底：五项 stats 缺失 / 全 0 → 按 rank baseStats，不静默清零
// ---------------------------------------------------------------------------

test("combatProfile: 老版 {atk,def,hp} / 缺 stats 影子按 rank baseStats 兜底", () => {
  const fresh = shadow.combatProfile({
    rank: "E",
    level: 1,
    stats: { strength: 6, agility: 5, vitality: 6, intelligence: 3, perception: 4 },
  });
  for (const legacy of [
    { rank: "E", level: 1, stats: { atk: 20, def: 9, hp: 160 } },
    { rank: "E", level: 1 },
    { rank: "E", level: 1, stats: null },
    { rank: "E", level: 1, stats: { strength: 0, agility: 0, vitality: 0, intelligence: 0, perception: 0 } },
  ]) {
    assert.deepEqual(shadow.combatProfile(legacy), fresh);
    assert.ok(shadow.combatProfile(legacy).atk > 1, "不得退化为 atk=1");
  }

  // rank 未知 / 缺失 → 回退 E 档；非 E 档用各自的 baseStats
  const rankD = shadow.combatProfile({ rank: "D", level: 1, stats: { hp: 50 } });
  assert.deepEqual(rankD.stats, shadow.DEFAULT_CONFIG.growth.baseStats.D);
  assert.deepEqual(
    shadow.combatProfile({ rank: "Z", level: 1 }).stats,
    shadow.DEFAULT_CONFIG.growth.baseStats.E,
  );
});

test("combatProfile: 五项部分存在（至少一项 > 0）不触发兜底", () => {
  const p = shadow.combatProfile({ rank: "S", level: 1, stats: { strength: 3 } });
  assert.equal(p.stats.strength, 3);
  assert.equal(p.stats.vitality, 0, "其余缺失项按 0，不套 S 档 baseStats");
});

test("grantXp: 老影子五项缺失时从 baseStats[rank] 起点成长", () => {
  const legacy = { rank: "E", level: 1, xp: 0, stats: { atk: 20, def: 9, hp: 160 } };
  const res = shadow.grantXp(legacy, shadow.xpForLevel(1, GROWTH_CFG), GROWTH_CFG);
  assert.equal(res.shadow.level, 2);
  // baseStats.E（默认配置）+ GROWTH_CFG.perLevel × 1
  const base = shadow.DEFAULT_CONFIG.growth.baseStats.E;
  for (const key of statsLib.STAT_KEYS) {
    assert.equal(res.shadow.stats[key], base[key] + GROWTH_CFG.growth.perLevel[key]);
  }
  for (const k of ["atk", "def", "hp"]) {
    assert.ok(!(k in res.shadow.stats), `旧键 ${k} 不再产出`);
  }
});
