// Deterministic loot engine for Solo Leveling.
//
// Pure-ish module: the only side effect is reading drops.json once (cached).
// Every roll is driven by the injected RNG seed, so the same seed against the
// same table always produces the same gold + item bundle.

const fs = require("fs");
const path = require("path");

const TABLE_PATH = path.join(__dirname, "..", "data", "drops.json");

// Fallback ordering if a hand-written table omits rarityOrder.
const DEFAULT_RARITY_ORDER = ["common", "rare", "epic", "legendary"];

const RANK_ORDER = ["E", "D", "C", "B", "A", "S"];

// rank → encounter coefficient. Gold is multiplied directly; each rarity tier
// gets its own multiplier so higher ranks shift the whole distribution upward
// without ever flipping it (common stays highest-weighted per tier).
const RANK_TUNING = {
  E: { gold: 1, rarity: { common: 1, rare: 0.7, epic: 0.35, legendary: 0.1 } },
  D: { gold: 1.3, rarity: { common: 1, rare: 0.9, epic: 0.55, legendary: 0.2 } },
  C: { gold: 1.7, rarity: { common: 1, rare: 1.1, epic: 0.85, legendary: 0.35 } },
  B: { gold: 2.2, rarity: { common: 1, rare: 1.3, epic: 1.2, legendary: 0.6 } },
  A: { gold: 2.9, rarity: { common: 1, rare: 1.55, epic: 1.7, legendary: 0.95 } },
  S: { gold: 3.8, rarity: { common: 1, rare: 1.85, epic: 2.3, legendary: 1.4 } },
};

const EMPTY_ENEMY = { gold: [0, 0], rolls: [0, 0], drops: [] };

let cached = null;

function loadTables() {
  if (cached) return cached;
  const raw = fs.readFileSync(TABLE_PATH, "utf8");
  cached = JSON.parse(raw);
  return cached;
}

function clearCache() {
  cached = null;
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}

function isInt(v) {
  return isNum(v) && Number.isInteger(v);
}

// Inclusive integer range guard: anything malformed degrades to `fallback`.
function rangeOf(value, fallback) {
  if (!Array.isArray(value) || value.length !== 2) return fallback;
  const [a, b] = value;
  if (!isInt(a) || !isInt(b) || a > b || a < 0) return fallback;
  return [a, b];
}

function rarityOrderOf(tables) {
  const order = tables && tables.rarityOrder;
  return Array.isArray(order) && order.length ? order : DEFAULT_RARITY_ORDER;
}

function tuningOf(rank) {
  const key = typeof rank === "string" ? rank.toUpperCase() : "";
  return RANK_TUNING[key] || RANK_TUNING.E;
}

