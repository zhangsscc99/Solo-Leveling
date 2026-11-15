// F023 上下文压缩：只把「状态摘要 + 最近 N 条日志 + 当前输入」送给 gateway。
//
// CommonJS，无第三方依赖，纯函数，永不抛异常（任何坏输入都降级为空结构）。
// 本模块只做裁剪与拼装，不读数据库、不发网络请求，也不 import gateway。
//
// 导出：
//   STATE_SUMMARY_FIELDS  摘要允许携带的 save 字段白名单（其余一律丢弃）
//   DEFAULT_LOG_LIMIT     默认保留的日志条数（6）
//   DEFAULT_MAX_ENTRY_CHARS 单条日志的字符上限（240）
//   DEFAULT_MAX_CHARS     上下文总字符预算（2400）
//   LOG_ROLES             合法日志角色（system/narrator/user/ai）
//   pickStateFields(save) 白名单后的紧凑状态对象（缺字段即缺键，不抛）
//   summarizeState(save, extra) -> string   中文单行状态摘要（等宽数值）
//   tailLogs(logs, limit, maxEntryChars) -> [{ role, content, truncated }]
//   estimateChars(context) -> number        与 buildContext().usedChars 同口径
//   buildContext(opts) -> {
//     summary:  string                  状态摘要文本（预算再紧也不裁剪）
//     history:  [{ role, content }]     最老的在前，最多 limit 条
//     input:    string                  当前玩家输入（预算再紧也不裁剪）
//     usedChars: number                 summary + history + input 的字符总数
//     truncated: boolean                是否发生过任何裁剪（丢日志或截断单条）
//     droppedLogs: number               被整条淘汰的日志数（从最老的开始）
//     clippedLogs: number               被截断正文的日志数
//     maxChars: number                  生效的字符预算
//     budget:   number                  扣掉摘要与输入后留给日志的字符额度
//   }
// buildContext 的入参：{ save, logs, playerInput, limit, maxChars, maxEntryChars, extra }
// 预算裁剪顺序：先整条淘汰最老的日志，仍超预算就截断剩下的最新一条；
// 状态摘要与当前输入永远保留（哪怕它们本身就超预算）。

const STATE_SUMMARY_FIELDS = Object.freeze([
  "player_name",
  "rank",
  "level",
  "chapter",
  "hp",
  "max_hp",
  "mp",
  "max_mp",
  "stats",
  "gold",
  "xp",
  "xp_to_next",
  "free_points",
]);

const STAT_KEYS = Object.freeze(["strength", "agility", "vitality", "intelligence", "perception"]);
const STAT_LABELS = Object.freeze(["力", "敏", "体", "智", "感"]);

