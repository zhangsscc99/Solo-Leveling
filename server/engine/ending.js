// ============================================================================
// F073 真实通关结算 —— 结局面板的唯一取数处，路由只负责喂数据。
// 全部为纯函数：无副作用、不读库；任何 NaN / 缺省 / 非法输入都安全降级，
// 绝不回落到示例数字。
//
//   level            存档等级          save.level
//   kills            总击杀            save.kills（saves 表列，缺省 0）
//   shadows          影子数量          shadows 数组长度 / countShadows 计数
//   clear_time       通关耗时          now - save.created_at（UTC "YYYY-MM-DD HH:MM:SS"）
//   chapters_cleared 已通章节          save.chapter >= 8 ? 8 : max(0, chapter - 1)
// ============================================================================

const { num } = require("./stats");

const EPILOGUE_SCENE_ID = "ch8_epilogue";
const FINAL_CHAPTER = 8;

// 毫秒 → "H:MM:SS"。负数 / NaN / 非有限输入一律 "0:00:00"。
function formatDuration(ms) {
  const n = num(ms);
  if (n <= 0) return "0:00:00";
  const total = Math.floor(n / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

// SQLite datetime('now') 是 UTC "YYYY-MM-DD HH:MM:SS"，补 T/Z 按 UTC 解析。
// 解析失败返回 NaN，由调用方降级，不猜时区不伪造。
function parseCreatedAt(createdAt) {
  if (typeof createdAt !== "string" || !createdAt.trim()) return NaN;
  const t = Date.parse(createdAt.trim().replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : NaN;
}

// shadows 入参兼容两种来源：getShadows 的数组（取 length）或
// countShadows 的计数（取数值本身）。其它形状 → 0。
function shadowCount(shadows) {
  if (Array.isArray(shadows)) return shadows.length;
  return Math.max(0, Math.floor(num(shadows)));
}

// 已通章节：到第 8 章即视为 8 章全通，否则 chapter-1（当前章还在打）。
function chaptersClearedOf(save) {
  const ch = Math.floor(num(save && save.chapter));
  return ch >= FINAL_CHAPTER ? FINAL_CHAPTER : Math.max(0, ch - 1);
}

function buildStats({ save, shadows, chaptersCleared, now } = {}) {
  const src = save && typeof save === "object" ? save : {};
  const cleared =
    chaptersCleared === undefined ? chaptersClearedOf(src) : Math.max(0, Math.floor(num(chaptersCleared)));
  const createdMs = parseCreatedAt(src.created_at);
  return {
    level: Math.max(0, Math.floor(num(src.level))),
    kills: Math.max(0, Math.floor(num(src.kills))),
    shadows: shadowCount(shadows),
    // created_at 解析不出或 now 缺省（num→0，差值必为负）都落到 "0:00:00"。
    clear_time: Number.isFinite(createdMs) ? formatDuration(num(now) - createdMs) : "0:00:00",
    chapters_cleared: cleared,
  };
}

// 模板渲染：{level} {kills} {shadows} {clear_time} {chapters_cleared} 换成
// stats 实值；未知占位符原样保留，不做猜测替换。
function renderLines(lines, stats) {
  if (!Array.isArray(lines)) return [];
  const table = stats && typeof stats === "object" ? stats : {};
  return lines.map((line) =>
    String(line).replace(/\{(\w+)\}/g, (raw, key) => {
      const v = table[key];
      return v === undefined || v === null ? raw : String(v);
    })
  );
}

function findEpilogueScene(chapter) {
  const scenes = chapter && Array.isArray(chapter.scenes) ? chapter.scenes : [];
  return scenes.find((s) => s && s.id === EPILOGUE_SCENE_ID) || null;
}

// 汇总出参：chapter 回传章节序号，title/lines 取自 epilogue 场景的 stats 模板块。
function buildEnding({ save, shadows, chapter, now } = {}) {
  const scene = findEpilogueScene(chapter);
  const block = scene && scene.stats && typeof scene.stats === "object" ? scene.stats : {};
  const stats = buildStats({ save, shadows, now });
  return {
    chapter: chapter && Number.isInteger(chapter.index) ? chapter.index : Math.floor(num(chapter)),
    title: typeof block.title === "string" ? block.title : "",
    epilogue: scene && typeof scene.text === "string" ? scene.text : "",
    stats,
    lines: renderLines(block.lines, stats),
  };
}

module.exports = {
  EPILOGUE_SCENE_ID,
  FINAL_CHAPTER,
  formatDuration,
  parseCreatedAt,
  shadowCount,
  chaptersClearedOf,
  buildStats,
  renderLines,
  buildEnding,
};
