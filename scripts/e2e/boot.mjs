#!/usr/bin/env node
// boot.mjs: open homepage -> register hunter name -> main UI appears
// (status bar, HP/MP gauges, action buttons, free-input row).
import { assert, BASE_URL, run } from "./lib.mjs";

const NAME = `e2e-boot-${Date.now().toString(36)}`;

run("boot", async ({ page }) => {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });

  // Gate screen: 觉醒协议 holo window with name form.
  await page.waitForSelector(".holo-gate");
  const gateText = await page.locator(".holo-gate").innerText();
  assert(/觉醒协议/.test(gateText), "gate shows 觉醒协议");
  await page.waitForSelector(".gate-form input");

  await page.fill(".gate-form input", NAME);
  await page.click(".gate-form button[type=submit]");

  // Main UI: status bar with name + HP/MP gauges.
  await page.waitForSelector(".status");
  const shown = (await page.locator(".status-name").innerText()).trim();
  assert(shown === NAME, `status shows hunter name (${shown})`);

  const hpNum = (await page.locator(".status .gauge-hp .gauge-num").innerText()).trim();
  const mpNum = (await page.locator(".status .gauge-mp .gauge-num").innerText()).trim();
  assert(/\d+\s*\/\s*\d+/.test(hpNum), `HP gauge has numbers (${hpNum})`);
  assert(/\d+\s*\/\s*\d+/.test(mpNum), `MP gauge has numbers (${mpNum})`);

  // Five stats + gold/XP in the status bar.
  const stats = await page.locator(".status-nums .stat").count();
  assert(stats >= 5, `status bar lists >=5 stat cells (got ${stats})`);

  // Action buttons: the four 行动 group buttons.
  for (const label of ["探索前进", "环顾四周", "潜行", "休息"]) {
    const n = await page.locator(".actions-main .btn", { hasText: label }).count();
    assert(n >= 1, `action button ${label} present`);
  }

  // Free-action input row.
  await page.waitForSelector(".input-row input");

  // At least one log entry rendered in the stage.
  const entries = await page.locator(".stage-col > *").count();
  assert(entries >= 1, `stage has >=1 entries (got ${entries})`);
});
