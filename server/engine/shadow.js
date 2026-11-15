// 影子提取（Arise）引擎 —— 纯函数，无副作用（仅首次读取 shadow.json 并缓存）。
//
// 设计约定与 combat.js / loot.js 保持一致：
//   · 所有随机性来自 server/engine/rng.js 的 createRng(seed)，同一 seed 必然同结果；
//   · 配置数据驱动（server/data/shadow.json），函数都可注入 config，便于测试；
//   · 配置缺字段 / 类型错误时静默降级到内置默认值，绝不抛异常。
//
// 对外接口：
//   canExtract({ enemy, player })        → { ok, reason }   提取资格（前置条件）
//   extractionChance({ enemy, player })  → 0..0.95           成功率（纯公式）
//   rollExtraction({ enemy, player, seed }) → { success, chance, roll, shadow|null }
//   shadowCap(playerLevel)               → 影子数量上限
//
// 本模块不写库；持久化由 server/db.js 的 shadows 表负责（F051 接线）。

const fs = require("fs");
const path = require("path");

const { createRng, hashSeed } = require("./rng");

const CONFIG_PATH = path.join(__dirname, "..", "data", "shadow.json");

const RANK_ORDER = ["E", "D", "C", "B", "A", "S"];

// 敌人未显式给 level 时，按 rank 折算一个代表等级（与 progression 的段位一致）。
const DEFAULT_RANK_BASE_LEVEL = { E: 1, D: 10, C: 20, B: 30, A: 40, S: 50 };

// 稀有度修正：越稀有的敌人越难被影子化（与 items.json/drops.json 的稀有度词汇一致）。
const DEFAULT_RARITY_MODIFIER = {
  common: 0.05,
  uncommon: 0.02,
  rare: 0,
  epic: -0.04,
  legendary: -0.08,
};

const DEFAULT_CONFIG = {
  version: 1,
  rankOrder: RANK_ORDER,
  rankBaseLevel: DEFAULT_RANK_BASE_LEVEL,
  ranks: {
    E: { baseChance: 0.7, gapScale: 0.5 },
    D: { baseChance: 0.55, gapScale: 0.7 },
    C: { baseChance: 0.42, gapScale: 0.9 },
    B: { baseChance: 0.3, gapScale: 1.1 },
    A: { baseChance: 0.18, gapScale: 1.3 },
    S: { baseChance: 0.1, gapScale: 1.6 },
  },
  levelGap: { penaltyPerLevel: 0.03, advantageBonusPerLevel: 0.005, advantageBonusCap: 0.1 },
  perception: { weight: 0.004, bonusCap: 0.12 },
  rarityModifier: DEFAULT_RARITY_MODIFIER,
  boss: {
    flags: ["isBoss", "boss"],
    rankRequirement: { S: 40, A: 30 },
    denyRanks: [],
    chanceMultiplier: 0.5,
  },
  limits: { minChance: 0.01, maxChance: 0.95 },
  caps: { perLevels: 10, max: 10 },
};

let cached = null;

function loadConfig() {
  if (cached) return cached;
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    raw = null; // 文件缺失 / JSON 损坏 → 全量默认值
  }
  cached = normalizeConfig(raw);
  return cached;
}

