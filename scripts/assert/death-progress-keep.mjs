#!/usr/bin/env node
// F114 口径重写（原 F098「死亡回溯不清空主线进度」断言已废弃）：
// 旧口径把「场景退回入口、main_steps 高水位留住计数」写成期望——那正是
// 线上 save 779 的双账 bug（场景在第 2 幕、计数在第 4 步）。F114 改为单一
// 事实源：chapter_steps 由当前场景位置推导，回溯时位置与计数同退。
//   A) DB 落点构造 ch1 高进度存档（站位 ch1_awaken + 陈旧高水位
//      main_steps=7 作陷阱）→ 真实动作打到 HP 0 → 回溯落点 = 本章链首
//      入口（F095 已验收的入口回溯契约；F114「退两幕」系回归，F122 改回），
//      回包与 DB 的 scene/steps 必须同账（scene_index+1 === chapter_steps），
//      高水位不再顶起计数；
//   B) 首死保底 XP 一次性：新档首死入账 +30（与 ch1 濒死觉醒并存），
//      第二次死亡分文不补（此契约不受 F114 影响，原样保留）；
//   C) 死亡播报诚实：不得出现「回到起点/进度重置」与落点不符的矛盾文案，
//      不得出现「HP x→x」同值虚构消耗；落点名必须取真实 save.scene；
//   D) deaths 每次 +1。
// 死亡路径：DB 把 hp 压到 1 → POST /action「前进」经真实体力结算扣到 0，
// applyOutcome → settleDeath 全链路走真代码，不直接调内部函数。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 与服务端 chapterPath 同口径推导 ch1 主线链。
const ch1 = raw.chapters.find((c) => c.index === 1);
const byId = new Map(ch1.scenes.map((s) => [s.id, s]));
const PATH = [];
{
  const seen = new Set();
  let cur = ch1.scenes[0];
  while (cur && !seen.has(cur.id)) {
    PATH.push(cur.id);
    seen.add(cur.id);
    let nxt =
      cur.next_scene && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => c.next && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
}
const TOTAL = PATH.length;
const FIRST = PATH[0];
// F095 入口回溯契约：落点恒为本章主线链首入口（服务端 settleDeath 同一
// 口径）——这里是期望值 oracle，写死防回归。
const sceneTitleById = new Map(ch1.scenes.map((s) => [s.id, s.title]));
const CONTRADICTION = /回到起点|退回起点|的起点|进度.{0,6}(重置|归零|清零|清空)/;
const SAME_VALUE = /(HP|MP) (\d+)→\2/;

function dbRow(id) {
  return db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
}
function recentLog(id, n) {
  return db
    .prepare("SELECT content FROM log WHERE save_id = ? ORDER BY id DESC LIMIT ?")
    .all(id, n)
    .map((r) => r.content)
    .join("\n");
}
function checkLedger(s, tag) {
  assert(
    s.scene_index + 1 === s.chapter_steps,
    `${tag}: 双账复活——scene_index=${s.scene_index}(${s.scene}) vs chapter_steps=${s.chapter_steps}`
  );
}

// ── A) 非首死：高进度存档倒下，位置与计数同退回入口 ──────────────
// 站位 PATH[5]（6/7）+ hp=1：一推落到 PATH[6] 即力竭——F095 入口回溯
// 契约下落点恒为链首 PATH[0]（1/7）。main_steps=7 是陈旧高水位陷阱：
// 新口径必须忽略它（旧口径会把计数顶到 7/7——双账复现即 FAIL）。
const idA = await makeSave("f114-rewind");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, main_steps = ?, hp = 1, xp = 0, deaths = 1, boss_cleared_json = ? WHERE id = ?"
).run(PATH[5], TOTAL, JSON.stringify(["ch1"]), idA);

const preA = await fetchSaveView(idA);
assert(preA.save.chapter_progress === `6/${TOTAL}`, `pre-death progress expected 6/${TOTAL}, got ${preA.save.chapter_progress}`);
checkLedger(preA.save, "A pre-death");
const preAxp = preA.save.xp;

