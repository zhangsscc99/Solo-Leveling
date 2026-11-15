// ============================================================================
// F031 属性影响公式 —— 五项属性的唯一职责都在这里，战斗引擎只调用本文件。
// 全部为纯函数：无随机、无副作用，任何 NaN / 负数 / 缺省输入都会安全降级。
//
//   力量 strength     物理伤害基数        atk   = 1.6 × 力量
//   敏捷 agility      命中 / 闪避 / 先手   acc   = 0.6 × 敏捷, eva = 1.0 × 敏捷, 先手 = 敏捷 + 0.5 × 感知
//   体力 vitality     生命上限 / 减伤      maxHp = 80 + 4 × 等级 + 10 × 体力, 减伤 = 0.8 × 体力
//   智力 intelligence 技能伤害系数 / MP 效率 倍率 = 1.4 + 0.02 × 智力（上限 3.0）, MP 折扣 = min(30%, 1% × 智力)
//   感知 perception   暴击率 / 暴击致命度 / 破绽命中  crit = 5% + 0.5% × 感知, critMul = 1.5 + 0.5% × 感知, 命中的 40% 权重
// ============================================================================

const STAT_KEYS = ["strength", "agility", "vitality", "intelligence", "perception"];

// 各项概率的硬边界（需求约束，任何输入都不得越界）
const HIT_MIN = 0.2;
const HIT_MAX = 0.98;
const CRIT_MIN = 0.01;
const CRIT_MAX = 0.5;

// 系数表：集中在此，方便调参，不需要读下面的公式。
const K = {
  hitBase: 0.85, // 命中率基准
  hitSlope: 0.02, // （攻方命中值 - 守方闪避值）每 1 点的命中率变化
  agiAccuracy: 0.6, // 敏捷对命中值的权重（其余 0.4 归感知的「发现破绽」）
  perAccuracy: 0.4,
  agiEvasion: 1.0, // 敏捷对闪避值的权重（受击侧）
  critBase: 0.05,
  critPerPoint: 0.005,
  critMultBase: 1.5,
  critMultPerPoint: 0.005,
  critMultMax: 2.0,
  dmgStr: 1.6, // 力量 → 物理伤害基数
  dmgPerVit: 0.8, // 体力 → 减伤
  skillBase: 1.4, // 智力 → 技能伤害系数
  skillPerPoint: 0.02,
  skillMax: 3.0,
  mpDiscountPerPoint: 0.01,
  mpDiscountMax: 0.3, // 最多省 30% MP
  mpCostMin: 3,
  hpBase: 80,
  hpPerLevel: 4,
  hpPerVit: 10,
  mpBase: 10,
  mpPerLevel: 2,
  mpPerInt: 5,
  initiativePerWeight: 0.5, // 感知对先手的一半权重
};

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// 夹紧并消毒：NaN / ±Infinity 一律降级为下界，避免污染后续运算。
function clamp(v, lo, hi) {
  const n = num(v);
  return Math.max(lo, Math.min(hi, n));
}

// 归一化后的属性值：缺失 / NaN / 负数 → 0。
function statOf(entity, key) {
  if (!entity || typeof entity !== "object") return 0;
  const s = entity.stats || {};
  return Math.max(0, num(s[key]));
}

// 把实体属性表复制一份并消毒，保证引擎内部不再出现 NaN / 负属性。
function sanitizeStats(entity) {
  const src = (entity && entity.stats) || {};
  const out = {};
  for (const k of STAT_KEYS) out[k] = Math.max(0, num(src[k]));
  return out;
}

// 命中率：0.85 + (攻方命中值 - 守方闪避值) × 0.02，夹紧 [0.2, 0.98]。
// 攻方命中值 = 0.6 × 敏捷 + 0.4 × 感知（感知负责「发现破绽」，见下方注释）；
// 守方闪避值 = 1.0 × 敏捷（受击侧闪避只吃敏捷）。
function hitChance(attacker, defender) {
  const acc = statOf(attacker, "agility") * K.agiAccuracy + statOf(attacker, "perception") * K.perAccuracy;
  const eva = statOf(defender, "agility") * K.agiEvasion;
  return clamp(K.hitBase + (acc - eva) * K.hitSlope, HIT_MIN, HIT_MAX);
}

