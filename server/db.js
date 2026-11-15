const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "game.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS saves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  rank TEXT NOT NULL DEFAULT 'E',
  xp INTEGER NOT NULL DEFAULT 0,
  hp INTEGER NOT NULL DEFAULT 100,
  max_hp INTEGER NOT NULL DEFAULT 100,
  mp INTEGER NOT NULL DEFAULT 20,
  max_mp INTEGER NOT NULL DEFAULT 20,
  stats_json TEXT NOT NULL DEFAULT '{}',
  free_points INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 0,
  chapter INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory (
  save_id INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (save_id, item_id)
);

CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  save_id INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'system', 'narrator')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_log_save_id ON log (save_id, id);

CREATE TABLE IF NOT EXISTS shadows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  save_id INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
  shadow_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rank TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  source TEXT,
  skills TEXT,
  stats_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_shadows_save_id ON shadows (save_id, id);
CREATE INDEX IF NOT EXISTS idx_shadows_shadow_id ON shadows (save_id, shadow_id);

-- 每日任务进度：按「quest-day」（04:00 UTC 为界的日期键）分天记录，
-- 跨天自然隔离，惩罚结算只回看前一天。
CREATE TABLE IF NOT EXISTS quest_daily (
  save_id INTEGER NOT NULL REFERENCES saves(id) ON DELETE CASCADE,
  day_key TEXT NOT NULL,
  quest_id TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  done INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (save_id, day_key, quest_id)
);
`);

// CREATE TABLE IF NOT EXISTS 不会给已有表补列，老库走 ALTER 迁移。
const saveCols = db.prepare("PRAGMA table_info(saves)").all().map((c) => c.name);
if (!saveCols.includes("free_points")) {
  db.exec("ALTER TABLE saves ADD COLUMN free_points INTEGER NOT NULL DEFAULT 0");
}

const shadowCols = db.prepare("PRAGMA table_info(shadows)").all().map((c) => c.name);
if (!shadowCols.includes("stats_json")) {
  db.exec("ALTER TABLE shadows ADD COLUMN stats_json TEXT");
}

const DEFAULT_STATS = {
  strength: 10,
  agility: 12,
  vitality: 8,
  intelligence: 10,
  perception: 14,
};

const PROLOGUE = [
  { role: "narrator", content: "黑暗散去，你发现自己躺在冰冷的石板上，耳边还回荡着某个古老存在的低语。" },
  { role: "narrator", content: "E 级猎人——猎人序列的最底端。最低等的地下城，也能轻易要了你的命。" },
  { role: "narrator", content: "三天前，你跟随队伍踏入一座 D 级传送门，却误入了传说中的「双重地下城」。神像微笑，法则降临，同伴一个接一个倒下。" },
  { role: "narrator", content: "当死亡临近，你没有屈服——于是，某个存在选中了你。" },
  { role: "system", content: "【系统】检测到适格玩家。觉醒仪式已完成。欢迎接入「系统」。" },
  { role: "system", content: "【系统】输入「状态」查看属性面板，输入「帮助」查看可用指令。" },
];

const stmts = {
  insertSave: db.prepare(`
    INSERT INTO saves (player_name, stats_json)
    VALUES (?, ?)
  `),
  getSave: db.prepare(`SELECT * FROM saves WHERE id = ?`),
  touchSave: db.prepare(`UPDATE saves SET updated_at = datetime('now') WHERE id = ?`),
  getInventory: db.prepare(`SELECT item_id, qty FROM inventory WHERE save_id = ?`),
  appendLog: db.prepare(`INSERT INTO log (save_id, role, content) VALUES (?, ?, ?)`),
  getLog: db.prepare(`
    SELECT id, role, content, created_at FROM (
      SELECT id, role, content, created_at FROM log WHERE save_id = ? ORDER BY id DESC LIMIT ?
    ) ORDER BY id ASC
  `),
  insertShadow: db.prepare(`
    INSERT INTO shadows (save_id, shadow_id, name, rank, level, source, skills, stats_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getShadows: db.prepare(`
    SELECT shadow_id, name, rank, level, source, skills, stats_json, created_at
    FROM shadows WHERE save_id = ? ORDER BY id ASC
  `),
  countShadows: db.prepare(`SELECT COUNT(*) AS n FROM shadows WHERE save_id = ?`),
  getShadow: db.prepare(`
    SELECT shadow_id, name, rank, level, source, skills, stats_json, created_at
    FROM shadows WHERE save_id = ? AND shadow_id = ?
  `),
  getDailyQuests: db.prepare(`
    SELECT quest_id, progress, done FROM quest_daily
    WHERE save_id = ? AND day_key = ?
  `),
  setDailyQuest: db.prepare(`
    INSERT INTO quest_daily (save_id, day_key, quest_id, progress, done)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(save_id, day_key, quest_id)
    DO UPDATE SET progress = excluded.progress, done = excluded.done
  `),
};

