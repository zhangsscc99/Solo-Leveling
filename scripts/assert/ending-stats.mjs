#!/usr/bin/env node
// F073 contract: 通关结算全部来自真实存档数据 —— ch8_epilogue.stats 只留模板
// （无 sample/fields/示例数字/硬编码战绩断言），引擎 buildStats 真实透传，
// clear_time 由 cleared_at 冻结。设了 API_BASE 时再做路由级对账：
//   (a) 未通关存档（chapter 3）→ 409，不得吐出结局全文；
//   (b) 真到结局场景（ch8_epilogue）→ 200，chapters_cleared 与章节一致；
//   (c) clear_time 匹配 ^\d+:\d{2}:\d{2}$ 或「—」，且连拉两次值相同。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, get, ok, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── 静态：ch8_epilogue.stats 只剩模板，无任何示例数字/硬编码断言 ─────────────
const data = require(path.join(ROOT, "server", "data", "chapters.json"));
const ch8 = data.chapters.find((c) => c.index === 8 || c.id === "ch8");
assert(ch8, "ch8 missing from chapters.json");
const scene = ch8.scenes.find((s) => s.id === "ch8_epilogue");
assert(scene, "ch8_epilogue scene missing");
assert(scene.stats && typeof scene.stats === "object", "ch8_epilogue.stats missing");
assert(!("sample" in scene.stats), "stats.sample still present");
assert(!("note" in scene.stats), "stats.note still present");
assert(!("fields" in scene.stats), "stats.fields still present");

const blob = JSON.stringify(scene.stats);
assert(!blob.includes("1342"), "sample kills 1342 still present");
assert(!blob.includes("3:47:12"), "sample clear_time still present");
assert(!/(?<![\d.])27(?![\d.])/.test(blob), "sample shadows 27 still present");
assert(!blob.includes("Beru"), "hardcoded Beru claim still present");

assert(Array.isArray(scene.stats.lines) && scene.stats.lines.length > 0, "stats.lines missing");
const linesJoined = scene.stats.lines.join("\n");
assert(linesJoined.includes("{level}"), "lines missing {level} placeholder");
assert(linesJoined.includes("{kills}"), "lines missing {kills} placeholder");
assert(linesJoined.includes("{achievement}"), "lines missing {achievement} placeholder");

// ── 引擎：伪造存档跑 buildStats / hasCleared，数值必须真实透传 ───────────────
const ending = require(path.join(ROOT, "server", "engine", "ending.js"));
const pad = (n) => String(n).padStart(2, "0");
function sqliteUtc(d) {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
const now = Date.now();
const clearedSave = {
  level: 57,
  kills: 3,
  chapter: 8,
  scene: "ch8_epilogue",
  created_at: sqliteUtc(new Date(now - 3600 * 1000)),
  cleared_at: sqliteUtc(new Date(now)),
};
const stats = ending.buildStats({ save: clearedSave, shadows: 2 });
assert(stats.level === 57, `level mismatch: ${stats.level}`);
assert(stats.kills === 3, `kills mismatch: ${stats.kills}`);
assert(stats.shadows === 2, `shadows mismatch: ${stats.shadows}`);
assert(/^1:00:0\d$/.test(stats.clear_time), `clear_time not ~1h: ${stats.clear_time}`);
assert(stats.chapters_cleared === 8, `chapters_cleared mismatch: ${stats.chapters_cleared}`);

// 门禁：chapter>=8 不等于通关，只有当前场景是 ch8_epilogue 才算。
assert(ending.hasCleared(clearedSave) === true, "hasCleared(epilogue) should be true");
assert(ending.hasCleared({ ...clearedSave, scene: "ch8_jeju" }) === false, "ch8 mid-scene should not be cleared");
assert(ending.hasCleared({ ...clearedSave, scene: null }) === false, "no scene should not be cleared");
assert(ending.hasCleared({ chapter: 3, scene: "ch3_retest" }) === false, "chapter 3 should not be cleared");

// 无 cleared_at → clear_time 回退「—」，不是活值也不是 0:00:00。
const legacy = ending.buildStats({ save: { ...clearedSave, cleared_at: null }, shadows: 0 });
assert(legacy.clear_time === "—", `missing cleared_at should render —, got ${legacy.clear_time}`);

// ── 网络：API_BASE 非空时做路由级对账 ─────────────────────────────────────────
if (process.env.API_BASE) {
  const Database = require("better-sqlite3");
  const dbPath = process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");

  const id = await makeSave("ending");
  try {
    // (a) 未通关存档（chapter 3，人在章内）→ 必须 409，不得泄结局全文
    db.prepare("UPDATE saves SET chapter = 3, scene = NULL WHERE id = ?").run(id);
    const locked = await get(`/saves/${id}/ending`);
    assert(locked.status === 409, `uncleared save must 409, got HTTP ${locked.status}`);
    assert(locked.body && typeof locked.body.error === "string" && locked.body.error.length > 0,
      "409 body must carry an error message");
    assert(!locked.body.ending, "409 must not leak ending payload");

    // (b) 推进到结局场景 → 200，chapters_cleared 与章节一致（=8）
    db.prepare("UPDATE saves SET chapter = 8, scene = 'ch8_epilogue' WHERE id = ?").run(id);
    const end = await get(`/saves/${id}/ending`);
    assert(end.status === 200 && end.body && end.body.ending, `ending fetch failed (HTTP ${end.status})`);
    const e = end.body.ending.stats;
    assert(e.chapters_cleared === 8, `chapters_cleared mismatch: ${e.chapters_cleared} (expected 8 at epilogue)`);

    // 与 /saves/:id 对账：等级/击杀一致，且 save.cleared 与门禁同一结论
    const sav = await get(`/saves/${id}`);
    assert(sav.status === 200 && sav.body && sav.body.save, `save fetch failed (HTTP ${sav.status})`);
    const s = sav.body.save;
    assert(s.cleared === true, `save.cleared should be true at epilogue`);
    assert(e.level === s.level, `level mismatch: ending=${e.level} save=${s.level}`);
    assert(e.kills === s.kills, `kills mismatch: ending=${e.kills} save=${s.kills}`);
    assert(typeof e.shadows === "number" && Number.isFinite(e.shadows), `shadows not a number: ${e.shadows}`);

    // (c) clear_time 格式合法且冻结 —— 连拉两次必须同值
    assert(/^\d+:\d{2}:\d{2}$/.test(e.clear_time) || e.clear_time === "—",
      `clear_time bad format: ${e.clear_time}`);
    const again = await get(`/saves/${id}/ending`);
    assert(again.status === 200, `second ending fetch failed (HTTP ${again.status})`);
    assert(again.body.ending.stats.clear_time === e.clear_time,
      `clear_time drifted: ${e.clear_time} -> ${again.body.ending.stats.clear_time}`);
  } finally {
    db.prepare("DELETE FROM saves WHERE id = ?").run(id);
    db.close();
  }
}

ok();
