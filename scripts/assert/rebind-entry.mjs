#!/usr/bin/env node
// F159 主界面换号入口：
//   档案面板 .side-foot 存在「重新登记」或「换号」按钮 → 点击后回觉醒页
//   （.gate-form 可见）、本机绑定 localStorage.solo_leveling_save_id 清除；
//   服务端存档不删（GET /saves/:id 仍 200），按钮附「原代号可找回」说明。
// 变异敏感性：旧码 .side-foot 只有页签计数与关闭提示，按钮不存在 → 红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { get } = await import("./_http.mjs");

const NAME = `e2e-f159-${Date.now().toString(36)}`;

run("rebind-entry", async ({ page }) => {
  const saveId = await createSave(page, NAME).then(() =>
    page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // ── 打开档案面板（系统组页签键，桌面/抽屉两态通用）──
  await page.locator(".btn-group-sys .btn", { hasText: "背包" }).first().click();
  await page.waitForSelector(".sidebar.open");
  await page.waitForSelector(".side-foot");

  // ── .side-foot 里的换号按钮：存在、可见、带后果小字 ──
  const btn = page.locator(".side-foot button", { hasText: /重新登记|换号/ }).first();
  assert((await btn.count()) === 1, "rebind button missing in .side-foot");
  assert(await btn.isVisible(), "rebind button not visible");
  const footText = await page.locator(".side-foot").innerText();
  assert(
    /找回|仍在服务器|不删|保留/.test(footText),
    `side-foot missing consequence note: "${footText.slice(0, 200)}"`
  );

  // ── 点击 → 回觉醒页；本机绑定清除；服务端存档仍在 ──
  await btn.click();
  await page.waitForSelector(".gate-form", { state: "visible" });
  const stored = await page.evaluate(() => localStorage.getItem("solo_leveling_save_id"));
  assert(stored === null, `localStorage binding not cleared (still ${stored})`);
  const { status } = await get(`/saves/${saveId}`);
  assert(status === 200, `save ${saveId} deleted after rebind (GET → ${status})`);
});
