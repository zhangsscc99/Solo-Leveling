#!/usr/bin/env node
// quests.mjs (F008 contract): quest panel shows 主线 + 每日任务 sections with
// progress bars, rewards and the daily penalty countdown.
import { assert, createSave, run } from "./lib.mjs";

const NAME = `e2e-quest-${Date.now().toString(36)}`;

run("quests", async ({ page }) => {
  await createSave(page, NAME);

  await page.locator(".btn-group-sys .btn", { hasText: "任务" }).first().click();
  await page.waitForSelector(".sidebar.open");
  await page.waitForSelector(".quest");

  const text = await page.locator(".quest").innerText();
  assert(/主线任务/.test(text), "主线任务 section present");
  assert(/每日任务/.test(text), "每日任务 section present");

  const rows = await page.locator(".quest .q-row").count();
  assert(rows >= 1, `quest entries rendered (got ${rows})`);
  const tracks = await page.locator(".quest .q-track").count();
  assert(tracks >= 1, `progress bars rendered (got ${tracks})`);
  assert(/奖励/.test(text), "reward preview present");
});
