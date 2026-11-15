#!/usr/bin/env node
// F073 contract: 通关结算全部来自真实存档数据 —— ch8_epilogue.stats 只留模板
// （无 sample/fields/示例数字），引擎 buildStats 真实透传，设了 API_BASE 时
// 再对 /saves/:id/ending 与 /saves/:id 做一致性对账。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, get, ok } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ── 静态：ch8_epilogue.stats 只剩模板，无任何示例数字 ─────────────────────────
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

assert(Array.isArray(scene.stats.lines) && scene.stats.lines.length > 0, "stats.lines missing");
const linesJoined = scene.stats.lines.join("\n");
assert(linesJoined.includes("{level}"), "lines missing {level} placeholder");
assert(linesJoined.includes("{kills}"), "lines missing {kills} placeholder");

// ── 引擎：伪造存档跑 buildStats，数值必须真实透传 ────────────────────────────
const ending = require(path.join(ROOT, "server", "engine", "ending.js"));
const pad = (n) => String(n).padStart(2, "0");
function sqliteUtc(d) {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
const now = Date.now();
const stats = ending.buildStats({
  save: { level: 57, kills: 3, chapter: 8, created_at: sqliteUtc(new Date(now - 3600 * 1000)) },
  shadows: 2,
  now,
});
assert(stats.level === 57, `level mismatch: ${stats.level}`);
assert(stats.kills === 3, `kills mismatch: ${stats.kills}`);
assert(stats.shadows === 2, `shadows mismatch: ${stats.shadows}`);
assert(/^1:00:0\d$/.test(stats.clear_time), `clear_time not ~1h: ${stats.clear_time}`);

// ── 网络：API_BASE 非空时对账 /saves/:id/ending 与 /saves/:id ──────────────────
if (process.env.API_BASE) {
  const id = Number(process.env.SL_SAVE_ID || 1);
  const end = await get(`/saves/${id}/ending`);
  assert(end.status === 200 && end.body && end.body.ending, `ending fetch failed (HTTP ${end.status})`);
  const sav = await get(`/saves/${id}`);
  assert(sav.status === 200 && sav.body && sav.body.save, `save fetch failed (HTTP ${sav.status})`);
  const e = end.body.ending.stats;
  const s = sav.body.save;
  assert(e.level === s.level, `level mismatch: ending=${e.level} save=${s.level}`);
  assert(e.kills === s.kills, `kills mismatch: ending=${e.kills} save=${s.kills}`);
  assert(typeof e.shadows === "number" && Number.isFinite(e.shadows), `shadows not a number: ${e.shadows}`);
}

ok();
