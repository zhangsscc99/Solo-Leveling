#!/usr/bin/env node
// F121 守关房软锁修复的 UI 级断言（真实点击开战，「有按钮」不算过）：
//   DB 落点构造 sealed 态（守关者未击杀 + 人已在 ch1 boss 房 + 无交战 +
//   encounter_clock=-1，即守关战逃跑落回房内后的真实可达态）→ 打开页面
//   → 主按钮必须是「叫阵守关者」且可点、行动栏「攻击」disabled===false
//   → 真点主按钮 → /action 回包 save.combat.enemy 为守关者真名（boss）、
//   战斗面板出现敌名与「第 1 回合」、行动栏四键进入交战可用态。
// 变异敏感性：删掉 advanceMode 的 challenge_boss 口子 → 主按钮退回
//   「折返守关者」、攻击键 disabled → 本脚本必红；点击不真 dispatch
//   「攻击」→ save.combat/敌名断言必红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { loadPW, findChrome, createSave, assert } = await import("../e2e/lib.mjs");
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

const NAME = `e2e-f121-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

const barBtn = (page, label) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

async function body(page) {
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
  await settle(page, 600);

  // 服务端口径自检：sealed 态 + 无交战 + challenge_boss 出路在场。
  const s0 = (await fetchSaveView(saveId)).save;
  assert(
    s0.scene === CH1_BOSS.id && s0.combat === null,
    `setup broken: scene=${s0.scene} combat=${JSON.stringify(s0.combat)}`
  );
  assert(
    s0.advance_mode === "challenge_boss",
    `sealed save must carry advance_mode=challenge_boss, got ${s0.advance_mode}`
  );

  // ── 主按钮「叫阵守关者」可点 + 行动栏「攻击」解禁 ───────────────
  const mainBtn = barBtn(page, "叫阵守关者");
  assert((await mainBtn.count()) === 1, "main button「叫阵守关者」missing in sealed boss room");
  assert(await mainBtn.isEnabled(), "main button「叫阵守关者」is disabled");
  assert(
    (await barBtn(page, "折返守关者").count()) === 0,
    "main button still says「折返守关者」inside the boss room (self-contradictory)"
  );
  assert(
    (await barBtn(page, "探索前进").count()) === 0,
    "main button still says「探索前进」behind the sealed gate"
  );
  const atkBtn = barBtn(page, "攻击");
  assert((await atkBtn.count()) === 1, "action bar「攻击」missing");
  assert(
    await atkBtn.isEnabled(),
    "action bar「攻击」must be enabled in challenge_boss state (title: 守关者就在面前 — 叫阵开战)"
  );
  // 其余三键仍锁——叫阵态只开「攻击」这一条口子。
  for (const label of ["释放技能", "防御", "逃跑"]) {
    assert(await barBtn(page, label).isDisabled(), `「${label}」should stay disabled with no engagement`);
  }

  // ── 真点主按钮 → 真实开战（不是只断言「有按钮」）─────────────────
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    mainBtn.click(),
  ]);
  await resp.finished().catch(() => {});
  const json = await resp.json().catch(() => null);
  await settle(page);
  assert(
    json && json.save && json.save.combat && json.save.combat.enemy,
    `challenge click did not start combat: ${JSON.stringify(json && json.save && json.save.combat)}`
  );
  assert(
    json.save.combat.enemy.boss === true && json.save.combat.enemy.name === CH1_BOSS.title,
    `challenged enemy should be the guardian「${CH1_BOSS.title}」, got ${json.save.combat.enemy.name}`
  );
  // 前端确认走的是真实「攻击」结算（叫阵开战播报）。
  assert(
    /遭遇/.test(json.reply?.content || "") && (json.reply?.content || "").includes(CH1_BOSS.title),
    `challenge reply missing the engagement broadcast: ${(json?.reply?.content || "").slice(-160)}`
  );

  // ── UI 收敛到交战态：面板出现敌名/回合，四键可用 ────────────────
  await page.waitForSelector(".combatant-enemy .combatant-name");
  const enemyName = (await page.locator(".combatant-enemy .combatant-name").innerText()).trim();
  assert(
    enemyName.includes(CH1_BOSS.title),
    `combat panel enemy should be「${CH1_BOSS.title}」, got "${enemyName}"`
  );
  const turnText = (await page.locator(".combat-turn").innerText()).trim();
  assert(/第\s*1\s*回合/.test(turnText), `combat panel should show 第 1 回合, got "${turnText}"`);
  for (const label of ["攻击", "释放技能", "防御", "逃跑"]) {
    assert(
      await barBtn(page, label).isEnabled(),
      `「${label}」should be enabled once the guardian fight starts`
    );
  }
  const stage = await page.locator(".stage").innerText();
  assert(
    stage.includes(CH1_BOSS.title),
    "stage log missing the guardian engagement line after challenge"
  );
}

// F087 口径：整套断言失败重试一次（每次开新档，互不污染）。
async function main() {
  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let lastErr = null;
  for (let a = 0; a < 2; a++) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    try {
      await body(page);
      await ctx.close();
      console.log(`[ASSERT] boss-room-escape-ui OK (attempt ${a + 1})`);
      await browser.close();
      process.exit(0);
    } catch (e) {
      lastErr = e;
      try {
        fs.mkdirSync("/root/logs", { recursive: true });
        await page.screenshot({
          path: `/root/logs/e2e-boss-room-escape-ui-${Date.now()}.png`,
          fullPage: true,
        });
      } catch {}
      console.log(
        `[ASSERT] boss-room-escape-ui attempt ${a + 1} failed: ${e.message}${a === 0 ? " — retrying once" : ""}`
      );
      await ctx.close().catch(() => {});
    }
  }
  await browser.close();
  console.error(`[ASSERT] boss-room-escape-ui FAIL: ${lastErr && lastErr.message}`);
  process.exit(1);
}

main();
