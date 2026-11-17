#!/usr/bin/env node
// F084 日志可回溯：
//   造 ≥120 条日志的存档（API 循环「观察」，每条 = user+reply 两行），
//   reload 回灌 → 首屏渲染 ≈50 行 →「加载更早」一次后行数增多（≥90）
//   且按钮文案变化 → 再点到底后按钮变「已到最初」disabled，行数不再
//   增长、不再发 /log 请求。
// 变异敏感性：旧码固定 getLog(50)、无回溯控件 → 首屏后所有断言红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { act, get } = await import("./_http.mjs");

const NAME = `e2e-f084-${Date.now().toString(36)}`;
const rowCount = (page) => page.locator(".stage-col > *").count();

run("log-paging", async ({ page }) => {
  const saveId = await createSave(page, NAME).then(() =>
    page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // ── 造 ≥120 条日志：70 次「观察」= ~140 行 ──
  for (let i = 0; i < 70; i++) await act(saveId, "观察");
  const { body: probe } = await get(`/saves/${saveId}/log?limit=200`);
  const total = probe && probe.log ? probe.log.length : 0;
  assert(total >= 120, `fixture too small: only ${total} log rows`);

  // ── reload 回灌：首屏窗口 = 最近 50 行 ──
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".log-earlier-btn");
  const n0 = await rowCount(page);
  assert(n0 >= 45 && n0 <= 55, `first screen rows ${n0} not ~50`);
  const btn = page.locator(".log-earlier-btn").first();
  assert((await btn.innerText()).includes("加载更早"), "paging button missing「加载更早」copy");
  assert(await btn.isEnabled(), "paging button should be enabled with earlier rows");

  // ── 记 /log 请求数：每次翻页恰一发 ──
  let logReqs = 0;
  page.on("request", (r) => {
    if (r.url().includes(`/saves/${saveId}/log`)) logReqs += 1;
  });

  // ── 第一次翻页：50 → ≥90 行，按钮仍是「加载更早」──
  await btn.click();
  await page.waitForFunction((n) => document.querySelectorAll(".stage-col > *").length >= 90, n0);
  const n1 = await rowCount(page);
  assert(n1 > n0 && n1 >= 90, `rows ${n0} -> ${n1}, expected ≥90`);
  const label1 = await btn.innerText();
  assert(/加载更早|回溯/.test(label1), `button copy after first page: "${label1}"`);

  // ── 连续翻到底：按钮变「已到最初」disabled，行数 = 全量 ──
  for (let i = 0; i < 6; i++) {
    if ((await btn.innerText()).includes("已到最初")) break;
    await btn.click();
    await page.waitForTimeout(500);
  }
  assert((await btn.innerText()).includes("已到最初"), `button never reached「已到最初」: "${await btn.innerText()}"`);
  assert(await btn.isDisabled(), "「已到最初」button must be disabled (no more requests)");
  const nEnd = await rowCount(page);
  assert(nEnd >= total, `rows ${nEnd} < total ${total} at「已到最初」`);

  // ── 到底后再点（含程序化 click）不再发请求、行数不动 ──
  const reqsAtEnd = logReqs;
  await btn.dispatchEvent("click").catch(() => {});
  await page.waitForTimeout(600);
  assert(logReqs === reqsAtEnd, `/log refetched after「已到最初」(${reqsAtEnd} -> ${logReqs})`);
  assert((await rowCount(page)) === nEnd, "rows changed after「已到最初」");
});
