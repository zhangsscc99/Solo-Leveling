#!/usr/bin/env node
// panels.mjs: open 背包/技能/属性/地图/任务 panels in turn, assert each has
// key content, and each can be closed.
import { assert, createSave, run } from "./lib.mjs";

const NAME = `e2e-panel-${Date.now().toString(36)}`;

const PANELS = [
  {
    label: "背包",
    check: async (page) => {
      await page.waitForSelector(".inv");
      const tabs = await page.locator(".inv-tabs .inv-tab").count();
      assert(tabs === 4, `inventory has 4 category tabs (got ${tabs})`);
      const slots = await page.locator(".inv-slots .inv-slot").count();
      assert(slots >= 2, `equipment slots rendered (got ${slots})`);
      const rows = await page.locator(".inv-rows > li").count();
      assert(rows >= 1, `starter kit rows visible (got ${rows})`);
    },
  },
  {
    label: "技能",
    check: async (page) => {
      await page.waitForSelector(".skill, .side-empty");
      const empty = await page.locator(".side-empty").count();
      if (empty) return;
      const meters = await page.locator(".skill-meter").count();
      assert(meters >= 1, `skill meters rendered (got ${meters})`);
      const rows = await page.locator(".skill-rows > li").count();
      assert(rows >= 1, `skill catalog rows visible (got ${rows})`);
    },
  },
  {
    label: "属性",
    check: async (page) => {
      await page.waitForSelector(".stat-panel");
      const lines = await page.locator(".stat-table .stat-line").count();
      assert(lines === 5, `five stat lines (got ${lines})`);
      const text = await page.locator(".stat-panel").innerText();
      assert(/剩余属性点/.test(text), "free-points row present");
      assert(/经验值|经验/.test(text), "xp bar present");
    },
  },
  {
    label: "地图",
    check: async (page) => {
      await page.waitForSelector(".map-list");
      const nodes = await page.locator(".map-list .map-node").count();
      assert(nodes === 8, `8 chapter nodes (got ${nodes})`);
      const now = await page.locator(".map-list .map-now").count();
      assert(now === 1, `exactly one current node (got ${now})`);
      const locked = await page.locator(".map-list .map-locked").count();
      assert(locked >= 1, `locked chapters greyed (got ${locked})`);
    },
  },
  {
    label: "任务",
    check: async (page) => {
      await page.waitForSelector(".quest, .side-empty");
      if (await page.locator(".quest").count()) {
        const blocks = await page.locator(".quest .q-block").count();
        assert(blocks >= 1, `quest sections rendered (got ${blocks})`);
        const rows = await page.locator(".quest .q-row").count();
        assert(rows >= 1, `quest rows visible (got ${rows})`);
        const tracks = await page.locator(".quest .q-track").count();
        assert(tracks >= 1, `quest progress bars (got ${tracks})`);
      } else {
        const text = await page.locator(".side-empty").innerText();
        assert(/任务|暂无/.test(text), `quest placeholder copy (${text.slice(0, 24)})`);
      }
    },
  },
];

run("panels", async ({ page }) => {
  await createSave(page, NAME);

  for (const { label, check } of PANELS) {
    await page.locator(".btn-group-sys .btn", { hasText: label }).first().click();
    await page.waitForSelector(".sidebar.open");
    const cur = (await page.locator(".side-title .cur").innerText()).trim();
    assert(cur === label, `drawer current tab is ${label} (got ${cur})`);
    await check(page);

    // Close via Escape (the documented close path) and verify the drawer
    // actually closes.
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".sidebar.open"));
  }
});
