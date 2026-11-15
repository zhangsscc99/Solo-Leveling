#!/usr/bin/env node
// F098 死亡回溯不清空主线进度契约：
//   A) DB 落点构造 ch1 高进度存档（站位 ch1_awaken + main_steps=7，即
//      主线 7/7 高水位已记录）→ 真实动作打到 HP 0 → 回包与 DB 的
//      chapter_progress.current 均不得变小（场景可退入口，计数不退）；
//   B) 首死保底 XP 一次性：新档首死入账 +30（与 ch1 濒死觉醒并存），
//      第二次死亡分文不补；
//   C) 死亡播报诚实：不得出现「回到起点/进度重置」与「保留 N/N」的
//      矛盾文案，不得出现「HP x→x」同值虚构消耗；
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

// ── A) 非首死：7/7 高水位存档倒下，位置回入口、计数留 7/7 ──────────
const idA = await makeSave("f098-highwater");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, main_steps = ?, hp = 1, xp = 0, deaths = 1, boss_cleared_json = ? WHERE id = ?"
).run(PATH[5], TOTAL, JSON.stringify(["ch1"]), idA);

const preA = await fetchSaveView(idA);
assert(preA.save.chapter_progress === `${TOTAL}/${TOTAL}`, `pre-death progress expected ${TOTAL}/${TOTAL}, got ${preA.save.chapter_progress}`);
const preAxp = preA.save.xp;

const dieA = await act(idA, "前进");
const repA = dieA.reply.content;
assert(repA.includes("倒下"), `A: missing 倒下 broadcast: ${repA.slice(-300)}`);
assert(repA.includes("回溯"), `A: missing 回溯 broadcast: ${repA.slice(-300)}`);
assert(repA.includes(`已保留：第1章 主线 ${TOTAL}/${TOTAL}`), `A: missing milestone-keep line: ${repA.slice(-300)}`);
assert(!CONTRADICTION.test(repA), `A: contradictory rewind prose: ${repA.slice(-300)}`);
assert(!SAME_VALUE.test(repA), `A: zero-delta vitals prose leaked`);
assert(dieA.save.deaths === 2, `A: deaths should be 2, got ${dieA.save.deaths}`);
assert(dieA.save.scene === FIRST, `A: should rewind to ${FIRST}, got ${dieA.save.scene}`);
assert(
  dieA.save.chapter_steps >= preA.save.chapter_steps &&
    dieA.save.chapter_progress === `${TOTAL}/${TOTAL}`,
  `A: chapter_progress regressed: ${preA.save.chapter_progress} -> ${dieA.save.chapter_progress}`
);
assert(dieA.save.xp >= preAxp, `A: xp dropped ${preAxp} -> ${dieA.save.xp}`);
assert(
  !repA.includes("逸散的经验") && !repA.includes("初次倒下"),
  "A: non-first death must not grant consolation XP"
);
const rowA = dbRow(idA);
assert(rowA.main_steps === TOTAL, `A: DB main_steps should stay ${TOTAL}, got ${rowA.main_steps}`);
assert(rowA.scene === FIRST, `A: DB scene should be ${FIRST}, got ${rowA.scene}`);
assert(rowA.deaths === 2, `A: DB deaths should be 2`);
assert(!CONTRADICTION.test(recentLog(idA, 8)), "A: DB log contains contradictory rewind prose");

// ── B) 首死：保底 XP +30 入账一次；第二次死亡分文不补 ──────────────
const idB = await makeSave("f098-first");
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
assert(dieB1.save.scene === FIRST, `B1: should rewind to ${FIRST}`);
assert(
  dieB1.save.chapter_steps >= preB.save.chapter_steps,
  `B1: progress regressed ${preB.save.chapter_progress} -> ${dieB1.save.chapter_progress}`
);
assert(repB1.includes(`已保留：第1章 主线 ${dieB1.save.chapter_steps}/${TOTAL}`), "B1: keep line missing or mismatched");
assert(!CONTRADICTION.test(repB1) && !SAME_VALUE.test(repB1), "B1: bad death prose");
const xpAfterFirst = dieB1.save.xp;
const stepsAfterFirst = dieB1.save.chapter_steps;

db.prepare("UPDATE saves SET hp = 1 WHERE id = ?").run(idB);
const dieB2 = await act(idB, "前进");
const repB2 = dieB2.reply.content;
assert(dieB2.save.deaths === 2, `B2: deaths should be 2, got ${dieB2.save.deaths}`);
assert(
  dieB2.save.xp === xpAfterFirst && !repB2.includes("逸散的经验"),
  `B2: second death re-granted XP (${xpAfterFirst} -> ${dieB2.save.xp})`
);
assert(
  dieB2.save.chapter_steps >= stepsAfterFirst,
  `B2: progress regressed ${stepsAfterFirst} -> ${dieB2.save.chapter_steps}`
);
assert(!CONTRADICTION.test(repB2) && !SAME_VALUE.test(repB2), "B2: bad death prose");

db.prepare("DELETE FROM saves WHERE id IN (?, ?)").run(idA, idB);
ok("OK");