function rankMultiplier(rank) {
  return tuningOf(rank).gold;
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32 — small, fast, good enough for loot tables.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// rngOrSeed: function (already a [0,1) generator), number, or string.
// Omitted → Math.random (non-deterministic, for live play).
function makeRng(rngOrSeed) {
  if (typeof rngOrSeed === "function") return rngOrSeed;
  if (typeof rngOrSeed === "number" && Number.isFinite(rngOrSeed)) {
    return mulberry32(Math.trunc(rngOrSeed) >>> 0);
  }
  if (typeof rngOrSeed === "string") return mulberry32(fnv1a(rngOrSeed));
  if (rngOrSeed === undefined || rngOrSeed === null) return Math.random;
  return mulberry32(fnv1a(String(rngOrSeed)));
}

function rollInt(rng, min, max) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  if (hi <= lo) return lo;
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// entries: [{ weight }]; returns null when nothing is pickable.
function pickWeighted(rng, entries, weightOf) {
  let total = 0;
  const weighted = [];
  for (const entry of entries) {
    const w = Number(weightOf(entry));
    if (!Number.isFinite(w) || w <= 0) continue;
    total += w;
    weighted.push([entry, w]);
  }
  if (!weighted.length || total <= 0) return null;
  let roll = rng() * total;
  for (const [entry, w] of weighted) {
    roll -= w;
    if (roll < 0) return entry;
  }
  return weighted[weighted.length - 1][0];
}

function rollQty(rng, qty) {
  const [min, max] = rangeOf(qty, [1, 1]);
  return rollInt(rng, min, max);
}

// Rank-shifted rarity weights: table weights × rank multiplier, dropping
// non-positive tiers. Never mutates the cached table.
function tierWeights(enemy, rarityOrder, tuning) {
  const base = enemy && enemy.rarityWeights && typeof enemy.rarityWeights === "object" ? enemy.rarityWeights : {};
  return rarityOrder.map((rarity) => {
    const raw = Number(base[rarity]);
    const mul = Number(tuning.rarity[rarity]);
    const weight = Number.isFinite(raw) && Number.isFinite(mul) && raw > 0 && mul > 0 ? raw * mul : 0;
    return { rarity, weight };
  });
}

// If the chosen tier has no entries, walk down the order (rarest → commonest),
// then up (for tables that only define legendary loot).
function entriesForTier(enemy, rarityOrder, tierIndex) {
  const drops = Array.isArray(enemy && enemy.drops) ? enemy.drops : [];
  for (let i = tierIndex; i >= 0; i -= 1) {
    const found = drops.filter((d) => d && d.rarity === rarityOrder[i]);
    if (found.length) return found;
  }
  for (let i = tierIndex + 1; i < rarityOrder.length; i += 1) {
    const found = drops.filter((d) => d && d.rarity === rarityOrder[i]);
    if (found.length) return found;
  }
  return [];
}

function rollLoot(enemyId, rank, rngOrSeed, opts) {
  const options = opts && typeof opts === "object" ? opts : {};
  const tables = options.tables && typeof options.tables === "object" ? options.tables : loadTables();
  const enemies = tables && tables.enemies && typeof tables.enemies === "object" ? tables.enemies : {};
  const key = typeof enemyId === "string" && enemies[enemyId] ? enemyId : "fallback";
  const enemy = enemies[key] || EMPTY_ENEMY;

  const rng = makeRng(rngOrSeed);
  const rarityOrder = rarityOrderOf(tables);
  const tuning = tuningOf(rank);
  const goldMultiplier = isNum(options.goldMul) && options.goldMul >= 0 ? options.goldMul : 1;

  // Gold first, so item rolls stay independent of the gold bracket.
  const [goldMin, goldMax] = rangeOf(enemy.gold, [0, 0]);
  let gold = rollInt(rng, Math.round(goldMin * tuning.gold), Math.round(goldMax * tuning.gold));
  if (goldMultiplier !== 1) gold = Math.round(gold * goldMultiplier);
  if (goldMin > 0 && gold <= 0) gold = 1;

  const items = [];
  if (!Array.isArray(enemy.drops) || !enemy.drops.length) {
    return { gold: Math.max(0, gold), items };
  }

  const defaultRolls = rangeOf(enemy.rolls, [1, 1]);
  const rolls = isInt(options.rolls) && options.rolls >= 0
    ? options.rolls
    : rollInt(rng, defaultRolls[0], defaultRolls[1]);

  const weights = tierWeights(enemy, rarityOrder, tuning);
  const buckets = new Map(); // item_id → { item_id, qty, rarity }, insertion-ordered

  for (let i = 0; i < rolls; i += 1) {
    const tier = pickWeighted(rng, weights, (w) => w.weight);
    if (!tier) break; // every tier weighted to zero → no item this kill
    const tierIndex = rarityOrder.indexOf(tier.rarity);
    const candidates = entriesForTier(enemy, rarityOrder, tierIndex);
    const drop = pickWeighted(rng, candidates, (d) => d.weight);
    if (!drop) continue;
    const qty = rollQty(rng, drop.qty);
    if (!(qty > 0)) continue;
    const prev = buckets.get(drop.item_id);
    if (prev) {
      prev.qty += qty;
    } else {
      buckets.set(drop.item_id, { item_id: drop.item_id, qty, rarity: drop.rarity });
    }
  }

  return { gold: Math.max(0, gold), items: Array.from(buckets.values()) };
}

function validateTables(tables) {
  const errors = [];

  let table = tables;
  if (table === undefined) {
    try {
      table = loadTables();
    } catch (err) {
      return [`drops.json 读取或解析失败: ${err.message}`];
    }
  }
  if (!table || typeof table !== "object" || Array.isArray(table)) {
    return ["tables 必须是一个对象"];
  }
  if (!isInt(table.version) || table.version < 1) errors.push("version 必须是 >= 1 的整数");

  const rarityOrder = table.rarityOrder;
  if (!Array.isArray(rarityOrder) || !rarityOrder.length) {
    errors.push("rarityOrder 必须是非空字符串数组");
  } else {
    const seen = new Set();
    rarityOrder.forEach((r, i) => {
      if (typeof r !== "string" || !r.trim()) errors.push(`rarityOrder[${i}] 必须是非空字符串`);
      else if (seen.has(r)) errors.push(`rarityOrder 含重复项: ${r}`);
      else seen.add(r);
    });
  }
  const order = Array.isArray(rarityOrder) && rarityOrder.length ? rarityOrder : DEFAULT_RARITY_ORDER;

  const enemies = table.enemies;
  if (!enemies || typeof enemies !== "object" || Array.isArray(enemies)) {
    errors.push("enemies 必须是对象");
    return errors;
  }
  if (!enemies.fallback) errors.push("enemies.fallback 缺失（未知敌人需要回退表）");

  const ids = Object.keys(enemies);
  if (!ids.length) errors.push("enemies 不能为空");

  for (const id of ids) {
    const enemy = enemies[id];
    const at = `enemies.${id}`;
    if (!enemy || typeof enemy !== "object" || Array.isArray(enemy)) {
      errors.push(`${at} 必须是对象`);
      continue;
    }
    if (!Array.isArray(enemy.gold) || enemy.gold.length !== 2 || !isInt(enemy.gold[0]) || !isInt(enemy.gold[1])) {
      errors.push(`${at}.gold 必须是两个整数 [min, max]`);
    } else if (enemy.gold[0] < 0 || enemy.gold[0] > enemy.gold[1]) {
      errors.push(`${at}.gold 需满足 0 <= min <= max`);
    }

    if (enemy.rolls !== undefined) {
      if (!Array.isArray(enemy.rolls) || enemy.rolls.length !== 2 || !isInt(enemy.rolls[0]) || !isInt(enemy.rolls[1])) {
        errors.push(`${at}.rolls 必须是两个整数 [min, max]`);
      } else if (enemy.rolls[0] < 0 || enemy.rolls[0] > enemy.rolls[1]) {
        errors.push(`${at}.rolls 需满足 0 <= min <= max`);
      }
    }

    if (!enemy.rarityWeights || typeof enemy.rarityWeights !== "object") {
      errors.push(`${at}.rarityWeights 必须是对象`);
    } else {
      const keys = Object.keys(enemy.rarityWeights);
      if (!keys.length) errors.push(`${at}.rarityWeights 不能为空`);
      let positive = 0;
      for (const key of keys) {
        if (!order.includes(key)) errors.push(`${at}.rarityWeights 含未知稀有度: ${key}`);
        const w = enemy.rarityWeights[key];
        if (!isNum(w) || w < 0) errors.push(`${at}.rarityWeights.${key} 必须是非负数字`);
        else if (w > 0) positive += 1;
      }
      if (keys.length && positive === 0) errors.push(`${at}.rarityWeights 至少要有一个正权重`);
    }

    if (!Array.isArray(enemy.drops)) {
      errors.push(`${at}.drops 必须是数组`);
      continue;
    }
    if (enemy.drops.length > 8) errors.push(`${at}.drops 条目过多（> 8）`);
    enemy.drops.forEach((drop, i) => {
      const dat = `${at}.drops[${i}]`;
      if (!drop || typeof drop !== "object" || Array.isArray(drop)) {
        errors.push(`${dat} 必须是对象`);
        return;
      }
      if (typeof drop.item_id !== "string" || !drop.item_id.trim()) errors.push(`${dat}.item_id 必须是非空字符串`);
      if (!order.includes(drop.rarity)) errors.push(`${dat}.rarity 不在 rarityOrder 内: ${drop.rarity}`);
      if (!isNum(drop.weight) || drop.weight <= 0) errors.push(`${dat}.weight 必须是正数`);
      const qty = rangeOf(drop.qty, null);
      if (!qty) errors.push(`${dat}.qty 必须是两个整数 [min, max]，且 1 <= min <= max`);
      else if (qty[0] < 1) errors.push(`${dat}.qty 最小值必须 >= 1`);
    });
  }

  return errors;
}

module.exports = {
  rollLoot,
  loadTables,
  validateTables,
  clearCache,
  rankMultiplier,
  RANK_ORDER,
  RANK_TUNING,
  DEFAULT_RARITY_ORDER,
  TABLE_PATH,
};