function toSave(row) {
  if (!row) return null;
  const { stats_json, ...rest } = row;
  let stats = {};
  try {
    stats = JSON.parse(stats_json || "{}");
  } catch {
    stats = {};
  }
  return { ...rest, stats };
}

function createSave(playerName) {
  const tx = db.transaction(() => {
    const info = stmts.insertSave.run(playerName, JSON.stringify(DEFAULT_STATS));
    const id = info.lastInsertRowid;
    for (const line of PROLOGUE) {
      stmts.appendLog.run(id, line.role, line.content);
    }
    return id;
  });
  const id = tx();
  return toSave(stmts.getSave.get(id));
}

function getSave(id) {
  return toSave(stmts.getSave.get(id));
}

// Whitelisted column writes for state mutation (the narrative engine only ever
// changes these through the action endpoint, which clamps values first).
const MUTABLE_COLUMNS = ["hp", "mp", "max_hp", "max_mp", "xp", "gold", "level", "chapter", "rank", "free_points"];

function updateSave(id, patch) {
  if (!patch) return getSave(id);
  const cols = MUTABLE_COLUMNS.filter((c) => patch[c] !== undefined);
  const sets = cols.map((c) => `${c} = ?`);
  const values = cols.map((c) => patch[c]);
  if (patch.stats !== undefined) {
    sets.push("stats_json = ?");
    values.push(JSON.stringify(patch.stats || {}));
  }
  if (!sets.length) return getSave(id);
  db.prepare(`UPDATE saves SET ${sets.join(", ")}, updated_at = datetime('now') WHERE id = ?`).run(...values, id);
  return getSave(id);
}

function getInventory(saveId) {
  return stmts.getInventory.all(saveId);
}

function appendLog(saveId, role, content) {
  const info = stmts.appendLog.run(saveId, role, content);
  stmts.touchSave.run(saveId);
  return { id: info.lastInsertRowid, role, content };
}

function getLog(saveId, limit) {
  return stmts.getLog.all(saveId, limit);
}

// ---------------------------------------------------------------------------
// shadows（影子提取 / Arise 的持久化，F050 引擎产出、F051 接线写入）
// ---------------------------------------------------------------------------

function toShadow(row) {
  if (!row) return null;
  const { skills, stats_json, created_at: createdAt, shadow_id: id, ...rest } = row;
  let parsed = [];
  try {
    const value = JSON.parse(skills || "[]");
    parsed = Array.isArray(value) ? value : [];
  } catch {
    parsed = [];
  }
  // stats_json 非法 / 非对象 / 缺失 → 不挂 stats，读侧由引擎按 rank baseStats 兜底。
  let stats;
  try {
    const value = JSON.parse(stats_json || "null");
    if (value && typeof value === "object" && !Array.isArray(value)) stats = value;
  } catch {
    stats = undefined;
  }
  const shadow = { id, ...rest, skills: parsed, createdAt };
  if (stats) shadow.stats = stats;
  return shadow;
}

function addShadow(saveId, shadow) {
  if (!saveId || !shadow || !shadow.id) return null;
  const statsJson =
    shadow.stats && typeof shadow.stats === "object" && !Array.isArray(shadow.stats)
      ? JSON.stringify(shadow.stats)
      : null;
  stmts.insertShadow.run(
    saveId,
    shadow.id,
    shadow.name || shadow.source || "未知影子",
    shadow.rank || "E",
    Number.isFinite(Number(shadow.level)) ? Math.max(1, Math.floor(Number(shadow.level))) : 1,
    shadow.source || null,
    JSON.stringify(Array.isArray(shadow.skills) ? shadow.skills : []),
    statsJson,
  );
  stmts.touchSave.run(saveId);
  return toShadow(stmts.getShadow.get(saveId, shadow.id));
}

function getShadows(saveId) {
  return stmts.getShadows.all(saveId).map(toShadow);
}

function countShadows(saveId) {
  const row = stmts.countShadows.get(saveId);
  return row ? Number(row.n) || 0 : 0;
}

// ---------------------------------------------------------------------------
// quest_daily（每日任务进度，F008：/action 里按 quest-day 累加）
// ---------------------------------------------------------------------------

function getDailyQuests(saveId, dayKey) {
  return stmts.getDailyQuests.all(saveId, dayKey).map((row) => ({
    quest_id: row.quest_id,
    progress: Number(row.progress) || 0,
    done: Boolean(row.done),
  }));
}

function setDailyQuest(saveId, dayKey, questId, progress, done) {
  stmts.setDailyQuest.run(saveId, dayKey, questId, Math.max(0, Math.trunc(Number(progress) || 0)), done ? 1 : 0);
  stmts.touchSave.run(saveId);
}

module.exports = {
  createSave,
  getSave,
  getInventory,
  appendLog,
  getLog,
  updateSave,
  addShadow,
  getShadows,
  countShadows,
  getDailyQuests,
  setDailyQuest,
};
