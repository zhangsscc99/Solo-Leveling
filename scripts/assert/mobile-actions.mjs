#!/usr/bin/env node
// F085 移动端系统按钮可达：
//   390×844 下「战斗 / 存档 / 影子」（及行动组四键）boundingBox 完整落在
//   视口内；若不在，则其滚动容器必须可滑（scrollWidth > clientWidth）且
//   滑动后按钮可见——不允许「被裁且滑不动」。同时底栏不遮挡对话输入区、
//   对话区保留最小高度。附 360px 回归。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `e2e-mact-${Date.now().toString(36)}`;
const VW = 390;
const VH = 844;

const SYS_BTNS = ["战斗", "存档", "影子"];
const ACT_BTNS = ["探索前进", "环顾四周", "潜行", "休息"];

async function checkButtons(page, vw, vh) {
  for (const [group, labels] of [
    [".btn-group-sys", SYS_BTNS],
    [".btn-group:not(.btn-group-sys)", ACT_BTNS],
  ]) {
    for (const label of labels) {
      const btn = page.locator(`${group} .btn`, { hasText: label }).first();
      assert((await btn.count()) === 1, `${label} button missing`);
      let box = await btn.boundingBox();
      assert(box, `${label} has no boundingBox`);
      const inView = (b) =>
        b.x >= -0.5 && b.y >= -0.5 && b.x + b.width <= vw + 0.5 && b.y + b.height <= vh + 0.5;
      if (!inView(box)) {
        // 退路：容器可横滑——滑动后按钮必须进入视口
        const scrolled = await btn.evaluate((el) => {
          let p = el.parentElement;
          while (p) {
            if (p.scrollWidth > p.clientWidth + 1) {
              p.scrollLeft = p.scrollWidth;
              return true;
            }
            p = p.parentElement;
          }
          return false;
        });
        assert(scrolled, `${label} clipped and its container cannot scroll`);
        box = await btn.boundingBox();
        assert(box && inView(box), `${label} still out of viewport after scroll`);
      }
      assert(box.height >= 40, `${label} touch height ${box.height}px < 40px`);
    }
  }
}

async function checkInputAndStage(page, vh) {
  const ib = await page.locator(".input-row input").boundingBox();
  assert(ib && ib.y + ib.height <= vh + 0.5 && ib.y >= 0, "input row out of viewport");
  const covered = await page.evaluate(() => {
    const el = document.querySelector(".input-row input");
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !(hit === el || el.contains(hit));
  });
  assert(!covered, "input row covered by another element (bottom bar overlaps it)");
  const stage = await page.locator(".stage").boundingBox();
  assert(stage && stage.height >= 140, `dialogue area squeezed to ${stage && stage.height}px (<140)`);
}

run(
  "mobile-actions",
  async ({ page }) => {
    await createSave(page, NAME);
    await checkButtons(page, VW, VH);
    await checkInputAndStage(page, VH);

    // 360px 回归
    const browser = page.context().browser();
    const mctx = await browser.newContext({
      viewport: { width: 360, height: 800 },
      locale: "zh-CN",
      hasTouch: true,
      isMobile: true,
    });
    try {
      const mp = await mctx.newPage();
      await createSave(mp, `${NAME}-360`);
      await checkButtons(mp, 360, 800);
      await checkInputAndStage(mp, 800);
    } finally {
      await mctx.close();
    }
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