function clearCache() {
  cached = null;
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// 严格数字解析：null / 布尔 / 对象 / 空串 都视为「没给」，回落到 fallback。
// （Number(null) === 0 会把缺字段误当成合法 0，配置降级必须避开这个坑。）
function num(v, fallback) {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function normalizeRank(rank, order) {
  const key = typeof rank === "string" ? rank.trim().toUpperCase() : "";
  return order.includes(key) ? key : "E";
}

function statOf(entity, key) {
  const stats = entity && entity.stats;
  if (!isPlainObject(stats)) return 0;
  return num(stats[key], 0);
}

// 等级读取：显式 level 优先，否则按 rank 折算，最后兜底 1。
function levelOf(entity, rank, baseLevels) {
  const lv = num(entity && entity.level, NaN);
  if (Number.isFinite(lv) && lv > 0) return Math.floor(lv);
  const base = num(baseLevels[rank], 1);
  return base > 0 ? Math.floor(base) : 1;
}

// ---------------------------------------------------------------------------
// 配置归一化（缺字段 / 错类型 → 回落到默认值）
// ---------------------------------------------------------------------------

function normalizeConfig(raw) {
  const src = isPlainObject(raw) ? raw : {};

  const order = Array.isArray(src.rankOrder) && src.rankOrder.length
    ? src.rankOrder.filter((r) => typeof r === "string").map((r) => r.trim().toUpperCase())
    : RANK_ORDER;
  const rankOrder = order.length ? order : RANK_ORDER;

  const baseLevels = { ...DEFAULT_RANK_BASE_LEVEL };
  if (isPlainObject(src.rankBaseLevel)) {
    for (const rank of RANK_ORDER) {
      const v = num(src.rankBaseLevel[rank], NaN);
      if (Number.isFinite(v) && v > 0) baseLevels[rank] = Math.floor(v);
    }
  }

  const ranks = {};
  for (const rank of RANK_ORDER) {
    const defaults = DEFAULT_CONFIG.ranks[rank];
    const given = isPlainObject(src.ranks) && isPlainObject(src.ranks[rank]) ? src.ranks[rank] : {};
    const base = num(given.baseChance, NaN);
    const gapScale = num(given.gapScale, NaN);
    ranks[rank] = {
      baseChance: Number.isFinite(base) ? clamp(base, 0, 1) : defaults.baseChance,
      gapScale: Number.isFinite(gapScale) && gapScale >= 0 ? gapScale : defaults.gapScale,
    };
  }

  const gapSrc = isPlainObject(src.levelGap) ? src.levelGap : {};
  const levelGap = {
    penaltyPerLevel: nonNegative(gapSrc.penaltyPerLevel, DEFAULT_CONFIG.levelGap.penaltyPerLevel),
    advantageBonusPerLevel: nonNegative(
      gapSrc.advantageBonusPerLevel,
      DEFAULT_CONFIG.levelGap.advantageBonusPerLevel,
    ),
    advantageBonusCap: nonNegative(gapSrc.advantageBonusCap, DEFAULT_CONFIG.levelGap.advantageBonusCap),
  };

  const perSrc = isPlainObject(src.perception) ? src.perception : {};
  const perception = {
    weight: nonNegative(perSrc.weight, DEFAULT_CONFIG.perception.weight),
    bonusCap: nonNegative(perSrc.bonusCap, DEFAULT_CONFIG.perception.bonusCap),
  };

  const rarityModifier = { ...DEFAULT_RARITY_MODIFIER };
  if (isPlainObject(src.rarityModifier)) {
    for (const [key, value] of Object.entries(src.rarityModifier)) {
      const v = num(value, NaN);
      if (Number.isFinite(v)) rarityModifier[key] = clamp(v, -1, 1);
    }
  }

  const bossSrc = isPlainObject(src.boss) ? src.boss : {};
  const flags = Array.isArray(bossSrc.flags) && bossSrc.flags.length
    ? bossSrc.flags.filter((f) => typeof f === "string" && f)
    : DEFAULT_CONFIG.boss.flags;
  const rankRequirement = { ...DEFAULT_CONFIG.boss.rankRequirement };
  if (isPlainObject(bossSrc.rankRequirement)) {
    for (const [rank, lv] of Object.entries(bossSrc.rankRequirement)) {
      const key = String(rank).trim().toUpperCase();
      const v = num(lv, NaN);
      if (RANK_ORDER.includes(key) && Number.isFinite(v)) rankRequirement[key] = Math.floor(v);
    }
  }
  const denyRanks = Array.isArray(bossSrc.denyRanks)
    ? bossSrc.denyRanks.map((r) => String(r).trim().toUpperCase()).filter((r) => RANK_ORDER.includes(r))
    : [];
  const boss = {
    flags: flags.length ? flags : DEFAULT_CONFIG.boss.flags,
    rankRequirement,
    denyRanks,
    chanceMultiplier: nonNegative(bossSrc.chanceMultiplier, DEFAULT_CONFIG.boss.chanceMultiplier),
  };

  const limitsSrc = isPlainObject(src.limits) ? src.limits : {};
  const minChance = clamp(num(limitsSrc.minChance, DEFAULT_CONFIG.limits.minChance), 0, 0.95);
  const maxChance = clamp(num(limitsSrc.maxChance, DEFAULT_CONFIG.limits.maxChance), minChance, 0.95);
  const limits = { minChance, maxChance };

  const capsSrc = isPlainObject(src.caps) ? src.caps : {};
  const perLevels = Math.max(1, Math.floor(num(capsSrc.perLevels, DEFAULT_CONFIG.caps.perLevels)));
  const maxCap = Math.max(1, Math.floor(num(capsSrc.max, DEFAULT_CONFIG.caps.max)));
  const caps = { perLevels, max: maxCap };

  return {
    version: Math.floor(num(src.version, DEFAULT_CONFIG.version)),
    rankOrder,
    rankBaseLevel: baseLevels,
    ranks,
    levelGap,
    perception,
    rarityModifier,
    boss,
    limits,
    caps,
  };
}

function nonNegative(v, fallback) {
  const n = num(v, NaN);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function configOr(config) {
  if (config === undefined || config === null) return loadConfig();
  return normalizeConfig(config);
}

// ---------------------------------------------------------------------------
// 判定辅助
// ---------------------------------------------------------------------------

// Boss 判定：显式布尔标记 / 字符串标记（"boss" / "S"）都认。
function isBoss(enemy, cfg) {
  if (!enemy || typeof enemy !== "object") return false;
  for (const flag of cfg.boss.flags) {
    const v = enemy[flag];
    if (v === true) return true;
    if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "false") return true;
    if (Number.isFinite(Number(v)) && Number(v) > 0 && typeof v !== "string") return true;
  }
  if (typeof enemy.type === "string" && enemy.type.trim().toLowerCase() === "boss") return true;
  return false;
}

// 敌人是否已死亡：hp<=0，或战斗状态标记 defeated，或战斗事件里出现 defeat(defeated)/side=enemy。
function isEnemyDefeated(enemy, events) {
  if (!enemy || typeof enemy !== "object") return false;
  const hp = num(enemy.hp, NaN);
  if (Number.isFinite(hp) && hp <= 0) return true;
  if (enemy.defeated === true || enemy.dead === true || enemy.killed === true) return true;
  if (typeof enemy.status === "string" && enemy.status.trim().toLowerCase() === "defeated") return true;
  if (Array.isArray(events)) {
    return events.some(
      (e) =>
        e &&
        (e.type === "defeat" || e.type === "defeated") &&
        (e.side === "enemy" || e.side === undefined),
    );
  }
  return false;
}

function playerAlive(player) {
  if (!player || typeof player !== "object") return false;
  const hp = num(player.hp, NaN);
  return Number.isFinite(hp) ? hp > 0 : true;
}

function alreadyExtracted(enemy) {
  return !!(enemy && (enemy.arisen === true || enemy.extracted === true));
}

// ---------------------------------------------------------------------------
// canExtract —— 提取资格
// ---------------------------------------------------------------------------

// 返回 { ok, reason }。reason 取值（稳定，供前端/叙事层映射文案）：
//   ok | missing_enemy | missing_player | player_dead | enemy_alive
//   already_extracted | boss_rank_locked
function canExtract(input, config) {
  const {
    enemy,
    player,
    events,
  } = isPlainObject(input) ? input : {};
  const cfg = configOr(config);

  if (!enemy || typeof enemy !== "object") return { ok: false, reason: "missing_enemy" };
  if (!player || typeof player !== "object") return { ok: false, reason: "missing_player" };
  if (!playerAlive(player)) return { ok: false, reason: "player_dead" };
  if (!isEnemyDefeated(enemy, events)) return { ok: false, reason: "enemy_alive" };
  if (alreadyExtracted(enemy)) return { ok: false, reason: "already_extracted" };

  if (isBoss(enemy, cfg)) {
    const rank = normalizeRank(enemy.rank, cfg.rankOrder);
    if (cfg.boss.denyRanks.includes(rank)) return { ok: false, reason: "boss_rank_locked" };
    const need = num(cfg.boss.rankRequirement[rank], NaN);
    if (Number.isFinite(need) && need > 0) {
      const playerLevel = levelOf(player, "E", cfg.rankBaseLevel);
      if (playerLevel < need) return { ok: false, reason: "boss_rank_locked" };
    }
  }

  return { ok: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// extractionChance —— 成功率公式
// ---------------------------------------------------------------------------
//
//   chance = baseChance(rank)
//          - max(0, enemyLevel - playerLevel) * penaltyPerLevel * gapScale(rank)
//          + min(max(0, playerLevel - enemyLevel) * advantageBonusPerLevel, advantageBonusCap)
//          + min(perception * perceptionWeight, perceptionBonusCap)
//          + rarityModifier[enemy.rarity]
//   若为 Boss：chance *= boss.chanceMultiplier
//   最后 clamp 到 [minChance, maxChance(=0.95)]
//
// 单调性：固定玩家等级时，敌人等级越高 → 等级差惩罚越大、等级优势补偿越小，
// 因此 chance 单调不增（上限 0.95、下限 minChance 的截断不破坏该性质）。
function extractionChance(input, config) {
  const { enemy, player } = isPlainObject(input) ? input : {};
  const cfg = configOr(config);
  if (!enemy || typeof enemy !== "object") return 0;
  if (!player || typeof player !== "object") return 0;
  if (!playerAlive(player)) return 0;

  const rank = normalizeRank(enemy.rank, cfg.rankOrder);
  const rankTuning = cfg.ranks[rank] || cfg.ranks.E;
  const enemyLevel = levelOf(enemy, rank, cfg.rankBaseLevel);
  const playerLevel = levelOf(player, "E", cfg.rankBaseLevel);

  let chance = rankTuning.baseChance;

  const gap = enemyLevel - playerLevel;
  if (gap > 0) {
    chance -= gap * cfg.levelGap.penaltyPerLevel * rankTuning.gapScale;
  } else if (gap < 0) {
    chance += Math.min(-gap * cfg.levelGap.advantageBonusPerLevel, cfg.levelGap.advantageBonusCap);
  }

  const perception = statOf(player, "perception");
  if (perception > 0) {
    chance += Math.min(perception * cfg.perception.weight, cfg.perception.bonusCap);
  }

  const rarity = typeof enemy.rarity === "string" ? enemy.rarity.trim().toLowerCase() : "";
  const rarityBonus = num(cfg.rarityModifier[rarity], 0);
  chance += rarityBonus;

  if (isBoss(enemy, cfg)) chance *= cfg.boss.chanceMultiplier;

  return round4(clamp(chance, cfg.limits.minChance, cfg.limits.maxChance));
}

// ---------------------------------------------------------------------------
// shadowCap —— 影子数量上限：1 + floor(level / perLevels)，封顶 caps.max
// ---------------------------------------------------------------------------
function shadowCap(playerLevel, config) {
  const cfg = configOr(config);
  const level = Math.max(1, Math.floor(num(playerLevel, 1)));
  const cap = 1 + Math.floor(level / cfg.caps.perLevels);
  return Math.min(cfg.caps.max, Math.max(1, cap));
}

// ---------------------------------------------------------------------------
// rollExtraction —— 实际提取判定
// ---------------------------------------------------------------------------
//
// options.now：固定时间戳（毫秒），用于让 createdAt 也确定化；省略则取 Date.now()。
// 成功返回的 shadow 是「刚提取、Lv.1、未成长」的原始形态：
//   { id, name, rank, level: 1, source: enemy.name, skills, createdAt }
function rollExtraction(input, config) {
  const opts = isPlainObject(input) ? input : {};
  const { enemy, player, seed, now } = opts;
  const cfg = configOr(config);

  const gate = canExtract({ enemy, player, events: opts.events }, cfg);
  if (!gate.ok) {
    return { success: false, chance: 0, roll: null, shadow: null, reason: gate.reason };
  }

  const chance = extractionChance({ enemy, player }, cfg);
  const rngSeed = seed === undefined || seed === null ? Date.now() : seed;
  const rng = createRng(rngSeed);
  const roll = rng.next();
  const success = roll < chance;

  if (!success) {
    return { success: false, chance, roll, shadow: null, reason: "failed_roll" };
  }

  const rank = normalizeRank(enemy.rank, cfg.rankOrder);
  const sourceName = typeof enemy.name === "string" && enemy.name.trim() ? enemy.name.trim() : "未知敌人";
  const nowMs = Number.isFinite(Number(now)) && now !== null && now !== undefined ? Number(now) : Date.now();
  const idSeed = `${enemy.id || sourceName}|${player.id || player.name || "player"}|${rngSeed}|${roll}`;
  const shadowId = `sh_${rank.toLowerCase()}_${hashSeed(idSeed).toString(16).padStart(8, "0")}`;

  const shadow = {
    id: shadowId,
    name: sourceName,
    rank,
    level: 1,
    source: sourceName,
    skills: inheritSkills(enemy.skills),
    createdAt: new Date(nowMs).toISOString(),
  };

  return { success: true, chance, roll, shadow, reason: "ok" };
}

// 技能按敌人原样带入（浅拷贝，不做成长/重算）。非法值一律空数组。
function inheritSkills(skills) {
  if (!Array.isArray(skills)) return [];
  return skills
    .filter((s) => s !== null && s !== undefined)
    .map((s) => (isPlainObject(s) ? { ...s } : s));
}

module.exports = {
  canExtract,
  extractionChance,
  rollExtraction,
  shadowCap,
  loadConfig,
  normalizeConfig,
  clearCache,
  RANK_ORDER,
  DEFAULT_CONFIG,
  CONFIG_PATH,
};
