const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

// DB_PATH 环境变量可覆盖存档库位置（断言脚本/单测用独立库，避免污染线上库）。
const DB_FILE = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(dataDir, "game.db");
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
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
  kills INTEGER NOT NULL DEFAULT 0,
  chapter INTEGER NOT NULL DEFAULT 1,
  scene TEXT,
  cleared_at TEXT,
  encounter_seq INTEGER NOT NULL DEFAULT 0,
  encounter_cd INTEGER NOT NULL DEFAULT 0,
  boss_cleared_json TEXT NOT NULL DEFAULT '[]',
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
  deployed INTEGER NOT NULL DEFAULT 0,
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

-- F088 当前交战态：一存档至多一条，敌人完整模板（id/名/rank/level/
-- hp/max_hp/stats/atk/def/xp）序列化进 enemy_json，回合数与起始时间
-- 单独成列便于查询。击杀/逃跑/倒下时整行删除，不留半死不活的战斗。
CREATE TABLE IF NOT EXISTS combat (
  save_id INTEGER PRIMARY KEY REFERENCES saves(id) ON DELETE CASCADE,
  enemy_json TEXT NOT NULL,
  turn INTEGER NOT NULL DEFAULT 1,
  started_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// CREATE TABLE IF NOT EXISTS 不会给已有表补列，老库走 ALTER 迁移。
const saveCols = db.prepare("PRAGMA table_info(saves)").all().map((c) => c.name);
if (!saveCols.includes("free_points")) {
  db.exec("ALTER TABLE saves ADD COLUMN free_points INTEGER NOT NULL DEFAULT 0");
}
if (!saveCols.includes("kills")) {
  db.exec("ALTER TABLE saves ADD COLUMN kills INTEGER NOT NULL DEFAULT 0");
}
// scene：当前场景 id（F074 场景运行时的推进落点）；cleared_at：首次抵达
// ch8_epilogue 的冻结时间戳（F073 结算路由写入），两者默认 NULL。
if (!saveCols.includes("scene")) {
  db.exec("ALTER TABLE saves ADD COLUMN scene TEXT");
}
if (!saveCols.includes("cleared_at")) {
  db.exec("ALTER TABLE saves ADD COLUMN cleared_at TEXT");
}
// F077 死亡计数；F088 遭遇保底计数（连续落空必触发）与主线奖励去重清单
// （rewards_json 存已入账章节 id 数组，重复通关同一章不重复发奖）。
if (!saveCols.includes("deaths")) {
  db.exec("ALTER TABLE saves ADD COLUMN deaths INTEGER NOT NULL DEFAULT 0");
}
if (!saveCols.includes("encounter_clock")) {
  db.exec("ALTER TABLE saves ADD COLUMN encounter_clock INTEGER NOT NULL DEFAULT 0");
}
if (!saveCols.includes("rewards_json")) {
  db.exec("ALTER TABLE saves ADD COLUMN rewards_json TEXT NOT NULL DEFAULT '[]'");
}
// F088 加固：encounter_seq 是开战盐（每次开战 +1，混入遭遇与回合种子，
// 保证同档连续两场战斗的 RNG 流不同）；encounter_cd 是击杀冷却（剩余
// 移动次数），原地连点「攻击」不再刷怪。boss_cleared_json 记已击杀的
// 守关 boss 章节 id——主线奖励与 boss 击杀解耦后靠它结算。
if (!saveCols.includes("encounter_seq")) {
  db.exec("ALTER TABLE saves ADD COLUMN encounter_seq INTEGER NOT NULL DEFAULT 0");
}
if (!saveCols.includes("encounter_cd")) {
  db.exec("ALTER TABLE saves ADD COLUMN encounter_cd INTEGER NOT NULL DEFAULT 0");
}
// F086 休息配额：本章已用休息次数，跨章（patch.chapter 变更）由
// applyOutcome 归零——配额按章计而不是永久消耗。
if (!saveCols.includes("rest_used")) {
  db.exec("ALTER TABLE saves ADD COLUMN rest_used INTEGER NOT NULL DEFAULT 0");
}
if (!saveCols.includes("boss_cleared_json")) {
  db.exec("ALTER TABLE saves ADD COLUMN boss_cleared_json TEXT NOT NULL DEFAULT '[]'");
}
// F081 技能冷却：{ skill_id: 剩余回合数 }，只随已结算的战斗回合衰减。
if (!saveCols.includes("skill_cd_json")) {
  db.exec("ALTER TABLE saves ADD COLUMN skill_cd_json TEXT NOT NULL DEFAULT '{}'");
}

// F051 编队：deployed 默认 0，老存档的行自动落为「未出战」，无需回填。
// F072 属性：stats_json 存影子五项属性，缺失时引擎按 rank 的 baseStats 兜底。
const shadowCols = db.prepare("PRAGMA table_info(shadows)").all().map((c) => c.name);
if (!shadowCols.includes("deployed")) {
  db.exec("ALTER TABLE shadows ADD COLUMN deployed INTEGER NOT NULL DEFAULT 0");
}
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
  markCleared: db.prepare(`
    UPDATE saves SET cleared_at = datetime('now') WHERE id = ? AND cleared_at IS NULL
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
  getCombat: db.prepare(`SELECT save_id, enemy_json, turn, started_at FROM combat WHERE save_id = ?`),
  setCombat: db.prepare(`
    INSERT INTO combat (save_id, enemy_json, turn, started_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(save_id) DO UPDATE SET
      enemy_json = excluded.enemy_json,
      turn = excluded.turn,
      started_at = excluded.started_at
  `),
  setCombatTurn: db.prepare(`
    UPDATE combat SET enemy_json = ?, turn = ? WHERE save_id = ?
  `),
  clearCombat: db.prepare(`DELETE FROM combat WHERE save_id = ?`),
};

function toSave(row) {
  if (!row) return null;
  const { stats_json, rewards_json, boss_cleared_json, skill_cd_json, ...rest } = row;
  let stats = {};
  try {
    stats = JSON.parse(stats_json || "{}");
  } catch {
    stats = {};
  }
  let rewards = [];
  try {
    const parsed = JSON.parse(rewards_json || "[]");
    if (Array.isArray(parsed)) rewards = parsed;
  } catch {
    rewards = [];
  }
  let boss_cleared = [];
  try {
    const parsed = JSON.parse(boss_cleared_json || "[]");
    if (Array.isArray(parsed)) boss_cleared = parsed;
  } catch {
    boss_cleared = [];
  }
  let skill_cds = {};
  try {
    const parsed = JSON.parse(skill_cd_json || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        const n = Math.trunc(Number(v) || 0);
        if (n > 0) skill_cds[k] = n;
      }
    }
  } catch {
    skill_cds = {};
  }
  return { ...rest, stats, rewards, boss_cleared, skill_cds };
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
// scene 由 F074 场景运行时推进写入；cleared_at 不走 updateSave，由
// markCleared 的专用语句首达结局时一次性冻结。deaths / encounter_clock
// / rewards 是 F077/F082/F088 新列，同样走白名单写入。
const MUTABLE_COLUMNS = [
  "hp", "mp", "max_hp", "max_mp", "xp", "gold", "kills", "level",
  "chapter", "scene", "rank", "free_points", "deaths", "encounter_clock",
  "encounter_seq", "encounter_cd", "rest_used",
];

function updateSave(id, patch) {
  if (!patch) return getSave(id);
  const cols = MUTABLE_COLUMNS.filter((c) => patch[c] !== undefined);
  const sets = cols.map((c) => `${c} = ?`);
  const values = cols.map((c) => patch[c]);
  if (patch.stats !== undefined) {
    sets.push("stats_json = ?");
    values.push(JSON.stringify(patch.stats || {}));
  }
  if (patch.rewards !== undefined) {
    sets.push("rewards_json = ?");
    values.push(JSON.stringify(Array.isArray(patch.rewards) ? patch.rewards : []));
  }
  if (patch.boss_cleared !== undefined) {
    sets.push("boss_cleared_json = ?");
    values.push(JSON.stringify(Array.isArray(patch.boss_cleared) ? patch.boss_cleared : []));
  }
  if (patch.skill_cds !== undefined) {
    sets.push("skill_cd_json = ?");
    const cds = patch.skill_cds && typeof patch.skill_cds === "object" ? patch.skill_cds : {};
    values.push(JSON.stringify(cds));
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
// 实现抽到 ./shadows-store.js：出战写库按主键行 id 定位（一行一次），
// 同 shadow_id 多行的历史脏数据不会被一次全部翻转，超上限由
// releaseExcessDeployed 收回；视图对象同时带 id（shadow_id）与 rowId（主键）。
// ---------------------------------------------------------------------------

const shadowStore = require("./shadows-store").createShadowStore(db);

const {
  addShadow,
  getShadows,
  getShadow,
  getShadowByRow,
  countShadows,
  setShadowDeployed,
  releaseExcessDeployed,
} = shadowStore;

// 首次抵达结局场景（ch8_epilogue）时冻结通关时间戳；已冻结的存档不再改写，
// 保证结算耗时跨请求稳定。
function markCleared(saveId) {
  stmts.markCleared.run(saveId);
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

// ---------------------------------------------------------------------------
// combat（当前交战态，F088：一存档至多一行，战斗结束即删）
// ---------------------------------------------------------------------------

function toCombat(row) {
  if (!row) return null;
  let enemy = null;
  try {
    enemy = JSON.parse(row.enemy_json || "null");
  } catch {
    enemy = null;
  }
  if (!enemy || typeof enemy !== "object") return null;
  return {
    save_id: row.save_id,
    enemy,
    turn: Math.max(1, Math.trunc(Number(row.turn) || 1)),
    started_at: row.started_at,
  };
}

function getCombat(saveId) {
  return toCombat(stmts.getCombat.get(saveId));
}

// 开战/换敌用 setCombat（turn=1 且重记 started_at），回合推进用
// setCombatTurn——只改敌人与回合计数，冻结本场战斗的起始时间。
function setCombat(saveId, enemy, turn) {
  stmts.setCombat.run(saveId, JSON.stringify(enemy || {}), Math.max(1, Math.trunc(Number(turn) || 1)));
}

function setCombatTurn(saveId, enemy, turn) {
  stmts.setCombatTurn.run(JSON.stringify(enemy || {}), Math.max(1, Math.trunc(Number(turn) || 1)), saveId);
}

function clearCombat(saveId) {
  stmts.clearCombat.run(saveId);
}

// applyOutcome 需要把「写存档 + 写战斗态 + 发奖 + 去重标记」包进同一事务：
// 必须把 better-sqlite3 的原生连接与 transaction 工厂透出（同事务只对同一
// 连接生效，index.js 不得再开第二条连接来装库存/奖励写操作）。
const transaction = (fn) => db.transaction(fn);

module.exports = {
  db,
  transaction,
  createSave,
  getSave,
  getInventory,
  appendLog,
  getLog,
  updateSave,
  addShadow,
  getShadows,
  getShadow,
  getShadowByRow,
  countShadows,
  setShadowDeployed,
  releaseExcessDeployed,
  markCleared,
  getDailyQuests,
  setDailyQuest,
  getCombat,
  setCombat,
  setCombatTurn,
  clearCombat,
};
