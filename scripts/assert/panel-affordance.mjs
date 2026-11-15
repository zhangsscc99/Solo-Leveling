#!/usr/bin/env node
// F079 affordances：
//   ① 技能面板中带「Lv.N 解锁」提示的释放键 disabled + aria-disabled="true"
//     + title="等级不足：需 Lv.N"；
//   ② .side-scroll 滚到底时，最后一张卡片与滚动容器底边（即「面板 5–0 /
//     ESC 关闭」分隔线）间距 ≥12px（boundingBox 实量）；
//   ③ 390×844 视口下 .sidebar 宽度 ≥0.95×390，脚注提示不含「ESC」。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `e2e-afford-${Date.now().toString(36)}`;

run("panel-affordance", async ({ page }) => {
  await createSave(page, NAME);

  // ── ① 未解锁技能：释放键灰死并给出等级原因 ──
  await page.locator(".btn-group-sys .btn", { hasText: "技能" }).first().click();
  await page.waitForSelector(".sidebar.open");
  await page.waitForSelector(".skill, .side-empty");

  const lockedRows = page.locator(".skill-row", {
    has: page.locator(".skill-state", { hasText: /Lv\.\d+\s*解锁/ }),
  });
  const locked = await lockedRows.count();
  assert(locked >= 1, "no locked skill rows carrying a「Lv.N 解锁」hint");
  for (let i = 0; i < locked; i++) {
    const row = lockedRows.nth(i);
    const btn = row.locator("button.skill-btn");
    const name = (await row.locator(".skill-name").innerText()).trim();
    assert(await btn.isDisabled(), `locked skill「${name}」release button not disabled`);
    assert(
      (await btn.getAttribute("aria-disabled")) === "true",
      `locked skill「${name}」release button missing aria-disabled="true"`
    );
    const title = await btn.getAttribute("title");
    assert(
      /等级不足：需 Lv\.\d+/.test(title || ""),
      `locked skill「${name}」release button missing level title (got "${title}")`
    );
    const hint = (await row.locator(".skill-state").innerText()).trim();
    assert(/Lv\.\d+\s*解锁/.test(hint), `locked skill「${name}」missing grey Lv.N hint text`);
  }

  // ── ② 滚动末端留白 ≥12px ──
  const measure = await page.evaluate(() => {
    const sc = document.querySelector(".side-scroll");
    if (!sc) return null;
    sc.scrollTop = sc.scrollHeight;
    const scR = sc.getBoundingClientRect();
    let bottom = -Infinity;
    let which = "";
    for (const el of sc.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.height === 0) continue;
      if (r.bottom > bottom) {
        bottom = r.bottom;
        which = el.className && typeof el.className === "string" ? el.className : el.tagName;
      }
    }
    return { gap: scR.bottom - bottom, which };
  });
  assert(measure !== null, ".side-scroll not found");
  assert(
    measure.gap >= 12,
    `last card (.${measure.which}) is only ${measure.gap.toFixed(1)}px above the side-scroll bottom edge (need ≥12)`
  );

  // ── ③ 手机视口：抽屉 ≥95vw，脚注无 ESC ──
  const browser = page.context().browser();
  const mctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  try {
    const mp = await mctx.newPage();
    await createSave(mp, `${NAME}-m`);
    await mp.locator(".drawer-toggle").click();
    await mp.waitForSelector(".sidebar.open");
    const box = await mp.locator(".sidebar").boundingBox();
    assert(box !== null, ".sidebar has no bounding box");
    assert(
      box.width >= 0.95 * 390,
      `sidebar width ${box.width.toFixed(1)}px < ${(0.95 * 390).toFixed(1)}px (0.95×390)`
    );
    const foot = await mp.locator(".side-foot").innerText();
    assert(!/esc/i.test(foot), `mobile foot hint still mentions ESC: "${foot}"`);
    assert(foot.includes("点 × 关闭"), `mobile foot hint missing tap-to-close copy: "${foot}"`);
  } finally {
    await mctx.close();
  }
});
