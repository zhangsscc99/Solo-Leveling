// Quest model for Solo Leveling: main quest list derived from chapters.json,
// daily quests driven by server/data/quests.json.
//
// Pure functions throughout — the module never touches the db or res objects.
// server/index.js wires it to storage: detectEvents() maps an /action input to
// quest events, applyDailyEvents() folds them into per-day progress, and
// buildView() assembles the GET /saves/:id/quests payload.
//
// Daily boundary: quests reset at 04:00 UTC (= 13:00 KST), matching the novel's
// daily quest deadline. A quest-day is keyed by the UTC date of its opening
// reset, so [04:00 D, 04:00 D+1) belongs to key "YYYY-MM-DD".

const fs = require("fs");
const path = require("path");
const chaptersEngine = require("./chapters");
const endingEngine = require("./ending");

const DATA_PATH = path.join(__dirname, "..", "data", "quests.json");

const RESET_HOUR_UTC = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

// Events an /action input can produce; quest defs reference these by `event`.
const VALID_EVENTS = ["advance", "skill", "kill"];

// Mirrors the keyword families used by the /action intents and the combat
// panel's canned inputs ("前进" / "释放技能 X" / "攻击"). An input can yield
// several events ("击败敌人后继续前进").
const EVENT_RULES = [
  { event: "advance", match: /前进|探索|走|移动|离开|进入|advance|go/i },
  { event: "skill", match: /释放|施放|咏唱|技能|skill|cast/i },
  { event: "kill", match: /攻击|击败|击杀|消灭|猎杀|斩杀|讨伐|杀死|干掉|补刀|attack|kill|slay/i },
];

let cached = null;

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isPositiveInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v > 0;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateReward(reward, at, errors) {
  if (!isPlainObject(reward)) {
    errors.push(`${at}.reward 必须是对象 { xp, gold, items? }`);
    return;
  }
  ["xp", "gold"].forEach((key) => {
    if (!isPositiveInt(reward[key])) {
      errors.push(`${at}.reward.${key} 必须是正整数`);
    }
  });
  if (reward.items !== undefined) {
    if (!Array.isArray(reward.items)) {
      errors.push(`${at}.reward.items 必须是数组`);
    } else {
      reward.items.forEach((item, i) => {
        const iat = `${at}.reward.items[${i}]`;
        if (!isPlainObject(item) || !isNonEmptyString(item.id) || !isNonEmptyString(item.name) || !isPositiveInt(item.qty)) {
          errors.push(`${iat} 必须是 { id, name, qty:正整数 }`);
        }
      });
    }
  }
}

