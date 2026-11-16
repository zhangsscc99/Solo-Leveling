#!/usr/bin/env node
// F135 守关者门前「半个战斗栏」清理：
//   DB 落点构造 sealed 态（守关者未击杀 + 人已在 ch1 boss 房 + 无交战 +
//   encounter_clock=-1，与 boss-room-escape-ui 同一构造）→
//     a) advance_mode=challenge_boss 且 combat=null 时，行动组内不得
//        渲染「释放技能/防御/逃跑」的 disabled 残键；
//     b) 留下的开战键文案自带「叫阵」（点击前页面必现「叫阵」字样）、
//        enabled、可点；
//     c) 真点该键 → /action 回包 save.combat 为守关者（同一「攻击」
//        结算路径）；开战后四键进入交战可用态（liveCombat 不变式）。
// 变异敏感性：恢复 COMBAT_BUTTONS 整组渲染 → (a) 残键计数断言必红；
//   按钮文案退回「攻击」→ (b) 叫阵文案断言必红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { fetchSaveView } = await import("./_http.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 独立 oracle：守关房 id 与守关者真名只从数据文件推导。
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const CH1_BOSS = CH1.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS && CH1_BOSS.title, "oracle: ch1 boss scene missing");

const NAME = `e2e-f135-${Date.now().toString(36)}`;

const barBtn = (page, label) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

run("gate-no-stray-combat-bar", async ({ page }) => {
  // ── 建档 → DB 落点 sealed 态 → 重载回灌 ─────────────────────────
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");
  db.prepare(
    "UPDATE saves SET scene = ?, boss_cleared_json = '[]', encounter_clock = -1, encounter_cd = 0 WHERE id = ?"
  ).run(CH1_BOSS.id, saveId);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForTimeout(500);

  const s0 = (await fetchSaveView(saveId)).save;
  assert(
    s0.scene === CH1_BOSS.id && s0.combat === null && s0.advance_mode === "challenge_boss",
    `setup broken: scene=${s0.scene} combat=${JSON.stringify(s0.combat)} advance_mode=${s0.advance_mode}`
  );

  // ── (a) 挑衅态不得渲染 disabled 残键 ────────────────────────────
  for (const label of ["释放技能", "防御", "逃跑"]) {
    assert(
      (await barBtn(page, label).count()) === 0,
      `「${label}」stray key still rendered in challenge_boss state (half combat bar)`
    );
  }

  // ── (b) 留下的开战键：自带「叫阵」文案、enabled ──────────────────
  const call = barBtn(page, "叫阵 · 攻击");
  assert(
    (await call.count()) === 1,
    "「叫阵 · 攻击」button missing — the single engage key should carry叫阵 copy"
  );
  const callText = await call.innerText();
  assert(/叫阵/.test(callText), `engage button lacks「叫阵」copy before click: "${callText}"`);
  assert(await call.isEnabled(), "「叫阵 · 攻击」should be enabled in challenge_boss state");

  // ── (c) 真点开战：同一「攻击」结算路径，开战后四键交战可用 ──────
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    call.click(),
  ]);
  await resp.finished().catch(() => {});
  const json = await resp.json().catch(() => null);
  assert(
    json && json.save && json.save.combat && json.save.combat.enemy,
    `「叫阵 · 攻击」click did not start combat: ${JSON.stringify(json && json.save && json.save.combat)}`
  );
  assert(
    json.save.combat.enemy.boss === true && json.save.combat.enemy.name === CH1_BOSS.title,
    `challenged enemy should be the guardian「${CH1_BOSS.title}」, got ${json.save.combat.enemy.name}`
  );
  for (const label of ["攻击", "释放技能", "防御", "逃跑"]) {
    assert(
      await barBtn(page, label).isEnabled(),
      `「${label}」should be enabled once the guardian fight starts`
    );
  }
});
