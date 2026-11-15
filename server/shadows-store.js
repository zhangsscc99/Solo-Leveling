// shadows 表存取：从 db.js 抽出并依赖注入 better-sqlite3 句柄，
// 使出战写库可用内存库单测。
//
// 出战状态一律按主键行 id 落库（一行一次）：同 shadow_id 多行的历史脏数据
// （旧版按 (save_id, shadow_id) 广播 UPDATE 的产物）不会再被一次全部翻转。
// 视图对象同时暴露 id（shadow_id，展示/点名用）与 rowId（主键，写库用）。

const COLS = "id, shadow_id, name, rank, level, source, skills, stats_json, deployed, created_at";

function toShadow(row) {
  if (!row) return null;
  const { id: rowId, skills, stats_json, created_at: createdAt, shadow_id: id, deployed, ...rest } = row;
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
  const shadow = { id, rowId, ...rest, skills: parsed, deployed: !!Number(deployed), createdAt };
  if (stats) shadow.stats = stats;
  return shadow;
}

function createShadowStore(db) {
  const stmts = {
    touchSave: db.prepare(`UPDATE saves SET updated_at = datetime('now') WHERE id = ?`),
    insert: db.prepare(`
      INSERT INTO shadows (save_id, shadow_id, name, rank, level, source, skills, stats_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    updateByRow: db.prepare(`
      UPDATE shadows SET name = ?, rank = ?, level = ?, source = ?, skills = ?, stats_json = ?
      WHERE id = ? AND save_id = ?
    `),
    bySave: db.prepare(`SELECT ${COLS} FROM shadows WHERE save_id = ? ORDER BY id ASC`),
    byRow: db.prepare(`SELECT ${COLS} FROM shadows WHERE id = ? AND save_id = ?`),
    byShadowId: db.prepare(`SELECT ${COLS} FROM shadows WHERE save_id = ? AND shadow_id = ? ORDER BY id ASC`),
    count: db.prepare(`SELECT COUNT(*) AS n FROM shadows WHERE save_id = ?`),
    setDeployed: db.prepare(`UPDATE shadows SET deployed = ? WHERE id = ? AND save_id = ?`),
    deployedRows: db.prepare(`SELECT id FROM shadows WHERE save_id = ? AND deployed = 1 ORDER BY id ASC`),
  };

  function getShadowByRow(saveId, rowId) {
    return toShadow(stmts.byRow.get(rowId, saveId));
  }

  function getShadows(saveId) {
    return stmts.bySave.all(saveId).map(toShadow);
  }

  function getShadow(saveId, shadowId) {
    return toShadow(stmts.byShadowId.get(saveId, shadowId));
  }

  function countShadows(saveId) {
    const row = stmts.count.get(saveId);
    return row ? Number(row.n) || 0 : 0;
  }

  // 同一 shadow_id 只保留一行：已存在则按主键刷新属性（deployed 原样保留），
  // 不再无条件 INSERT 出重复行。
  function addShadow(saveId, shadow) {
    if (!saveId || !shadow || !shadow.id) return null;
    const name = shadow.name || shadow.source || "未知影子";
    const rank = shadow.rank || "E";
    const level = Number.isFinite(Number(shadow.level)) ? Math.max(1, Math.floor(Number(shadow.level))) : 1;
    const source = shadow.source || null;
    const skills = JSON.stringify(Array.isArray(shadow.skills) ? shadow.skills : []);
    // F072：五项属性存 stats_json，缺失/非法 → NULL，读侧由引擎按 rank baseStats 兜底。
    const statsJson =
      shadow.stats && typeof shadow.stats === "object" && !Array.isArray(shadow.stats)
        ? JSON.stringify(shadow.stats)
        : null;
    const existing = stmts.byShadowId.get(saveId, shadow.id);
    const rowId = existing
      ? (stmts.updateByRow.run(name, rank, level, source, skills, statsJson, existing.id, saveId), existing.id)
      : stmts.insert.run(saveId, shadow.id, name, rank, level, source, skills, statsJson).lastInsertRowid;
    stmts.touchSave.run(saveId);
    return getShadowByRow(saveId, rowId);
  }

  // 出战/撤回写库按主键行 id 定位，一次最多翻转一行。
  // deployed 只允许 0/1；返回更新后的行，影子不存在时返回 null。
  function setShadowDeployed(saveId, rowId, deployed) {
    const info = stmts.setDeployed.run(deployed ? 1 : 0, rowId, saveId);
    if (!info.changes) return null;
    stmts.touchSave.run(saveId);
    return getShadowByRow(saveId, rowId);
  }

  // 超上限自愈：只保留最早的前 max 个出战行，多余行 deployed 归零。
  // 返回被收回的行数（0 表示本就健康）。max <= 0 时全部收回。
  function releaseExcessDeployed(saveId, max) {
    const keep = Math.max(0, Math.trunc(Number(max) || 0));
    const excess = stmts.deployedRows.all(saveId).slice(keep);
    for (const row of excess) {
      stmts.setDeployed.run(0, row.id, saveId);
    }
    if (excess.length) stmts.touchSave.run(saveId);
    return excess.length;
  }

  return {
    addShadow,
    getShadows,
    getShadow,
    getShadowByRow,
    countShadows,
    setShadowDeployed,
    releaseExcessDeployed,
  };
}

module.exports = { createShadowStore, toShadow };
