#!/usr/bin/env node
// F190 重新登记站内二次确认：
//   390×844 新档 →「档案」开抽屉 → 点「重新登记」：
//   a) 站内确认层出现（[data-testid="rebind-confirm"] 或 role=alertdialog
//      至少一个可见）；此刻 .gate-form input 不存在、localStorage 存档
//      id 仍在、仍在主界面（.status 可见、日志行数不变）；
//   b) 点「取消」→ 确认层消失、仍在游戏内（.gate-form input 仍不存在）；
//   c) 再点「重新登记」→ 点「确定」→ 回觉醒首屏（.gate-form input 存在）、
//      localStorage.solo_leveling_save_id 已清除。
// 变异敏感性：旧码点「重新登记」立即解绑回觉醒页 → a) 即红
// （无确认层，且 .gate-form input 反而出现）。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `R32f190-${Date.now().toString(36)}`.slice(0, 20);
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const CONFIRM = '[data-testid="rebind-confirm"], [role="alertdialog"]';
const REBIND_BTN = '.side-foot button:has-text("重新登记"), .foot-rebind-btn';

// 每一步失败都把当前页面状态带进报错：确认层数 / 觉醒表单数 / 绑定 id。
const stage = async (page) => ({
  confirm: await page.locator(CONFIRM).count(),
  gateInput: await page.locator(".gate-form input").count(),
  sid: await page.evaluate(() => localStorage.getItem("solo_leveling_save_id")),
  drawerOpen: await page.locator("aside.sidebar.open").count(),
});

run(
  "rebind-confirm",
  async ({ page }) => {
    await createSave(page, NAME);
    await settle(page, 700);
    const logRows0 = await page.locator(".stage-col > *").count();

    // 点「档案」开抽屉 → 点「重新登记」
    await page.locator(".drawer-toggle").click();
    await page.waitForSelector("aside.sidebar.open");
    await page.locator(REBIND_BTN).first().click();
    await settle(page);

    // ── a) 确认层出现；未回觉醒页、绑定未动、仍在主界面 ──
    const s1 = await stage(page);
    const confirmVisible = await page
      .locator(CONFIRM)
      .first()
      .isVisible()
      .catch(() => false);
    assert(
      s1.confirm >= 1 && confirmVisible,
      `点「重新登记」后确认层未出现 ${JSON.stringify(s1)}`
    );
    assert(
      s1.gateInput === 0,
      `确认层弹出时却出现觉醒表单 ${JSON.stringify(s1)}`
    );
    assert(
      s1.sid !== null && s1.sid !== "",
      `确认层弹出时 localStorage 绑定已丢 ${JSON.stringify(s1)}`
    );
    assert(
      await page.locator(".status").isVisible(),
      `确认层弹出时已不在主界面 ${JSON.stringify(s1)}`
    );
    const logRows1 = await page.locator(".stage-col > *").count();
    assert(
      logRows1 === logRows0,
      `确认层弹出时日志被清空 ${logRows0}→${logRows1} ${JSON.stringify(s1)}`
    );

    // ── b) 「取消」只收层：确认层消失、仍在游戏内 ──
    const layer = page.locator(CONFIRM).first();
    await layer.locator('button:has-text("取消")').click();
    await settle(page);
    const s2 = await stage(page);
    assert(s2.confirm === 0, `取消后确认层未消失 ${JSON.stringify(s2)}`);
    assert(
      s2.gateInput === 0 && s2.sid !== null,
      `取消后已不在游戏内 ${JSON.stringify(s2)}`
    );

    // ── c) 再点「重新登记」→「确定」→ 回觉醒首屏、绑定清除 ──
    await page.locator(REBIND_BTN).first().click();
    await settle(page);
    const layer2 = page.locator(CONFIRM).first();
    assert(
      await layer2.isVisible().catch(() => false),
      `再次点「重新登记」确认层未复现 ${JSON.stringify(await stage(page))}`
    );
    await layer2.locator('button:has-text("确定")').click();
    await page.waitForSelector(".gate-form input", { state: "visible" });
    const s3 = await stage(page);
    assert(
      s3.gateInput >= 1 && s3.sid === null,
      `确定后未回觉醒页或绑定未清 ${JSON.stringify(s3)}`
    );
  },
  { viewport: { width: 390, height: 844 }, context: { hasTouch: true, isMobile: true } }
);
