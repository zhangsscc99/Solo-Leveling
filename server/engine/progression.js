const path = require("path");
const LEVELS = require(path.join(__dirname, "..", "data", "levels.json"));

const MAX_LEVEL = 60;
const VALID_STATS = ["strength", "agility", "vitality", "intelligence", "perception"];
const STAT_NAMES = {
  strength: "力量",
  agility: "敏捷",
  vitality: "体力",
  intelligence: "智力",
  perception: "感知",
};
const RANK_UP_AT = { 10: "D", 20: "C", 30: "B", 40: "A", 50: "S" };

const table = new Map(LEVELS.map((e) => [e.level, e]));

// Accept both camelCase and snake_case state keys (db rows use snake_case).
function getKey(state, camel) {
  const snake = camel.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
  return state[camel] !== undefined ? camel : snake;
}
function get(state, camel, fallback) {
  const v = state[getKey(state, camel)];
  return v === undefined ? fallback : v;
}
function set(state, camel, value) {
  state[getKey(state, camel)] = value;
}

// 60 级为等级上限，没有「下一级」，统一返回 0（调用方可用 MAX_LEVEL 判断封顶）。
function xpToNext(level) {
  const entry = table.get(level);
  if (!entry || level >= MAX_LEVEL) return 0;
  return entry.xpToNext;
}

function maxHpFor(level, stats) {
  return 80 + level * 4 + (stats.vitality || 0) * 10;
}
function maxMpFor(level, stats) {
  return 10 + level * 2 + (stats.intelligence || 0) * 5;
}

function cloneState(state) {
  return { ...state, stats: { ...(state.stats || {}) } };
}

function applyXp(state, gained) {
  const next = cloneState(state);
  const events = [];
  if (typeof gained !== "number" || !Number.isFinite(gained) || gained <= 0) {
    return { state: next, events };
  }

  let level = get(next, "level", 1) || 1;
  let xp = get(next, "xp", 0) + Math.floor(gained);
  const stats = next.stats || (next.stats = {});

  while (level < MAX_LEVEL) {
    const need = xpToNext(level);
    if (need <= 0 || xp < need) break;
    xp -= need;
    level += 1;

    const entry = table.get(level) || {};
    const points = entry.freePoints || 0;
    const maxHp = maxHpFor(level, stats);
    const maxMp = maxMpFor(level, stats);
    set(next, "maxHp", maxHp);
    set(next, "maxMp", maxMp);
    set(next, "hp", maxHp);
    set(next, "mp", maxMp);
    set(next, "freePoints", get(next, "freePoints", 0) + points);

    events.push({
      type: "levelup",
      level,
      freePoints: points,
      message: `【系统】等级提升！Lv.${level - 1} → Lv.${level}，HP/MP 已完全恢复，获得 ${points} 点自由属性点。`,
    });

    const newRank = RANK_UP_AT[level];
    if (newRank) {
      set(next, "rank", newRank);
      events.push({
        type: "rankup",
        rank: newRank,
        level,
        message: `【系统】猎人等级晋升！你已突破界限，晋升为 ${newRank} 级猎人！`,
      });
    }
  }

  if (level >= MAX_LEVEL) {
    level = MAX_LEVEL;
    xp = 0;
  }
  set(next, "level", level);
  set(next, "xp", xp);
  return { state: next, events };
}

function spendPoint(state, stat) {
  const next = cloneState(state);
  const events = [];

  if (!VALID_STATS.includes(stat)) {
    events.push({
      type: "error",
      message: `【系统】无法加点：「${stat}」不是有效属性。可选属性：${VALID_STATS.map((s) => STAT_NAMES[s]).join("、")}。`,
    });
    return { state: next, events };
  }
  const freePoints = get(next, "freePoints", 0) || 0;
  if (freePoints <= 0) {
    events.push({
      type: "error",
      message: "【系统】无法加点：没有剩余的自由属性点。",
    });
    return { state: next, events };
  }

  const stats = next.stats || (next.stats = {});
  stats[stat] = (stats[stat] || 0) + 1;
  set(next, "freePoints", freePoints - 1);

  const level = get(next, "level", 1) || 1;
  if (stat === "vitality") set(next, "maxHp", maxHpFor(level, stats));
  if (stat === "intelligence") set(next, "maxMp", maxMpFor(level, stats));

  events.push({
    type: "spend",
    stat,
    message: `【系统】已将 1 点自由属性点分配至「${STAT_NAMES[stat]}」（当前 ${stats[stat]}），剩余 ${freePoints - 1} 点。`,
  });
  return { state: next, events };
}

module.exports = { xpToNext, applyXp, spendPoint, MAX_LEVEL, VALID_STATS };
