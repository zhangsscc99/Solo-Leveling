// F088 遭遇表：按章节分层的敌人模板与确定性遭遇判定（纯函数）。
//
//   chanceFor(chapterIndex)   每章基础遭遇率：后章更凶，封顶 75%
//   spawn(chapterIndex, seed) 从本章小怪池确定性抽一只，展开成战斗实体
//   spawnBoss(chapterIndex)   本章 boss 模板（boss 场景落地必触发）
//   PITY_LIMIT                连续落空上限：计数到此值必触发（杜绝死冷场）
//
// 敌人模板带 stats（五项）/hp/xp/atk/def：hp 与 xp 是显式预算，攻防由
// engine/stats.js 的同一套系数折算，不另起公式。id 命中 drops.json 的
// 敌人键时沿用其掉落表，未命中则由 loot 引擎的 fallback 表兜底。
//
// 所有掷点都过 createRng(seed)：同一（存档, 场景, 计数）永远得到同一结果。

const { createRng } = require("./rng");
const S = require("./stats");

const PITY_LIMIT = 4;
const BASE_CHANCE = 0.3;
const PER_CHAPTER = 0.05;
const MAX_CHANCE = 0.75;

// F095 章节期望等级：玩家抵达本章时按 XP 曲线应处的等级。取「本章小怪
// + boss + 主线奖励 + 每日任务」全收后大致够到下一章期望的中位——
// ch1 期望 Lv.2（新档 Lv.1 + 新手装备 + 3 瓶药水即可险胜守关者），
// 之后随章节单调抬升；后章略压半档，留出练级空间但不再出现
// mobLevel(1)=2、boss+3=Lv.5 碾压 Lv.1 的死锁。
const EXPECTED_LEVEL = { 1: 2, 2: 4, 3: 6, 4: 9, 5: 12, 6: 15, 7: 19, 8: 24 };
const BOSS_LEVEL_BONUS = 1;

function expectedLevel(chapterIndex) {
  const ch = Math.max(1, Math.trunc(S.num(chapterIndex)) || 1);
  return EXPECTED_LEVEL[ch] || EXPECTED_LEVEL[8];
}

// 小怪等级 = 本章期望等级（模板 levelBonus 叠加出强一档的变体）；
// 守关 boss = 期望 +1——门口一战必须真打，但同章期望等级玩家应能拿下。
function mobLevel(chapterIndex) {
  return expectedLevel(chapterIndex);
}

// 由等级推导五项属性：boss 力量/体力加成更厚。与 stats.js 的折算系数
// 配套（atk = 1.6×str，def = 0.8×vit），不改引擎公式本身。
function scaledStats(level, boss) {
  const lv = Math.max(1, Math.trunc(S.num(level)) || 1);
  return {
    strength: Math.round(7 + lv * (boss ? 1.5 : 1.1)),
    agility: Math.round(6 + lv * 0.9),
    vitality: Math.round(3 + lv * (boss ? 0.8 : 0.5)),
    intelligence: Math.round(4 + lv * 0.4),
    perception: Math.round(5 + lv * 0.5),
  };
}

// 攻防默认由等级属性折算（atk = 1.6×str，def = 0.8×vit）；模板允许像
// hp/xp 一样写显式 atk/def 覆盖——ch1 守关者即用它把单回合伤害压到
// Lv.1 玩家 DPS 之下（期望等级生成的 atk 仍偏高，见 F095 平衡推导）。
function makeEnemy({ id, name, rank, level, hp, xp, boss, atk, def }) {
  const stats = scaledStats(level, boss);
  const maxHp = Math.max(1, Math.round(S.num(hp) || 1));
  return {
    id,
    name,
    rank,
    level,
    stats,
    hp: maxHp,
    maxHp,
    xp: Math.max(1, Math.round(S.num(xp) || 1)),
    boss: Boolean(boss),
    atk: atk !== undefined ? Math.max(1, Math.round(S.num(atk) || 1)) : Math.round(stats.strength * 1.6),
    def: def !== undefined ? Math.max(0, Math.round(S.num(def))) : Math.round(stats.vitality * 0.8),
  };
}

const MOB_HP_BASE = 45;
const MOB_HP_PER_LEVEL = 8;
const BOSS_HP_BASE = 110;
const BOSS_HP_PER_LEVEL = 14;
const MOB_XP_BASE = 12;
const MOB_XP_PER_LEVEL = 6;
const BOSS_XP_BASE = 40;
const BOSS_XP_PER_LEVEL = 8;

