#!/usr/bin/env node
// F089 contract: 终章收束 —— 已在 ch8_epilogue 的存档再点「前进」必须整体
// 拒绝（不扣 HP/MP、日志零增长、回复只带一次性结算指引），并由响应字段
// 表达终章态；结算接口照常返回真实战绩且幂等，未通关存档继续 409。
//
//   (a) 连点 3 次「前进」→ save.hp/mp 不变、log 行数不增长、回复不含旧的
//       「此处已是故事的终章，再无前路」逐字刷屏句，且三次回复同一句话；
//   (b) 响应带终章态字段：save.at_epilogue === true 且 ending_ready === true；
//   (c) GET /saves/:id/ending → 200，stats.level/kills 与 save 一致，
//       连拉两次结果相同（cleared_at 冻结，不重复入账）；
//   (d) 未通关存档（chapter 2）→ 409 且不回泄结局全文；
//   (e) 终章下「攻击」不得开战：combat 保持 null，只回诚实播报；
//   (f) 终章 + 交战态（注入 combat 行）：「前进」= 撤离掷逃，最终脱离
//       （combat → null、scene 不离 ch8_epilogue、HP 按真实撤离规则变化），
//       脱战后再「前进」回到整体拒绝口径。
//
// 日志零增长按 DB 行数 + max(id) 比对——/log?limit=200 在 >200 行时恒真，
// 等于失明。
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
  // 日志零增长以 DB 行数 + max(id) 为准：API 的 ?limit=200 截断后
  // length===length 恒真，挡不住真实写入。
  const logCount = () =>
    db.prepare("SELECT COUNT(*) AS n FROM log WHERE save_id = ?").get(id).n;
  const logMaxId = () =>
    db.prepare("SELECT COALESCE(MAX(id), 0) AS m FROM log WHERE save_id = ?").get(id).m;
  const logBefore = { count: logCount(), maxId: logMaxId() };
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
    // (b) 终章态字段：at_epilogue（saveView）与 ending_ready（回包）各自为真，
    // 不做 OR——任一缺失都算回归。
    assert(r.save.at_epilogue === true, `#${i + 1} save.at_epilogue must be true`);
    assert(r.ending_ready === true, `#${i + 1} response must carry ending_ready=true`);
    const content = String(r.reply.content || "");
    assert(!content.includes(OLD_SPAM_LINE), `#${i + 1} reply still carries old spam line`);
    assert(content.includes("结算"), `#${i + 1} reply must point at the ending panel: ${content}`);
  }
  // 三次回复同一句话 = 一次性说明，不是逐条新叙述。
  const contents = new Set(replies.map((r) => r.reply.content));
  assert(contents.size === 1, `replies diverged across repeats: ${[...contents].join(" | ")}`);

  assert(
    logCount() === logBefore.count && logMaxId() === logBefore.maxId,
    `log grew at epilogue: rows ${logBefore.count} -> ${logCount()}, maxId ${logBefore.maxId} -> ${logMaxId()}`
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

  // ── (e) 终章下「攻击」不得开战 ─────────────────────────────────────
  // peacefulCombatIntent 的终章守卫：叫阵只回诚实播报，combat 保持 null。
  const atk = await post("/action", { save_id: id, input: "攻击" });
  assert(atk.status === 200 && atk.body && atk.body.save,
    `attack at epilogue failed (HTTP ${atk.status})`);
  assert(atk.body.save.combat == null, "attack at epilogue opened combat");
  assert(
    String(atk.body.reply.content || "").includes("无可战之敌") ||
      String(atk.body.reply.content || "").includes("没有可攻击的目标"),
    `attack refusal must be honest: ${atk.body.reply.content}`
  );
  const savAtk = (await get(`/saves/${id}`)).body.save;
  assert(savAtk.combat == null, "combat persisted after epilogue attack");
  assert(savAtk.scene === "ch8_epilogue", `attack moved scene: ${savAtk.scene}`);

  // ── (f) 终章 + 交战态：「前进」= 撤离掷逃 ─────────────────────────
  // 直接注入一条战斗行（终章守卫只挡「新遭遇」，不抹杀既存交战态——
  // 旧档/异常路径留下的战斗必须能收尾）。残影 strength=0 → 反击至多
  // 磨 1 点；玩家血池加厚，保证只验「能撤离」，不卷入死亡回溯。
  db.prepare("UPDATE saves SET hp = 500, max_hp = 500 WHERE id = ?").run(id);
  const shade = JSON.stringify({
    id: "epilogue_shade", name: "终章残影", level: 1, rank: "E",
    hp: 9999, maxHp: 9999, xp: 1,
    stats: { strength: 0, agility: 0, vitality: 0, intelligence: 0, perception: 0 },
  });
  db.prepare("INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1)").run(id, shade);

  const armed = (await get(`/saves/${id}`)).body.save;
  assert(armed.combat, "combat injection failed: save.combat is empty");
  assert(armed.scene === "ch8_epilogue", `combat test setup: scene is ${armed.scene}`);
  const hpArmed = armed.hp;

  let fled = null;
  for (let i = 0; i < 40 && !fled; i++) {
    const r = await post("/action", { save_id: id, input: "前进" });
    assert(r.status === 200 && r.body && r.body.save,
      `flee attempt ${i + 1} failed (HTTP ${r.status})`);
    assert(r.body.save.scene === "ch8_epilogue",
      `flee attempt moved scene: ${r.body.save.scene}`);
    assert(r.body.save.hp > 0, `flee attempt ${i + 1} killed the player`);
    if (!r.body.save.combat) fled = r.body;
  }
  assert(fled, "40 flee attempts at epilogue and combat still active");
  // 真实撤离规则：成功回合不挨反击；失败回合至多被磨血——HP 只降不升。
  assert(fled.save.hp <= hpArmed, `hp rose during flee: ${hpArmed} -> ${fled.save.hp}`);
  assert(fled.save.at_epilogue === true, "at_epilogue lost after fleeing combat");

  // 脱战后再点「前进」回到整体拒绝口径：不移动、日志不再增长、仍带指引。
  const logBeforeRefuse2 = { count: logCount(), maxId: logMaxId() };
  const refuse2 = await post("/action", { save_id: id, input: "前进" });
  assert(refuse2.status === 200 && refuse2.body.ending_ready === true,
    "post-flee advance must be refused at epilogue");
  assert(refuse2.body.save.scene === "ch8_epilogue" && refuse2.body.save.combat == null,
    "post-flee advance must not move scene or reopen combat");
  assert(
    logCount() === logBeforeRefuse2.count && logMaxId() === logBeforeRefuse2.maxId,
    "post-flee refusal wrote log rows"
  );
} finally {
  db.prepare("DELETE FROM saves WHERE id = ?").run(id);
  db.close();
}

ok();