// 暴击率：5% + 0.5% × 感知，夹紧 [1%, 50%]。
function critChance(attacker) {
  return clamp(K.critBase + statOf(attacker, "perception") * K.critPerPoint, CRIT_MIN, CRIT_MAX);
}

// 暴击倍率：1.5 + 0.5% × 感知（上限 2.0）。感知越高，暴击越致命（暴击命中质量）。
function critMultiplier(attacker) {
  return clamp(
    K.critMultBase + statOf(attacker, "perception") * K.critMultPerPoint,
    K.critMultBase,
    K.critMultMax
  );
}

// 物理伤害：max(1, round((1.6 × 力量 - 减伤) × 倍率))。力量是唯一的物理伤害基数。
function physicalDamage(attacker, defenderDef, mult = 1) {
  const base = statOf(attacker, "strength") * K.dmgStr;
  const m = num(mult) > 0 ? num(mult) : 1;
  const raw = (base - num(defenderDef)) * m;
  return Math.max(1, Math.round(num(raw)));
}

// 体力减伤值：0.8 × 体力。
function defenseOf(entity) {
  return statOf(entity, "vitality") * K.dmgPerVit;
}

// 实体的防御值：显式 def 字段优先（兼容旧敌人数据），否则由体力推导。
function defenseFor(entity) {
  const explicit = num(entity && entity.def);
  if (explicit > 0) return explicit;
  return defenseOf(entity);
}

// 体力 → 生命上限：80 + 4 × 等级 + 10 × 体力（与 progression.maxHpFor 一致）。
function maxHpFor(level, stats) {
  const lv = Math.max(0, num(level));
  const vit = Math.max(0, num((stats || {}).vitality));
  return Math.max(1, Math.round(K.hpBase + K.hpPerLevel * lv + K.hpPerVit * vit));
}

// 智力 → 魔力上限：10 + 2 × 等级 + 5 × 智力（与 progression.maxMpFor 一致）。
function maxMpFor(level, stats) {
  const lv = Math.max(0, num(level));
  const intel = Math.max(0, num((stats || {}).intelligence));
  return Math.max(0, Math.round(K.mpBase + K.mpPerLevel * lv + K.mpPerInt * intel));
}

// 智力 → 技能伤害系数：1.4 + 0.02 × 智力（上限 3.0）。
function skillMultiplier(entity) {
  return clamp(K.skillBase + statOf(entity, "intelligence") * K.skillPerPoint, K.skillBase, K.skillMax);
}

// 智力 → MP 效率：每点省 1%，最多省 30%；实际消耗夹紧在 [3, base]。
function skillCost(entity, baseCost) {
  const base = Math.max(1, num(baseCost) || 1);
  const discount = Math.min(K.mpDiscountMax, statOf(entity, "intelligence") * K.mpDiscountPerPoint);
  return Math.round(clamp(base * (1 - discount), Math.min(K.mpCostMin, base), base));
}

// 先手值：敏捷 + 0.5 × 感知。高者先出手，相同则玩家先手。
function initiative(entity) {
  return statOf(entity, "agility") + statOf(entity, "perception") * K.initiativePerWeight;
}

module.exports = {
  STAT_KEYS,
  HIT_MIN,
  HIT_MAX,
  CRIT_MIN,
  CRIT_MAX,
  clamp,
  num,
  statOf,
  sanitizeStats,
  hitChance,
  critChance,
  critMultiplier,
  physicalDamage,
  defenseOf,
  defenseFor,
  maxHpFor,
  maxMpFor,
  skillMultiplier,
  skillCost,
  initiative,
};
