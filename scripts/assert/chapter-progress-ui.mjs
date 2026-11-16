#!/usr/bin/env node
// F091 顶栏章内进度与主线状态：
//   ① 顶栏（桌面 + 390px 移动端）显示「第N章 · 章名 · x/y」，
//      文本匹配 /第\d+章.*\d+\/\d+/，窄屏不裁半；
//   ② 终章落点由 better-sqlite3 直接构造（同 gate-refusal-free /
//      ending-closure 的 DB 落点取径）：chapter=8 + scene=ch8_aftermath
//      + boss_cleared=['ch8']——守关者硬门落地后 UI 连点已无法走到
//      终章，驱动方式改为「构造落点 + 一次真实 UI『探索前进』」。
//      断言本体不变：顶栏 x/y 必须与 /saves/:id 的 chapter_progress
//      逐字一致，主线集满后面板 8 条主线徽记全翻「已达成」。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { get } = await import("./_http.mjs");

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const NAME = `e2e-chprog-${Date.now().toString(36)}`;
const TOPBAR_RE = /第\d+章.*\d+\/\d+/;

// 落点场景由服务端同一 chapterPath 推导（构造落点不算断言，断言本体仍是
// 顶栏 vs API 逐字比对）：ch8 主线链倒数第二幕，链尾必须解析为
// endingEngine.EPILOGUE_SCENE_ID（ch8_epilogue），否则落点构造错了。
const chaptersEngine = require(path.join(ROOT, "server", "engine", "chapters.js"));
const endingEngine = require(path.join(ROOT, "server", "engine", "ending.js"));
const CH8_PATH = chaptersEngine.chapterPath(chaptersEngine.getChapter(8));
const PRE_EPILOGUE_SCENE = CH8_PATH[CH8_PATH.length - 2].id;
const CH8_TOTAL = CH8_PATH.length;
if (CH8_PATH[CH8_PATH.length - 1].id !== endingEngine.EPILOGUE_SCENE_ID) {
  throw new Error(
    `oracle broken: ch8 path tail ${CH8_PATH[CH8_PATH.length - 1].id} != ${endingEngine.EPILOGUE_SCENE_ID}`
  );
}

run("chapter-progress-ui", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // ① 新档顶栏即带章内进度（第1章 · … · 1/7）
  const top = (await page.locator(".status").innerText()).replace(/\s+/g, "");
  assert(TOPBAR_RE.test(top), `topbar missing 第N章 x/y (got "${top.slice(0, 80)}")`);

  // 390px 移动端同口径：同一存档直接复用，进度数字完整可见
  const browser = page.context().browser();
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  try {
    const mp = await mctx.newPage();
    await mp.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await mp.evaluate((id) => localStorage.setItem("solo_leveling_save_id", String(id)), saveId);
    await mp.reload({ waitUntil: "domcontentloaded" });
    await mp.waitForSelector(".status");
    const mtop = (await mp.locator(".status").innerText()).replace(/\s+/g, "");
    assert(TOPBAR_RE.test(mtop), `mobile topbar missing 第N章 x/y (got "${mtop.slice(0, 80)}")`);
    // 进度数字不被截半：status-chprog 完整落在顶栏内
    const prog = mp.locator(".status-chprog");
    assert((await prog.count()) === 1, "mobile topbar missing .status-chprog");
    const pb = await prog.boundingBox();
    const hb = await mp.locator(".status").boundingBox();
    assert(
      pb && hb && pb.x >= hb.x - 0.5 && pb.x + pb.width <= hb.x + hb.width + 0.5,
      `.status-chprog clipped by topbar (${JSON.stringify(pb)} vs ${JSON.stringify(hb)})`
    );
  } finally {
    await mctx.close();
  }

  // ② 构造「终章前一幕」落点：chapter=8、站在链尾前一景、守关者已击杀
  //    （守关者门是硬门，UI 驱动到不了终章——改 DB 落点，只留最后一次
  //    推进走真实 UI）。落点场景取自服务端数据，不猜 id。
  const db = new Database(dbPath);
  try {
    db.prepare(
      "UPDATE saves SET chapter = 8, scene = ?, boss_cleared_json = ? WHERE id = ?"
    ).run(PRE_EPILOGUE_SCENE, JSON.stringify(["ch8"]), saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  } finally {
    db.close();
  }

  // 真实 UI 一步：重载后点「探索前进」，落地 ch8_epilogue（结局场景永不
  // 掷遭遇——这一步是确定性的）。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.locator(".actions-main .btn", { hasText: "探索前进" }).first().click();
  // 顶栏等终章进度就位（等真实状态，不 sleep）
  await page.waitForFunction(
    (total) => {
      const t = document.querySelector(".status")?.textContent || "";
      return /第8章/.test(t) && t.includes(`${total}/${total}`);
    },
    CH8_TOTAL
  );

  // 断言本体：顶栏 x/y 与 API 的 chapter_progress 逐字一致
  const topFinal = (await page.locator(".status").innerText()).replace(/\s+/g, "");
  const m = topFinal.match(/(\d+)\/(\d+)/);
  assert(m, `epilogue topbar missing x/y (got "${topFinal.slice(0, 80)}")`);
  const uiProgress = `${m[1]}/${m[2]}`;
  const sv = await get(`/saves/${saveId}`);
  assert(
    sv.body && sv.body.save && sv.body.save.chapter_progress === uiProgress,
    `topbar ${uiProgress} != save.chapter_progress ${sv.body && sv.body.save && sv.body.save.chapter_progress}`
  );
  assert(
    uiProgress === `${CH8_TOTAL}/${CH8_TOTAL}`,
    `final progress ${uiProgress} != ${CH8_TOTAL}/${CH8_TOTAL}`
  );
  assert(
    sv.body.save.chapter_completed === true && sv.body.save.cleared === true,
    "save.chapter_completed/cleared not true at epilogue"
  );

  // 任务面板：8 条主线全部「已达成」，终章 5/5 不永远「进行中」
  await page.locator(".btn-group-sys .btn", { hasText: "任务" }).first().click();
  await page.waitForSelector(".sidebar.open");
  await page.waitForSelector(".quest .q-row");
  const mainRows = page.locator(".quest .q-block[aria-label='主线任务'] .q-row");
  const rowCount = await mainRows.count();
  assert(rowCount === 8, `expect 8 main quest rows (got ${rowCount})`);
  const badges = await mainRows.locator(".q-badge").allInnerTexts();
  assert(
    badges.every((b) => b.trim() === "已达成"),
    `main quests not all 已达成 at epilogue: ${badges.join(",")}`
  );
});
