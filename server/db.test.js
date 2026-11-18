// F072 shadows 表持久化单测：stats_json 列写入/读回、老行兜底。
// 运行：env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE node --test server/db.test.js
//
// 说明：db.js 在 require 时打开 data/game.db（gitignore 的运行库），
// 测试用例结束会清理自己插入的 saves/shadows 行。

const test = require("node:test");
const assert = require("node:assert/strict");

const Database = require("better-sqlite3");
const db = require("./db");
const { DB_FILE } = require("./db");
const shadow = require("./engine/shadow");
const statsLib = require("./engine/stats");

// 与 db.js 同库的第二个连接：用来插「老 schema 行」和清理测试数据。
// 库路径必须复用 db.js 的 DB_FILE（DB_PATH 环境变量可能把应用指到别的库，
// 硬编码 <repo>/data/game.db 会让插进去的行读不回）。
// （better-sqlite3 默认不开外键，ON DELETE CASCADE 不会自动清理，需手动删。）
function raw() {
  return new Database(DB_FILE);
}

function cleanup(saveIds) {
  const r = raw();
  try {
    const delSh = r.prepare("DELETE FROM shadows WHERE save_id = ?");
    const delLog = r.prepare("DELETE FROM log WHERE save_id = ?");
    const delSave = r.prepare("DELETE FROM saves WHERE id = ?");
    for (const id of saveIds) {
      delSh.run(id);
      delLog.run(id);
      delSave.run(id);
    }
  } finally {
    r.close();
  }
}

test("addShadow → getShadows 往返：五项属性不变", () => {
  const save = db.createSave("影子持久化测试");
  const stats = { strength: 19.5, agility: 14, vitality: 10.5, intelligence: 7.5, perception: 8.5 };
  try {
    db.addShadow(save.id, {
      id: "sh_e_roundtrip",
      name: "地下城狼",
      rank: "E",
      level: 10,
      source: "地下城狼",
      stats,
      skills: ["撕咬"],
    });
    const rows = db.getShadows(save.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "sh_e_roundtrip");
    assert.deepEqual(rows[0].stats, stats, "五项属性经 stats_json 落库后必须原样读回");
    for (const k of statsLib.STAT_KEYS) assert.equal(rows[0].stats[k], stats[k]);
  } finally {
    cleanup([save.id]);
  }
});

test("老行无 stats_json：读回无 stats，combatProfile 按 rank baseStats 兜底", () => {
  const save = db.createSave("老影子兜底测试");
  const r = raw();
  try {
    // 模拟 F072 前写入的行：没有 stats_json 值（等价于旧 schema 行）。
    r.prepare(
      `INSERT INTO shadows (save_id, shadow_id, name, rank, level, source, skills)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(save.id, "sh_c_legacy", "石像守卫", "C", 7, "石像守卫", '["爪击"]');

    const rows = db.getShadows(save.id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "sh_c_legacy");
    assert.equal(rows[0].stats, undefined, "老行读回不携带 stats");

    const prof = shadow.combatProfile(rows[0]);
    assert.deepEqual(prof.stats, shadow.DEFAULT_CONFIG.growth.baseStats.C);
    assert.ok(prof.atk > 1, "兜底后折算不得退化为 atk=1");
  } finally {
    r.close();
    cleanup([save.id]);
  }
});

test("stats_json 非法 JSON / 非对象：视为缺失，按 baseStats 兜底", () => {
  const save = db.createSave("坏 stats_json 测试");
  const r = raw();
  try {
    const ins = r.prepare(
      `INSERT INTO shadows (save_id, shadow_id, name, rank, level, source, skills, stats_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run(save.id, "sh_e_badjson", "坏数据一", "E", 1, null, null, "{not json");
    ins.run(save.id, "sh_e_array", "坏数据二", "E", 1, null, null, "[1,2,3]");

    const rows = db.getShadows(save.id);
    assert.equal(rows.length, 2);
    for (const row of rows) {
      assert.equal(row.stats, undefined, `${row.id} 的非法 stats_json 不应挂 stats`);
      assert.deepEqual(
        shadow.combatProfile(row).stats,
        shadow.DEFAULT_CONFIG.growth.baseStats.E,
      );
    }
  } finally {
    r.close();
    cleanup([save.id]);
  }
});
