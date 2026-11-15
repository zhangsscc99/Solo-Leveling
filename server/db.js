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
`);

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

module.exports = { createSave, getSave, getInventory, appendLog, getLog };
