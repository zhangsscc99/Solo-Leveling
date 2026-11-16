#!/usr/bin/env node
// F132 脱战系统组「战斗」「存档」点击反馈：
//   非交战态点「战斗」→ 300ms 内页面出现含「没有交战」的就地提示
//   （.sys-toast），且空态面板本体照常挂载（combat-gate 行为不变）；
//   点「存档」→ 300ms 内出现就地提示，随后浮现「存档已写入/已保存」
//   的完成确认。
// 变异敏感性：旧代码无 .sys-toast 元素——两条 waitForSelector 超时即红。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `e2e-f132-${Date.now().toString(36)}`;

run("idle-combat-tab-feedback", async ({ page }) => {
  await createSave(page, NAME);

  // ── 脱战点「战斗」：就地空态提示 300ms 内可见 ──
  const combatBtn = page.locator(".btn-group-sys .btn", { hasText: "战斗" }).first();
  await combatBtn.click();
  // 300ms 口径从 click 落地（事件已派进页面）起算——Playwright 点击前的
  // 行动性检查（可视/滚动/命中测试）不计入页面反馈耗时。
  const t0 = Date.now();
  await page.waitForSelector(".sys-toast", { timeout: 3000 });
  const dt0 = Date.now() - t0;
  const toast0 = await page.locator(".sys-toast").innerText();
  assert(
    /没有交战|当前无战斗/.test(toast0),
    `idle「战斗」toast missing empty-state copy: "${toast0}"`
  );
  assert(dt0 <= 300, `idle「战斗」feedback took ${dt0}ms (>300ms)`);
  // 面板本体照常打开（行为不变护栏）：空态文案与关闭键都在。
  await page.waitForSelector("section.combat");
  const panel = await page.locator("section.combat").innerText();
  assert(
    panel.includes("当前没有交战目标"),
    `empty combat panel copy missing after「战斗」click: "${panel.slice(0, 120)}"`
  );
  await page.locator(".combat-close").click();
  await page.waitForSelector("section.combat", { state: "detached" });

  // ── 脱战点「存档」：就地提示 + 写入完成确认 ──
  const saveBtn = page.locator(".btn-group-sys .btn", { hasText: "存档" }).first();
  await saveBtn.click();
  const t1 = Date.now();
  // 就地提示（「正在写入存档…」或已落地的确认文案都算即时反馈）。
  await page.waitForFunction(
    () => /写入|已保存/.test(document.querySelector(".sys-toast")?.textContent || ""),
    null,
    { timeout: 3000 }
  );
  const dt1 = Date.now() - t1;
  assert(dt1 <= 300, `「存档」immediate feedback took ${dt1}ms (>300ms)`);
  // 回包落地后确认文案浮现（「存档已写入 · 存档 #N」）。
  let confirmText = "";
  for (let i = 0; i < 80; i++) {
    confirmText = await page
      .locator(".sys-toast")
      .innerText()
      .catch(() => "");
    if (/已写入|已保存/.test(confirmText)) break;
    await page.waitForTimeout(100);
  }
  assert(
    /已写入|已保存/.test(confirmText),
    `「存档」confirmation never appeared (last toast: "${confirmText}")`
  );
});
