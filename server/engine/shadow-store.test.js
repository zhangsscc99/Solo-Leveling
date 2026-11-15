// F051 review 回归（BLOCKING 2）：出战写库按主键行 id 定位。
// 内存库构造「同 shadow_id 两行」的历史脏数据：一次 deploy 只能翻转一行，
// 出战计数不得冲破上限；已超上限的脏数据由 releaseExcessDeployed 收回。
// Run: node --test server/engine/shadow-store.test.js

const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");

const { createShadowStore } = require("../shadows-store");
const shadow = require("./shadow");

function makeStore() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE saves (id INTEGER PRIMARY KEY, updated_at TEXT);
    CREATE TABLE shadows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      save_id INTEGER NOT NULL,
      shadow_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rank TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      source TEXT,
      skills TEXT,
      stats_json TEXT,
      deployed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare("INSERT INTO saves (id) VALUES (?)").run(1);
  return { db, store: createShadowStore(db) };
}

test("同 shadow_id 两行：一次 deploy 只翻一行、计数不超过 max", () => {
  const { db, store } = makeStore();
  // 历史脏数据：addShadow 已去重，直接 SQL 复刻旧库里的重复行。
  const ins = db.prepare(
    "INSERT INTO shadows (save_id, shadow_id, name, rank, level, deployed) VALUES (1, ?, ?, 'C', 5, ?)"
  );
  ins.run("sh_dup", "牙", 0);
  ins.run("sh_dup", "牙", 0);
  ins.run("sh_a", "甲", 1);
  ins.run("sh_b", "乙", 1); // 已占 2/3 个出战位

  const shadows = store.getShadows(1);
  assert.equal(shadows.length, 4);
  assert.ok(shadows.every((s) => Number.isInteger(s.rowId)), "视图必须带主键 rowId");

  // 引擎按 shadow_id 点名只会命中一行；写库按 rowId 落 → 最多翻转一行。
  const gate = shadow.canDeploy(shadows, "sh_dup");
  assert.equal(gate.ok, true);
  const updated = store.setShadowDeployed(1, gate.shadow.rowId, true);
  assert.ok(updated);
  assert.equal(updated.deployed, true);

  const after = store.getShadows(1);
  const dupRows = after.filter((s) => s.id === "sh_dup");
  assert.equal(dupRows.length, 2, "两行都还在");
  assert.equal(dupRows.filter((s) => s.deployed).length, 1, "一次 deploy 只翻转一行");

  const f = shadow.formationSummary(after);
  assert.equal(f.count, 3);
  assert.ok(f.count <= f.max, `count ${f.count} must not exceed max ${f.max}`);
});

test("同 shadow_id 两行都被置出战（旧脏数据）：releaseExcessDeployed 收回到上限内", () => {
  const { db, store } = makeStore();
  const ins = db.prepare(
    "INSERT INTO shadows (save_id, shadow_id, name, rank, level, deployed) VALUES (1, ?, ?, 'C', 5, 1)"
  );
  // 旧版 (save_id, shadow_id) 广播 UPDATE 的产物：一次 deploy 两行同置 1，
  // 4 行出战 > max 3（「已出战 4/3」的来源）。
  ins.run("sh_dup", "牙");
  ins.run("sh_dup", "牙");
  ins.run("sh_a", "甲");
  ins.run("sh_b", "乙");

  const f0 = shadow.formationSummary(store.getShadows(1));
  assert.equal(f0.count, 4);
  assert.ok(f0.count > f0.max);

  assert.equal(store.releaseExcessDeployed(1, f0.max), 1);
  const f1 = shadow.formationSummary(store.getShadows(1));
  assert.equal(f1.count, 3);
  assert.ok(f1.count <= f1.max);

  // 收回后编队仍可用：保留的 sh_dup 首行已出战 → already_deployed。
  const gate = shadow.canDeploy(store.getShadows(1), "sh_dup");
  assert.equal(gate.ok, true);
  assert.equal(gate.already, true);
});

test("addShadow: 同 shadow_id 不再产生重复行（按主键刷新，保留 deployed）", () => {
  const { store } = makeStore();
  const a = store.addShadow(1, { id: "sh_x", name: "伊格利特", rank: "B", level: 3 });
  assert.ok(a && Number.isInteger(a.rowId));
  store.setShadowDeployed(1, a.rowId, true);
  const b = store.addShadow(1, { id: "sh_x", name: "伊格利特", rank: "B", level: 4 });
  assert.equal(store.countShadows(1), 1);
  assert.equal(b.rowId, a.rowId);
  assert.equal(b.level, 4);
  assert.equal(b.deployed, true);
});