// Returns { ok, errors }. Never throws — loadQuests() decides fail-fast.
function validateQuests(data) {
  const errors = [];

  if (!isPlainObject(data)) {
    return { ok: false, errors: ["quests.json 顶层必须是对象 { version, daily, penalty, main_rewards }"] };
  }

  if (!Array.isArray(data.daily) || data.daily.length < 2 || data.daily.length > 3) {
    errors.push(`daily 必须是 2–3 条每日任务，实际 ${Array.isArray(data.daily) ? data.daily.length : "非数组"}`);
  } else {
    const ids = new Set();
    data.daily.forEach((quest, i) => {
      const at = `daily[${i}]`;
      if (!isPlainObject(quest)) {
        errors.push(`${at} 必须是对象`);
        return;
      }
      if (!isNonEmptyString(quest.id)) {
        errors.push(`${at}.id 必须是非空字符串`);
      } else if (ids.has(quest.id)) {
        errors.push(`${at}.id 重复: ${quest.id}`);
      } else {
        ids.add(quest.id);
      }
      ["title", "desc"].forEach((field) => {
        if (!isNonEmptyString(quest[field])) errors.push(`${at}.${field} 必须是非空字符串`);
      });
      if (!VALID_EVENTS.includes(quest.event)) {
        errors.push(`${at}.event 非法: ${JSON.stringify(quest.event)}（应为 ${VALID_EVENTS.join("/")}）`);
      }
      if (!isPositiveInt(quest.target)) {
        errors.push(`${at}.target 必须是正整数`);
      }
      validateReward(quest.reward, at, errors);
    });
  }

  if (!isPlainObject(data.penalty)) {
    errors.push("penalty 必须是对象 { duration_sec, desc }");
  } else {
    if (!isPositiveInt(data.penalty.duration_sec)) {
      errors.push("penalty.duration_sec 必须是正整数");
    }
    if (!isNonEmptyString(data.penalty.desc)) {
      errors.push("penalty.desc 必须是非空字符串");
    }
  }

  if (data.main_rewards !== undefined) {
    if (!isPlainObject(data.main_rewards)) {
      errors.push("main_rewards 必须是 { 章节id: reward } 对象");
    } else {
      Object.entries(data.main_rewards).forEach(([chapterId, reward]) => {
        if (!/^ch\d+$/.test(chapterId)) {
          errors.push(`main_rewards 键必须是章节 id（chN），实际: ${chapterId}`);
        }
        validateReward(reward, `main_rewards.${chapterId}`, errors);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

function clearCache() {
  cached = null;
}

// Reads + validates once. Throws on any validation error so a bad data edit
// fails at require/boot time, not mid-playthrough.
function loadQuests() {
  if (cached) return cached;

  let raw;
  try {
    raw = fs.readFileSync(DATA_PATH, "utf8");
  } catch (err) {
    throw new Error(`无法读取 quests.json (${DATA_PATH}): ${err.message}`);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`quests.json 不是合法 JSON: ${err.message}`);
  }

  const { ok, errors } = validateQuests(data);
  if (!ok) {
    const err = new Error(`quests.json 校验失败（${errors.length} 项）:\n- ${errors.join("\n- ")}`);
    err.code = "QUESTS_INVALID";
    err.details = errors;
    throw err;
  }

  cached = data;
  return cached;
}

// ---------------------------------------------------------------------------
// Reset boundary math (04:00 UTC / 13:00 KST)
// ---------------------------------------------------------------------------

function toDate(now) {
  if (now instanceof Date) return now;
  const d = new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error(`非法时间: ${JSON.stringify(now)}`);
  return d;
}

// Most recent 04:00 UTC boundary at or before `now`.
function lastReset(now = new Date()) {
  const t = toDate(now);
  const boundary = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), RESET_HOUR_UTC);
  return new Date(t.getTime() >= boundary ? boundary : boundary - DAY_MS);
}

function nextReset(now = new Date()) {
  return new Date(lastReset(now).getTime() + DAY_MS);
}

// Quest-day key: the UTC date of the boundary that opened this quest-day.
function dayKey(now = new Date()) {
  return lastReset(now).toISOString().slice(0, 10);
}

// Key of the quest-day that ended at the current day's opening boundary.
function prevDayKey(now = new Date()) {
  return new Date(lastReset(now).getTime() - DAY_MS).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Progress engine
// ---------------------------------------------------------------------------

function detectEvents(input) {
  if (typeof input !== "string" || !input.trim()) return [];
  const out = [];
  for (const rule of EVENT_RULES) {
    if (rule.match.test(input)) out.push(rule.event);
  }
  return out;
}

// rows: persisted [{ quest_id, progress, done }] for the current quest-day.
// Returns { state, updates, completed } — updates are the rows to write back,
// completed the defs that finished on this call (already-done quests are
// skipped so a repeat event never double-settles).
function applyDailyEvents(defs, rows, events) {
  const counts = {};
  for (const e of events || []) counts[e] = (counts[e] || 0) + 1;

  const state = new Map();
  for (const row of rows || []) {
    if (!row || typeof row.quest_id !== "string") continue;
    state.set(row.quest_id, {
      progress: Math.max(0, Math.trunc(Number(row.progress) || 0)),
      done: Boolean(row.done),
    });
  }

  const updates = [];
  const completed = [];
  for (const def of defs || []) {
    const add = counts[def.event] || 0;
    if (!add) continue;
    const cur = state.get(def.id) || { progress: 0, done: false };
    if (cur.done) continue;
    const progress = Math.min(def.target, cur.progress + add);
    const done = progress >= def.target;
    const next = { quest_id: def.id, progress, done };
    state.set(def.id, { progress, done });
    updates.push(next);
    if (done) completed.push(def);
  }
  return { state, updates, completed };
}

// Sum reward payloads of completed quest defs -> { xp, gold, items }.
function mergeRewards(defs) {
  const total = { xp: 0, gold: 0, items: [] };
  for (const def of defs || []) {
    const r = def && def.reward;
    if (!r) continue;
    total.xp += Number(r.xp) || 0;
    total.gold += Number(r.gold) || 0;
    for (const item of r.items || []) total.items.push(item);
  }
  return total;
}

// ---------------------------------------------------------------------------
// View assembly
// ---------------------------------------------------------------------------

const DEFAULT_MAIN_REWARD = { xp: 100, "gold": 50 };

// One main quest per chapter: done before save.chapter, active on it,
// locked after. Progress shares the scene runtime's main-chain semantics —
// target = 本章主线链长度（支线场景不计入），current = 当前场景在链中的
// 位置 + 1，与 saveView.chapter_steps / chapter_total 同一口径（双源一致）。
function buildMainQuests(chapterList, save, mainRewards) {
  const current = Math.max(1, Math.trunc(Number(save && save.chapter) || 1));
  const rewards = mainRewards || {};
  // F082：已通关（当前场景为 ch8_epilogue）时当前章主线收束为 done——
  // 数据层先保证 done/cleared 正确，「已达成」的 UI 呈现归 F091。
  const cleared = endingEngine.hasCleared(save);

  return (chapterList || []).map((chapter) => {
    let status =
      chapter.index < current || (chapter.index === current && cleared)
        ? "done"
        : chapter.index === current
          ? "active"
          : "locked";
    const target = Math.max(1, chaptersEngine.chapterPath(chapter).length);
    let done = 0;
    if (status === "done") done = target;
    else if (status === "active") {
      const scene = chaptersEngine.currentScene(save);
      const idx = scene ? chaptersEngine.pathIndexOf(chapter, scene.id) : -1;
      done = idx >= 0 ? idx + 1 : 0;
      // 终章收束（F091）：站在最后一章主线链尾（ch8_epilogue，与
      // saveView.chapter_completed / hasCleared 同口径）时，本条主线从
      // 「进行中」翻成 done——否则终章 5/5 永远标「进行中」。
      // 中途章节在链尾仍保持 active：过门穿章是玩家尚未完成的动作，
      // 且 chapter-gate 契约要求当前章主线维持 active 到跨章。
      if (
        chapter.index === chaptersEngine.CHAPTER_COUNT &&
        idx >= 0 &&
        idx === target - 1
      ) {
        status = "done";
      }
    }
    const reward = rewards[chapter.id] || {
      xp: DEFAULT_MAIN_REWARD.xp * chapter.index,
      gold: DEFAULT_MAIN_REWARD.gold * chapter.index,
    };
    return {
      id: `main_${chapter.id}`,
      chapter: chapter.index,
      title: `第${chapter.index}章 · ${chapter.title}`,
      desc: chapter.summary,
      progress: { current: done, target },
      reward,
      status,
    };
  });
}

function buildDailyQuests(defs, rows) {
  const byId = new Map((rows || []).map((r) => [r.quest_id, r]));
  return (defs || []).map((def) => {
    const row = byId.get(def.id);
    const done = Boolean(row && row.done);
    return {
      id: def.id,
      title: def.title,
      desc: def.desc,
      progress: {
        current: Math.min(def.target, Math.max(0, Math.trunc(Number(row && row.progress) || 0))),
        target: def.target,
      },
      reward: def.reward,
      status: done ? "done" : "active",
    };
  });
}

// Penalty window: if the quest-day that just ended left any daily undone (or
// never played) while the save already existed, the penalty dungeon runs for
// penalty.duration_sec from that day's closing boundary. A save created after
// the boundary can't be punished for a day it never saw.
function computePenalty({ defs, prevRows, save, now, penalty }) {
  const inactive = { active: false, seconds_left: 0, desc: "" };
  const t = toDate(now);
  const reset = lastReset(t);
  const duration = Math.max(0, Math.trunc(Number(penalty && penalty.duration_sec) || 0));
  if (!duration) return inactive;

  const createdAt = save && save.created_at ? new Date(`${save.created_at.replace(" ", "T")}Z`) : null;
  if (createdAt && createdAt.getTime() >= reset.getTime()) return inactive;

  const byId = new Map((prevRows || []).map((r) => [r.quest_id, r]));
  const cleared = (defs || []).every((def) => byId.get(def.id) && byId.get(def.id).done);
  if (cleared) return inactive;

  const end = reset.getTime() + duration * 1000;
  const left = Math.floor((end - t.getTime()) / 1000);
  if (left <= 0) return inactive;
  return { active: true, seconds_left: left, desc: penalty.desc };
}

// Full GET /saves/:id/quests payload.
function buildView({ save, data, chaptersData, todayRows, prevRows, now }) {
  const t = toDate(now || new Date());
  const questData = data || loadQuests();
  const chapterList = (chaptersData && chaptersData.chapters) || [];
  return {
    main: buildMainQuests(chapterList, save, questData.main_rewards),
    daily: buildDailyQuests(questData.daily, todayRows),
    daily_reset_at: nextReset(t).toISOString(),
    penalty: computePenalty({
      defs: questData.daily,
      prevRows,
      save,
      now: t,
      penalty: questData.penalty,
    }),
  };
}

module.exports = {
  DATA_PATH,
  RESET_HOUR_UTC,
  VALID_EVENTS,
  EVENT_RULES,
  loadQuests,
  clearCache,
  validateQuests,
  lastReset,
  nextReset,
  dayKey,
  prevDayKey,
  detectEvents,
  applyDailyEvents,
  mergeRewards,
  buildMainQuests,
  buildDailyQuests,
  computePenalty,
  buildView,
};