const LOG_ROLES = Object.freeze(["system", "narrator", "user", "ai"]);
const DEFAULT_LOG_LIMIT = 6;
const DEFAULT_MAX_ENTRY_CHARS = 240;
const DEFAULT_MAX_CHARS = 2400;
const ELLIPSIS = "…";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toInt(value, fallback) {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

// 等宽数值：不足宽度左补空格，超宽不截断（状态数字必须完整可读）。
function pad(value, width) {
  const text = String(value);
  return text.length >= width ? text : " ".repeat(width - text.length) + text;
}

// 按码点截断，避免把代理对（emoji / 生僻字）劈成半个字符。
function clip(text, maxChars) {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return { text, truncated: false };
  const keep = Math.max(0, maxChars - 1);
  return { text: chars.slice(0, keep).join("") + ELLIPSIS, truncated: true };
}

function pickStateFields(save) {
  const out = {};
  if (!isObject(save)) return out;
  for (const field of STATE_SUMMARY_FIELDS) {
    if (field === "stats") {
      if (!isObject(save.stats)) continue;
      const stats = {};
      for (const key of STAT_KEYS) {
        if (save.stats[key] === undefined || save.stats[key] === null) continue;
        const n = toInt(save.stats[key], NaN);
        stats[key] = Number.isFinite(n) ? n : save.stats[key];
      }
      out.stats = stats;
      continue;
    }
    if (save[field] === undefined || save[field] === null) continue;
    out[field] = save[field];
  }
  return out;
}

function extraText(extra) {
  if (extra === undefined || extra === null) return "";
  if (typeof extra === "string") return extra.trim();
  if (Array.isArray(extra)) {
    return extra
      .filter((line) => typeof line === "string" && line.trim())
      .map((line) => line.trim())
      .join(" · ");
  }
  if (isObject(extra)) {
    // 排序保证同一输入永远输出同一摘要。
    return Object.keys(extra)
      .sort()
      .filter((key) => extra[key] !== undefined && extra[key] !== null && extra[key] !== "")
      .map((key) => `${key}=${extra[key]}`)
      .join(" · ");
  }
  return "";
}

// 一行中文摘要，缺字段用默认值兜底，永不抛。
function summarizeState(save, extra) {
  try {
    const s = isObject(save) ? save : {};
    const stats = isObject(s.stats) ? s.stats : {};

    const rawName = typeof s.player_name === "string" ? s.player_name.trim() : "";
    const name = rawName || "无名猎人";
    const rawRank = typeof s.rank === "string" ? s.rank.trim() : "";
    const rank = (rawRank || "E").toUpperCase();
    const level = toInt(s.level, 1);
    const chapter = toInt(s.chapter, 1);
    const hp = toInt(s.hp, 0);
    const maxHp = toInt(s.max_hp, 0);
    const mp = toInt(s.mp, 0);
    const maxMp = toInt(s.max_mp, 0);
    const gold = toInt(s.gold, 0);
    const xp = toInt(s.xp, 0);
    const xpToNext = toInt(s.xp_to_next, -1);
    const freePoints = toInt(s.free_points, 0);

    const statLine = STAT_KEYS.map((key, i) => {
      const n = toInt(stats[key], NaN);
      return `${STAT_LABELS[i]} ${pad(Number.isFinite(n) ? n : "-", 3)}`;
    }).join(" · ");

    const xpText = xpToNext >= 0 ? `XP ${pad(xp, 6)}/${pad(xp + xpToNext, 6)}` : `XP ${pad(xp, 6)}`;

    const parts = [
      `【状态】${name} · Lv.${pad(level, 2)} · ${rank} 级猎人 · 第 ${chapter} 章`,
      `HP ${pad(hp, 3)}/${pad(maxHp, 3)} · MP ${pad(mp, 3)}/${pad(maxMp, 3)}`,
      statLine,
      `金币 ${pad(gold, 6)} · ${xpText} · 自由点数 ${pad(freePoints, 2)}`,
    ];

    const tail = extraText(extra);
    if (tail) parts.push(tail);
    return parts.join(" | ");
  } catch {
    return "【状态】数据不可用";
  }
}

function normalizeRole(role) {
  if (typeof role !== "string") return "narrator";
  const value = role.trim().toLowerCase();
  return LOG_ROLES.includes(value) ? value : "narrator";
}

// 只取最近 limit 条，保持原始顺序（最老的在前），单条按码点截断。
function tailLogs(logs, limit = DEFAULT_LOG_LIMIT, maxEntryChars = DEFAULT_MAX_ENTRY_CHARS) {
  try {
    if (!Array.isArray(logs) || logs.length === 0) return [];
    const take = toInt(limit, DEFAULT_LOG_LIMIT);
    const entries = take > 0 ? take : DEFAULT_LOG_LIMIT;
    const cap = toInt(maxEntryChars, DEFAULT_MAX_ENTRY_CHARS);
    const entryCap = cap > 0 ? cap : DEFAULT_MAX_ENTRY_CHARS;

    const recent = logs.slice(-entries);
    const out = [];
    for (const entry of recent) {
      if (!isObject(entry)) continue;
      const raw = typeof entry.content === "string" ? entry.content : "";
      if (!raw) continue;
      const { text, truncated } = clip(raw, entryCap);
      out.push({ role: normalizeRole(entry.role), content: text, truncated });
    }
    return out;
  } catch {
    return [];
  }
}

function historyChars(history) {
  let total = 0;
  for (const item of history) total += item.content.length;
  return total;
}

function estimateChars(context) {
  try {
    if (!isObject(context)) return 0;
    const summary = typeof context.summary === "string" ? context.summary : "";
    const input = typeof context.input === "string" ? context.input : "";
    const history = Array.isArray(context.history) ? context.history : [];
    return summary.length + historyChars(history) + input.length;
  } catch {
    return 0;
  }
}

function buildContext(options) {
  const fallback = {
    summary: "",
    history: [],
    input: "",
    usedChars: 0,
    truncated: false,
    droppedLogs: 0,
    clippedLogs: 0,
    maxChars: DEFAULT_MAX_CHARS,
    budget: 0,
  };

  try {
    const opts = isObject(options) ? options : {};
    const summary = summarizeState(opts.save, opts.extra);
    const input = typeof opts.playerInput === "string" ? opts.playerInput : "";

    const rawMax = toInt(opts.maxChars, DEFAULT_MAX_CHARS);
    const maxChars = rawMax > 0 ? rawMax : DEFAULT_MAX_CHARS;
    const rawLimit = toInt(opts.limit, DEFAULT_LOG_LIMIT);
    const limit = rawLimit > 0 ? rawLimit : DEFAULT_LOG_LIMIT;

    const budget = maxChars - summary.length - input.length;
    let history = tailLogs(opts.logs, limit, opts.maxEntryChars);

    let droppedLogs = 0;
    let clippedLogs = 0;
    // 单条超长截断在 tailLogs 阶段已发生，这里记住它以便上报 truncated。
    const entryClipped = history.filter((item) => item.truncated).length;

    if (budget <= 0) {
      // 摘要 + 输入已经吃掉全部预算：日志全部让位，但这两段永远保留。
      droppedLogs = history.length;
      history = [];
    } else {
      // 先按最老的优先整条淘汰，直到装得下或者只剩最新一条。
      while (history.length > 1 && historyChars(history) > budget) {
        history.shift();
        droppedLogs += 1;
      }
      // 只剩最新一条仍然超预算：再截断它（绝不动摘要与输入）。
      if (history.length === 1 && historyChars(history) > budget) {
        const last = history[0];
        if (budget < 2) {
          history = [];
          droppedLogs += 1;
        } else {
          history = [{ role: last.role, content: clip(last.content, budget).text, truncated: true }];
          clippedLogs += 1;
        }
      }
    }

    const publicHistory = history.map((item) => ({ role: item.role, content: item.content }));
    const context = {
      summary,
      history: publicHistory,
      input,
      usedChars: 0,
      truncated: entryClipped > 0 || droppedLogs > 0 || clippedLogs > 0,
      droppedLogs,
      clippedLogs,
      maxChars,
      budget,
    };
    context.usedChars = estimateChars(context);
    return context;
  } catch {
    return fallback;
  }
}

module.exports = {
  STATE_SUMMARY_FIELDS,
  LOG_ROLES,
  DEFAULT_LOG_LIMIT,
  DEFAULT_MAX_ENTRY_CHARS,
  DEFAULT_MAX_CHARS,
  pickStateFields,
  summarizeState,
  tailLogs,
  estimateChars,
  buildContext,
};
