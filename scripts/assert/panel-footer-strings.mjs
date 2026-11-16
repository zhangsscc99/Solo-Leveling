#!/usr/bin/env node
// F130 面板页脚调试串清理：
//   每个档案面板（背包/技能/属性/地图/任务/影子）打开后，.side-foot
//   文本不得匹配 /面板\s*\d+\s*[–-]\s*\d+/（旧开发期串「面板 5–0」）；
//   390×844 移动端同口径，且脚注仍带「点 × 关闭」、无 ESC（F109 护栏，
//   与 panel-affordance 断言同区不冲突）。
// 变异敏感性：恢复「面板 5–0」→ 桌面与移动端两条断言都红。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `e2e-f130-${Date.now().toString(36)}`;
const BAD = /面板\s*\d+\s*[–-]\s*\d+/;
const TABS = ["背包", "技能", "属性", "地图", "任务", "影子"];

run("panel-footer-strings", async ({ page }) => {
  await createSave(page, NAME);

  // ── 桌面 1440×900：逐个面板打开后读脚注 ──
  for (const label of TABS) {
    await page.locator(".btn-group-sys .btn", { hasText: label }).first().click();
    // 侧栏桌面常驻：等当前页签名就位再读脚注（切换是 React 重渲染）。
    await page.waitForFunction(
      (want) => document.querySelector(".sidebar .side-title .cur")?.textContent?.trim() === want,
      label,
      { timeout: 8000 }
    );
    const foot = (await page.locator(".side-foot").innerText()).replace(/\s+/g, " ").trim();
    assert(
      !BAD.test(foot),
      `tab「${label}」footer still carries the「面板 N–N」debug string: "${foot}"`
    );
  }

  // ── 移动端 390×844：抽屉式面板同口径 ──
  const browser = page.context().browser();
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  try {
    const mp = await mctx.newPage();
    await createSave(mp, `${NAME}-m`);
    // 抽屉打开后覆盖底栏按钮——每轮：点 tab（顺带开抽屉）→ 读脚注 → 关掉再点下一个。
    for (const label of TABS.slice(0, 3)) {
      await mp.locator(".btn-group-sys .btn", { hasText: label }).first().click();
      await mp.waitForSelector(".sidebar.open");
      await mp.waitForFunction(
        (want) => document.querySelector(".sidebar .side-title .cur")?.textContent?.trim() === want,
        label,
        { timeout: 8000 }
      );
      const foot = await mp.locator(".side-foot").innerText();
      assert(
        !BAD.test(foot),
        `mobile tab「${label}」footer carries the「面板 N–N」debug string: "${foot}"`
      );
      assert(foot.includes("点 × 关闭"), `mobile foot missing tap-to-close copy: "${foot}"`);
      assert(!/esc/i.test(foot), `mobile foot still mentions ESC: "${foot}"`);
      await mp.locator(".side-close").click();
      await mp.waitForSelector(".sidebar.open", { state: "detached" });
    }
  } finally {
    await mctx.close();
  }
});
