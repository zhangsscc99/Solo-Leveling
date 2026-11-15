#!/usr/bin/env node
// F089 contract: 终章收束 —— 已在 ch8_epilogue 的存档再点「前进」必须整体
// 拒绝（不扣 HP/MP、日志零增长、回复只带一次性结算指引），并由响应字段
// 表达终章态；结算接口照常返回真实战绩且幂等，未通关存档继续 409。
//
//   (a) 连点 3 次「前进」→ save.hp/mp 不变、log 行数不增长、回复不含旧的
//       「此处已是故事的终章，再无前路」逐字刷屏句，且三次回复同一句话；
//   (b) 响应带终章态字段：save.at_epilogue === true（或 ending_ready）；
//   (c) GET /saves/:id/ending → 200，stats.level/kills 与 save 一致，
//       连拉两次结果相同（cleared_at 冻结，不重复入账）；
//   (d) 未通关存档（chapter 2）→ 409 且不回泄结局全文。
//
// 终章存档由 sqlite 直改（与服务器同一 DB_PATH）：chapter=8 +
// scene='ch8_epilogue'，等价于主线走完全程后的真实落点。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 本断言默认打隔离实例 3089（自测命令里的 PORT）；显式 API_BASE 仍可覆盖。
process.env.API_BASE = process.env.API_BASE || "http://127.0.0.1:3089/game/api";
const { assert, get, ok, makeSave, post } = await import("./_http.mjs");

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// 结局全文指纹：409 回包里出现任一片段都算泄漏。
const chaptersData = require(path.join(ROOT, "server", "data", "chapters.json"));
const ch8 = chaptersData.chapters.find((c) => c.index === 8 || c.id === "ch8");
const epilogueScene = ch8.scenes.find((s) => s.id === "ch8_epilogue");
const epilogueFingerprints = String(epilogueScene.text || "")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.length >= 12);

const OLD_SPAM_LINE = "此处已是故事的终章，再无前路";

const id = await makeSave("ending-closure");
try {
  // ── (d) 未通关存档：chapter 2、人在章内 → 409，不泄结局全文 ────────────
  db.prepare("UPDATE saves SET chapter = 2, scene = NULL WHERE id = ?").run(id);
  const locked = await get(`/saves/${id}/ending`);
  assert(locked.status === 409, `uncleared save must 409, got HTTP ${locked.status}`);
  assert(
    locked.body && typeof locked.body.error === "string" && locked.body.error.length > 0,
    "409 body must carry an error message"
  );
  assert(!locked.body.ending, "409 must not leak ending payload");
  const lockedBlob = JSON.stringify(locked.body);
  for (const frag of epilogueFingerprints) {
    assert(!lockedBlob.includes(frag), `409 leaked epilogue text: ${frag.slice(0, 20)}…`);
  }

  // ── 造「已在终章场景」的存档 ──────────────────────────────────────────
  db.prepare("UPDATE saves SET chapter = 8, scene = 'ch8_epilogue' WHERE id = ?").run(id);

  const sav0 = (await get(`/saves/${id}`)).body.save;
  const logBefore = (await get(`/saves/${id}/log?limit=200`)).body.log;
  const hp0 = sav0.hp;
  const mp0 = sav0.mp;

  // ── (a)+(b) 连点 3 次「前进」──────────────────────────────────────────
  const replies = [];
  for (let i = 0; i < 3; i++) {
    const r = await post("/action", { save_id: id, input: "前进" });
    assert(r.status === 200 && r.body && r.body.reply && r.body.save,
      `advance at epilogue failed (HTTP ${r.status})`);
    replies.push(r.body);
  }

  for (const [i, r] of replies.entries()) {
    assert(r.save.hp === hp0, `#${i + 1} hp changed: ${hp0} -> ${r.save.hp}`);
    assert(r.save.mp === mp0, `#${i + 1} mp changed: ${mp0} -> ${r.save.mp}`);
    assert(r.save.scene === "ch8_epilogue", `#${i + 1} scene moved: ${r.save.scene}`);
    // (b) 终章态字段：at_epilogue（saveView）与 ending_ready（回包）都应为真
    assert(
      r.save.at_epilogue === true || r.ending_ready === true,
      `#${i + 1} missing epilogue flag (at_epilogue=${r.save.at_epilogue}, ending_ready=${r.ending_ready})`
    );
    const content = String(r.reply.content || "");
    assert(!content.includes(OLD_SPAM_LINE), `#${i + 1} reply still carries old spam line`);
    assert(content.includes("结算"), `#${i + 1} reply must point at the ending panel: ${content}`);
  }
  // 三次回复同一句话 = 一次性说明，不是逐条新叙述。
  const contents = new Set(replies.map((r) => r.reply.content));
  assert(contents.size === 1, `replies diverged across repeats: ${[...contents].join(" | ")}`);

  const logAfter = (await get(`/saves/${id}/log?limit=200`)).body.log;
  assert(
    logAfter.length === logBefore.length,
    `log grew at epilogue: ${logBefore.length} -> ${logAfter.length}`
  );

  // ── (c) 结算接口：真实战绩 + 幂等 ─────────────────────────────────────
  const end1 = await get(`/saves/${id}/ending`);
  assert(end1.status === 200 && end1.body && end1.body.ending,
    `ending fetch failed (HTTP ${end1.status})`);
  const e1 = end1.body.ending.stats;
  const sav1 = (await get(`/saves/${id}`)).body.save;
  assert(e1.level === sav1.level, `level mismatch: ending=${e1.level} save=${sav1.level}`);
  assert(e1.kills === sav1.kills, `kills mismatch: ending=${e1.kills} save=${sav1.kills}`);
  assert(e1.chapters_cleared === 8, `chapters_cleared mismatch: ${e1.chapters_cleared}`);

  const end2 = await get(`/saves/${id}/ending`);
  assert(end2.status === 200, `second ending fetch failed (HTTP ${end2.status})`);
  assert(
    JSON.stringify(end2.body.ending) === JSON.stringify(end1.body.ending),
    "ending payload drifted between fetches"
  );

  // 重复「前进」后结算仍可用、仍一致（拒绝态不破坏结算入口）。
  const end3 = await get(`/saves/${id}/ending`);
  assert(end3.status === 200, `ending after repeats failed (HTTP ${end3.status})`);
} finally {
  db.prepare("DELETE FROM saves WHERE id = ?").run(id);
  db.close();
}

ok();