// 章节遭遇表：小怪池 + boss。名字取自本章题材，id 尽量对回 drops.json
// 已有掉落键；没有对应掉落键的（如哥布林、试炼亡魂）走 fallback 表。
// hp/xp 为显式预算：小怪约 4 刀、boss 约 8–10 刀（按本章期望等级的
// 玩家 DPS 折算，含 E→S 等级压制系数），XP 与 levels.json 曲线配套——
// 一章全收大致把玩家推过下一章期望等级线。ch1 守关者额外写死 atk：
// Lv.1 新档单回合承伤必须低于自身 DPS（bossDmg/playerDmg < 1）。
const CHAPTER_ENEMIES = {
  1: {
    mobs: [
      { id: "dungeon_wolf", name: "地下城狼", rank: "E", hp: 42, xp: 18 },
      { id: "broken_statue", name: "石像残兵", rank: "E", levelBonus: 1, hp: 52, xp: 22 },
    ],
    boss: { id: "stone_guardian", name: "石像守卫", rank: "D", hp: 75, xp: 75, atk: 16 },
  },
  2: {
    mobs: [
      { id: "venom_serpent", name: "沙地毒蛇", rank: "D", hp: 78, xp: 30 },
      { id: "penalty_sandworm", name: "惩罚沙虫", rank: "D", hp: 88, xp: 36 },
    ],
    boss: { id: "venom_serpent", name: "惩罚副本·毒牙蛇", rank: "D", hp: 200, xp: 400 },
  },
  3: {
    mobs: [
      { id: "goblin_scout", name: "哥布林斥候", rank: "E", hp: 96, xp: 44 },
      { id: "goblin_raider", name: "哥布林掠袭者", rank: "D", levelBonus: 1, hp: 110, xp: 52 },
    ],
    boss: { id: "goblin_pack", name: "评级副本·哥布林群", rank: "C", hp: 210, xp: 260 },
  },
  4: {
    mobs: [
      { id: "raid_wolf", name: "突袭魔狼", rank: "D", hp: 120, xp: 60 },
      { id: "dungeon_wolf", name: "地下城狼王", rank: "C", levelBonus: 1, hp: 135, xp: 70 },
    ],
    boss: { id: "venom_serpent", name: "蓝色毒蛇王", rank: "B", hp: 225, xp: 340 },
  },
  5: {
    mobs: [
      { id: "trial_wraith", name: "试炼亡魂", rank: "C", hp: 148, xp: 80 },
      { id: "trial_phantom", name: "试炼幻影", rank: "C", levelBonus: 1, hp: 165, xp: 92 },
    ],
    boss: { id: "trial_guardian", name: "试炼守护者", rank: "B", hp: 310, xp: 460 },
  },
  6: {
    mobs: [
      { id: "frost_sprite", name: "冰精灵", rank: "C", hp: 168, xp: 105 },
      { id: "frost_wolf", name: "冰原魔狼", rank: "B", levelBonus: 1, hp: 185, xp: 120 },
    ],
    boss: { id: "frost_sprite", name: "冰精灵女王", rank: "A", hp: 330, xp: 600 },
  },
  7: {
    mobs: [
      { id: "hellhound", name: "地狱之犬", rank: "B", hp: 185, xp: 135 },
      { id: "demon_castle_knight", name: "恶魔城骑士", rank: "B", levelBonus: 1, hp: 205, xp: 152 },
    ],
    boss: { id: "demon_castle_knight", name: "恶魔城城主", rank: "A", hp: 380, xp: 780 },
  },
  8: {
    mobs: [
      { id: "ant_soldier", name: "魔蚁兵", rank: "A", hp: 218, xp: 170 },
      { id: "ant_elite", name: "魔蚁近卫", rank: "A", levelBonus: 1, hp: 240, xp: 190 },
    ],
    boss: { id: "ant_king_beru", name: "蚁王 Beru", rank: "S", hp: 450, xp: 980 },
  },
};

function tableFor(chapterIndex) {
  const ch = Math.max(1, Math.trunc(S.num(chapterIndex)) || 1);
  return CHAPTER_ENEMIES[ch] || CHAPTER_ENEMIES[8];
}

// 基础遭遇率：第 1 章 30%，每往下一章 +5%，封顶 75%（后章更凶）。
function chanceFor(chapterIndex) {
  const ch = Math.max(1, Math.trunc(S.num(chapterIndex)) || 1);
  return Math.min(MAX_CHANCE, BASE_CHANCE + (ch - 1) * PER_CHAPTER);
}

// 从小怪池确定性抽一只并展开。seed 相同 → 同一只。
function spawn(chapterIndex, seed) {
  const table = tableFor(chapterIndex);
  const base = mobLevel(chapterIndex);
  const rng = createRng(`encounter:${chapterIndex}:${seed}`);
  const pick = table.mobs[rng.int(0, table.mobs.length - 1)];
  const level = base + Math.max(0, Math.trunc(S.num(pick.levelBonus)));
  const hp = pick.hp || MOB_HP_BASE + level * MOB_HP_PER_LEVEL;
  const xp = pick.xp || MOB_XP_BASE + level * MOB_XP_PER_LEVEL;
  return makeEnemy({ ...pick, level, hp, xp });
}

// 本章 boss：boss 场景（kind === "boss"）落地必触发，不走遭遇率。
function spawnBoss(chapterIndex) {
  const table = tableFor(chapterIndex);
  const level = mobLevel(chapterIndex) + BOSS_LEVEL_BONUS;
  const tpl = table.boss;
  const hp = tpl.hp || BOSS_HP_BASE + level * BOSS_HP_PER_LEVEL;
  const xp = tpl.xp || BOSS_XP_BASE + level * BOSS_XP_PER_LEVEL;
  return makeEnemy({ ...tpl, level, hp, xp, boss: true });
}

// 遭遇判定（纯函数）：boss 场景必中；否则 pity 计数到顶必中；再否则
// 按本章遭遇率掷点。返回敌人实体或 null（caller 负责计数落库）。
function roll({ chapterIndex, scene, clock, seed }) {
  if (!scene || typeof scene !== "object") return null;
  if (scene.kind === "boss") return spawnBoss(chapterIndex);
  const c = Math.max(0, Math.trunc(S.num(clock)));
  if (c + 1 >= PITY_LIMIT) return spawn(chapterIndex, `${seed}:pity`);
  const rng = createRng(`encounter-roll:${chapterIndex}:${scene.id || "?"}:${seed}`);
  return rng.chance(chanceFor(chapterIndex)) ? spawn(chapterIndex, `${seed}:hit`) : null;
}

module.exports = {
  PITY_LIMIT,
  chanceFor,
  spawn,
  spawnBoss,
  roll,
  expectedLevel,
  mobLevel,
  scaledStats,
  makeEnemy,
  CHAPTER_ENEMIES,
};
