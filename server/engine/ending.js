// ============================================================================
// F073 真实通关结算 —— 结局面板的唯一取数处，路由只负责喂数据。
// 纯函数 + 章节数据只读查找：不写库；任何 NaN / 缺省 / 非法输入都安全降级，
// 绝不回落到示例数字。
//
//   level            存档等级            save.level
//   kills            总击杀              save.kills（见下方「死字段」说明）
//   shadows          影子数量            shadows 数组长度 / countShadows 计数
//   clear_time       通关耗时            save.cleared_at - save.created_at（冻结）
//   chapters_cleared 已通章节            到结局场景 = 8，否则 max(0, chapter - 1)
//
// 通关门禁 hasCleared(save)：唯一判定处。只有当存档的当前场景解析为
// ch8_epilogue（save.chapter=8 且 save.scene 属于第 8 章且是该场景）才算通关；
// chapter>=8 只代表「人在最后一章」，不算通关。/saves/:id/ending 路由与前端
// 「结算」tab（经 save.cleared 字段）共用此判定。
//
// 死字段说明：
//   kills    saves 列存在，但全仓库没有任何写入路径 —— 真实击杀数依赖战斗
//            结算车道落地后由它写入。当前恒为 0，语义是「未统计」而非「零
//            击杀」；出参保留原值，展示层按 kills>0 决定是否显示数字。
//   scene    由 F074 场景运行时推进写入（已列入 MUTABLE_COLUMNS），该车道
//            落地后本门禁自动生效，不需要再改这里。
//   cleared_at  首次抵达结局场景时由结算路由一次性写入（db.markCleared），
//            通关耗时因此冻结，不随刷新递增。
// ============================================================================

const { num } = require("./stats");
const chaptersEngine = require("./chapters");

const EPILOGUE_SCENE_ID = "ch8_epilogue";
const FINAL_CHAPTER = 8;
const MAX_HOURS = 99;
const DASH = "—";

// 毫秒 → "H:MM:SS"。负数 / NaN / 非有限输入一律 "0:00:00"；超过 99 小时
// 不再累加小时位（初版面格按短串设计），回退为 DASH。
function formatDuration(ms) {
  const n = num(ms);
  if (n <= 0) return "0:00:00";
  const total = Math.floor(n / 1000);
  if (Math.floor(total / 3600) > MAX_HOURS) return DASH;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (v) => String(v).padStart(2, "0");
  return `${h}:${pad(m)}:${pad(s)}`;
}

// SQLite datetime('now') 是 UTC "YYYY-MM-DD HH:MM:SS"；已带时区后缀
// （Z 或 ±HH:MM）的串直接解析，否则补 T/Z 按 UTC 解析。
// 解析失败返回 NaN，由调用方降级为 DASH，不猜时区不伪造。
function parseCreatedAt(createdAt) {
  if (typeof createdAt !== "string" || !createdAt.trim()) return NaN;
  const s = createdAt.trim();
  const t = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(s) ? Date.parse(s) : Date.parse(s.replace(" ", "T") + "Z");
  return Number.isFinite(t) ? t : NaN;
}

// shadows 入参兼容两种来源：getShadows 的数组（取 length）或
// countShadows 的计数（取数值本身）。其它形状 → 0。
function shadowCount(shadows) {
  if (Array.isArray(shadows)) return shadows.length;
  return Math.max(0, Math.floor(num(shadows)));
}

// 通关门禁（唯一判定）：存档当前场景解析为 ch8 结局场景才算通关。
// chaptersEngine.currentScene 已保证 scene 属于 save.chapter，且对缺失 /
// 错章的 scene 回退到该章首场景 —— 所以 chapter=8 但人还在 ch8_jeju 的
// 存档在这里是 false。
function hasCleared(save) {
  try {
    const scene = chaptersEngine.currentScene(save);
    return Boolean(scene && scene.id === EPILOGUE_SCENE_ID);
  } catch {
    // 章节数据异常时按未通关降级：门禁宁紧不松，且不能拖垮其它走 saveView 的路由。
    return false;
  }
}