const dieA = await act(idA, "前进");
const repA = dieA.reply.content;
assert(repA.includes("倒下"), `A: missing 倒下 broadcast: ${repA.slice(-300)}`);
assert(repA.includes("回溯"), `A: missing 回溯 broadcast: ${repA.slice(-300)}`);
assert(
  repA.includes(`「${sceneTitleById.get(FIRST)}」`),
  `A: rewind broadcast must name real landing「${sceneTitleById.get(FIRST)}」: ${repA.slice(-300)}`
);
assert(
  repA.includes("的入口"),
  `A: landing IS the entry — broadcast must say 的入口: ${repA.slice(-300)}`
);
assert(!CONTRADICTION.test(repA), `A: contradictory rewind prose: ${repA.slice(-300)}`);
assert(!SAME_VALUE.test(repA), `A: zero-delta vitals prose leaked`);
assert(dieA.save.deaths === 2, `A: deaths should be 2, got ${dieA.save.deaths}`);
assert(dieA.save.scene === FIRST, `A: should rewind to entry ${FIRST}, got ${dieA.save.scene}`);
checkLedger(dieA.save, "A post-death");
assert(
  dieA.save.chapter_steps === 1 && dieA.save.chapter_progress === `1/${TOTAL}`,
  `A: progress should rewind with position to 1/${TOTAL}, got ${dieA.save.chapter_progress}`
);
assert(dieA.save.xp >= preAxp, `A: xp dropped ${preAxp} -> ${dieA.save.xp}`);
assert(
  !repA.includes("逸散的经验") && !repA.includes("初次倒下"),
  "A: non-first death must not grant consolation XP"
);
const rowA = dbRow(idA);
assert(rowA.scene === FIRST, `A: DB scene should be ${FIRST}, got ${rowA.scene}`);
assert(rowA.deaths === 2, `A: DB deaths should be 2`);
assert(!CONTRADICTION.test(recentLog(idA, 8)), "A: DB log contains contradictory rewind prose");

// ── B) 首死：保底 XP +30 入账一次；第二次死亡分文不补 ──────────────
// 站位 PATH[1]（2/7）：一推落到 PATH[2] 即力竭，回溯落点 = 链首入口。
const idB = await makeSave("f114-first");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, hp = 1, xp = 0, deaths = 0, level = 1 WHERE id = ?"
).run(PATH[1], idB);

const preB = await fetchSaveView(idB);
const dieB1 = await act(idB, "前进");
const repB1 = dieB1.reply.content;
assert(repB1.includes("倒下"), `B1: missing 倒下 broadcast`);
assert(repB1.includes("XP +30"), `B1: first death missing consolation XP +30: ${repB1.slice(-300)}`);
assert(dieB1.save.xp >= 0 && dieB1.save.xp >= preB.save.xp, `B1: xp dropped ${preB.save.xp} -> ${dieB1.save.xp}`);
assert(dieB1.save.deaths === 1, `B1: deaths should be 1, got ${dieB1.save.deaths}`);
assert(dieB1.save.scene === FIRST, `B1: should rewind to entry ${FIRST}, got ${dieB1.save.scene}`);
assert(
  repB1.includes("的入口") && repB1.includes(`「${sceneTitleById.get(FIRST)}」`),
  `B1: landing IS the entry — broadcast should say so: ${repB1.slice(-300)}`
);
checkLedger(dieB1.save, "B1 post-death");
assert(
  dieB1.save.chapter_steps === 1 && dieB1.save.chapter_progress === `1/${TOTAL}`,
  `B1: progress should rewind with position to 1/${TOTAL}, got ${dieB1.save.chapter_progress}`
);
assert(!CONTRADICTION.test(repB1) && !SAME_VALUE.test(repB1), "B1: bad death prose");
const xpAfterFirst = dieB1.save.xp;

// 第二次倒下同样推进中力竭：回溯落点是链首入口，F124 口径下章首铺陈步
// 零消耗（站在链首 hp=1 推不死人）——把站位锚回 PATH[1]，与 B1 同一口径。
db.prepare("UPDATE saves SET hp = 1, scene = ? WHERE id = ?").run(PATH[1], idB);
const dieB2 = await act(idB, "前进");
const repB2 = dieB2.reply.content;
assert(dieB2.save.deaths === 2, `B2: deaths should be 2, got ${dieB2.save.deaths}`);
assert(
  dieB2.save.xp === xpAfterFirst && !repB2.includes("逸散的经验"),
  `B2: second death re-granted XP (${xpAfterFirst} -> ${dieB2.save.xp})`
);
// 第二次倒下发生在 PATH[1]（推进中力竭），回溯落点同样锚回链首入口。
assert(dieB2.save.scene === FIRST, `B2: should rewind to entry ${FIRST}, got ${dieB2.save.scene}`);
checkLedger(dieB2.save, "B2 post-death");
assert(
  dieB2.save.chapter_steps === 1,
  `B2: progress should be 1/${TOTAL} after rewind, got ${dieB2.save.chapter_steps}`
);
assert(!CONTRADICTION.test(repB2) && !SAME_VALUE.test(repB2), "B2: bad death prose");

db.prepare("DELETE FROM saves WHERE id IN (?, ?)").run(idA, idB);
ok("OK");
