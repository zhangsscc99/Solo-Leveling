#!/usr/bin/env node
// F142 拒绝往来落库契约（全是行为断言）：
//
//   封门拒绝（escape_locked 场景、守关者未清时输「离开这里」）：
//   (a) /saves/:id/log 恰好 +2 条——一条 role=user 的玩家原文
//       「离开这里」、一条 role=system 的拒绝文案（与回包
//       reply.content 一致）——被拒的对话不再刷新即蒸发；
//   (b) 拒绝不产生任何结算/位移：hp / mp / xp / gold / scene / combat
//       拒绝前后逐字段全等；
//   (c) refused / escape_locked 标记照旧下发（回包契约不变）。
//
//   落点锻造走 DB 直写（同 escape-locked-boss-cleared.mjs 取径）：
//   ch2_penalty_gate 是 chapters.json 里 escape_locked=true 的场景，
//   boss_cleared_json=[] 使封门成立（F139 同一口径）。
//
//   旧码必红：F106 口径 refused 短路零日志 → (a) 日志零增长 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, get, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const PENALTY_GATE = "ch2_penalty_gate";
const INPUT = "离开这里";

async function getLog(id) {
  const r = await get(`/saves/${id}/log?limit=200`);
  assert(r.status === 200 && Array.isArray(r.body.log), `log fetch failed (HTTP ${r.status})`);
  return r.body.log;
}

function settlementView(s) {
  return {
    hp: s.hp,
    mp: s.mp,
    xp: s.xp,
    gold: s.gold,
    scene: s.scene,
    combat: s.combat || null,
  };
}

const id = await makeSave("refused-log");
db.prepare(
  "UPDATE saves SET chapter = 2, scene = ?, level = 4, boss_cleared_json = '[]', " +
    "encounter_clock = 0, encounter_cd = 0 WHERE id = ?"
).run(PENALTY_GATE, id);

const before = settlementView((await fetchSaveView(id)).save);
assert(
  before.scene === PENALTY_GATE && before.combat === null,
  `setup broken: scene=${before.scene} combat=${JSON.stringify(before.combat)}`
);
const logsBefore = await getLog(id);

// ── 封门拒绝：refused 标记 + 两条日志 + 零结算 ────────────────────
const r = await act(id, INPUT);
assert(r.refused === true, `expected refused===true for a sealed door, got ${JSON.stringify(r.refused)}`);
assert(
  r.escape_locked === true,
  `expected escape_locked===true (sealed-door refusal), got ${JSON.stringify(r.escape_locked)}`
);
const refusalText = (r.reply && r.reply.content) || "";
assert(refusalText.includes("无法撤离"), `refusal prose changed? ${refusalText.slice(0, 160)}`);

// (b) 零结算：hp/mp/xp/gold/scene/combat 逐字段全等
const after = settlementView((await fetchSaveView(id)).save);
assert(
  JSON.stringify(after) === JSON.stringify(before),
  `(b) refusal must settle nothing: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
);

// (a) 日志恰好 +2：user 原文 + system 拒绝文案
const logsAfter = await getLog(id);
assert(
  logsAfter.length === logsBefore.length + 2,
  `(a) refusal must write exactly 2 log entries (user + system), ` +
    `got +${logsAfter.length - logsBefore.length}`
);
const [userLine, sysLine] = logsAfter.slice(-2);
assert(
  userLine.role === "user" && userLine.content === INPUT,
  `(a) first new entry must be the raw user input: ${JSON.stringify(userLine)}`
);
assert(
  sysLine.role === "system" && sysLine.content === refusalText,
  `(a) second new entry must be the refusal prose as replied: ${JSON.stringify(sysLine)}`
);
assert(
  sysLine.content.includes("无法撤离"),
  `(a) logged refusal must contain the 拒绝文案: ${sysLine.content.slice(0, 160)}`
);

db.close();
ok("OK");