// 已通章节：抵达结局场景 = 8 章全通；否则当前章还在打，记 chapter-1。
function chaptersClearedOf(save) {
  if (hasCleared(save)) return FINAL_CHAPTER;
  const ch = Math.floor(num(save && save.chapter));
  return Math.max(0, Math.min(FINAL_CHAPTER, ch - 1));
}

function buildStats({ save, shadows, chaptersCleared } = {}) {
  const src = save && typeof save === "object" ? save : {};
  const cleared =
    chaptersCleared === undefined ? chaptersClearedOf(src) : Math.max(0, Math.floor(num(chaptersCleared)));
  const createdMs = parseCreatedAt(src.created_at);
  const clearedMs = parseCreatedAt(src.cleared_at);
  return {
    level: Math.max(0, Math.floor(num(src.level))),
    kills: Math.max(0, Math.floor(num(src.kills))),
    shadows: shadowCount(shadows),
    // 通关耗时 = cleared_at（抵达结局场景的冻结时刻）- created_at。
    // 缺冻结时间戳（旧档）或任一解析失败 → DASH，不再是随刷新递增的活值。
    clear_time: Number.isFinite(createdMs) && Number.isFinite(clearedMs)
      ? formatDuration(clearedMs - createdMs)
      : DASH,
    chapters_cleared: cleared,
  };
}

// kills 展示值：战斗结算车道未接入，0/缺省是「未统计」，渲染成 DASH 而不是
// 假战绩「0」；一旦有真实写入（>0）直接透传。
function killsText(kills) {
  const n = Math.floor(num(kills));
  return n > 0 ? String(n) : DASH;
}

// 战绩行：按真实影子数据派生，不再硬编码「获得 Beru」。有 Beru 影子才提
// Beru；影子军团数按实际值；无任何影子数据时收在中性文案。
function achievementText(shadows) {
  const list = Array.isArray(shadows) ? shadows : [];
  const n = shadowCount(shadows);
  const hasBeru = list.some((s) => {
    const key = `${(s && (s.id || s.shadow_id)) || ""} ${(s && s.name) || ""}`;
    return /beru|贝尔|伯鲁/i.test(key);
  });
  let line = "战绩结算：S 级传送门攻略完成，济州岛战役生还";
  if (hasBeru) line += "，获得影子「Beru」";
  if (n > 0) line += `，影子军团 ×${n}`;
  return `${line}。`;
}

// 模板渲染：{level} {kills} {shadows} {clear_time} {chapters_cleared}
// {achievement} 换成实值；未知占位符原样保留，不做猜测替换。
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

// 汇总出参：chapter 回传章节序号，title/lines 取自 epilogue 场景的 stats
// 模板块。stats.kills 保留原始数字（对账用），渲染表里的 kills 才换 DASH。
function buildEnding({ save, shadows, chapter } = {}) {
  const scene = findEpilogueScene(chapter);
  const block = scene && scene.stats && typeof scene.stats === "object" ? scene.stats : {};
  const stats = buildStats({ save, shadows });
  const table = { ...stats, kills: killsText(stats.kills), achievement: achievementText(shadows) };
  return {
    chapter: chapter && Number.isInteger(chapter.index) ? chapter.index : Math.floor(num(chapter)),
    title: typeof block.title === "string" ? block.title : "",
    epilogue: scene && typeof scene.text === "string" ? scene.text : "",
    stats,
    lines: renderLines(block.lines, table),
  };
}

module.exports = {
  EPILOGUE_SCENE_ID,
  FINAL_CHAPTER,
  DASH,
  formatDuration,
  parseCreatedAt,
  shadowCount,
  hasCleared,
  chaptersClearedOf,
  killsText,
  achievementText,
  buildStats,
  renderLines,
  buildEnding,
};
