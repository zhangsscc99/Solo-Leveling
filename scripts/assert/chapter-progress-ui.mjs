#!/usr/bin/env node
// F091 顶栏章内进度与主线状态：
//   ① 顶栏（桌面 + 390px 移动端）显示「第N章 · 章名 · x/y」，
//      文本匹配 /第\d+章.*\d+\/\d+/，窄屏不裁半；
//   ② 主线集满（chapter_completed）后，任务面板对应主线徽记翻「已达成」——
//      推到终章 5/5 也不再停留「进行中」。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { post, get, advanceTraverse } = await import("./_http.mjs");

const NAME = `e2e-chprog-${Date.now().toString(36)}`;
const TOPBAR_RE = /第\d+章.*\d+\/\d+/;

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

  // ② 一路「前进」到终章 epilogue（chapter_completed + cleared）。
  //    交战中前进=掷逃、死亡会回溯——低章顺手练级撑血线的生存向驱动
  //    （advanceTraverse）展开成真实操作序列，预算给足。
  let view = null;
  for (let i = 0; i < 300; i++) {
    const body = await advanceTraverse(saveId, { max: 600 });
    view = body.save;
    if (view && view.cleared) break;
  }
  assert(view && view.cleared, "did not reach epilogue within the landing budget");
  assert(view.chapter_progress === "5/5", `final progress ${view.chapter_progress} != 5/5`);
  const sv = await get(`/saves/${saveId}`);
  assert(
    sv.body && sv.body.save && sv.body.save.chapter_completed === true,
    "save.chapter_completed not true at epilogue"
  );

  // 任务面板：8 条主线全部「已达成」，终章 5/5 不永远「进行中」
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
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
