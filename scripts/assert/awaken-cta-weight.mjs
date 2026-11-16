#!/usr/bin/env node
// F156 首屏「觉醒」主 CTA 视觉重量：
//   a) getComputedStyle：按钮背景与输入框不同，且满足
//      「底色 alpha>0.5 或 含 gradient / box-shadow 发光」——哑光描边
//      同款直接 FAIL；输入框 focus 时要有高亮（边框色或阴影变化）；
//   b) 按钮真实可点：填代号 → 点击 → 建档进入游戏（.status 出现）；
//   c) 双视口截图存 /tmp/fb-awaken-*.png（390×844 与 1440×900）。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { loadPW, findChrome, assert } = await import("../e2e/lib.mjs");

const NAME = `F156-${Date.now().toString(36)}`;

async function probe(page, w, h, shot) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");
  await page.waitForSelector(".gate-form button[type=submit]");

  const info = await page.evaluate(() => {
    const btn = document.querySelector(".gate-form button[type=submit]");
    const input = document.querySelector(".gate-form input");
    const cs = (el) => getComputedStyle(el);
    // 取一段 CSS 值里所有颜色函数的最大 alpha（rgb() 视为 1）——
    // 旧版 0.2/0.08 的透明渐变与实心底色就靠这个口径区分。
    const maxAlpha = (str) =>
      Math.max(
        0,
        ...(str.match(/rgba?\([^)]*\)/g) || []).map((m) => {
          const p = m.match(/[\d.]+/g).map(Number);
          return p.length === 4 ? p[3] : 1;
        })
      );
    const b = cs(btn);
    const i = cs(input);
    return {
      btnBgImage: b.backgroundImage,
      btnBgColor: b.backgroundColor,
      btnAlphaMax: Math.max(maxAlpha(b.backgroundColor), maxAlpha(b.backgroundImage)),
      btnShadow: b.boxShadow,
      inputBgImage: i.backgroundImage,
      inputBgColor: i.backgroundColor,
      inputBorder: i.borderColor,
      inputShadow: i.boxShadow,
    };
  });

  // :focus-visible 只在键盘模态生效——脚本 focus() 不算，用真实 Tab 键
  // 把焦点落到输入框再取计算样式。
  await page.evaluate(() => document.querySelector(".gate-form input").blur());
  let focusInfo = null;
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    focusInfo = await page.evaluate(() => {
      const input = document.querySelector(".gate-form input");
      if (document.activeElement !== input || !input.matches(":focus-visible")) return null;
      const fi = getComputedStyle(input);
      return { border: fi.borderColor, shadow: fi.boxShadow };
    });
    if (focusInfo) break;
  }
  assert(focusInfo, "could not keyboard-focus the gate input (:focus-visible never matched)");
  info.focusBorder = focusInfo.border;
  info.focusShadow = focusInfo.shadow;

  // (a) 背景可区分 + 实心/发光。
  const btnBg = `${info.btnBgColor}|${info.btnBgImage}`;
  const inputBg = `${info.inputBgColor}|${info.inputBgImage}`;
  assert(btnBg !== inputBg, `CTA bg identical to input: ${btnBg}`);
  const solidOrGlow = info.btnAlphaMax > 0.5 || (info.btnShadow !== "none" && info.btnShadow !== "");
  assert(
    solidOrGlow,
    `CTA lacks solid fill/glow: bg=${btnBg} alphaMax=${info.btnAlphaMax} shadow=${info.btnShadow}`
  );
  // 输入框 focus 高亮：描边或阴影相对静态有变化。
  assert(
    info.focusShadow !== "none" || info.focusBorder !== info.inputBorder,
    "input focus has no highlight (border/shadow unchanged)"
  );

  // 主 CTA 视觉重量不能弱于输入框（移动端第一眼误判的根因）：
  // 必须是实心底色（alpha>0.5）或带发光——旧版 0.2 透明渐变无 glow 在此 FAIL。
  assert(
    info.btnAlphaMax > 0.5 || info.btnShadow !== "none",
    `CTA weight too weak @${w}x${h}: alphaMax=${info.btnAlphaMax} shadow=${info.btnShadow}`
  );

  await page.screenshot({ path: shot });
  console.log(`    viewport ${w}x${h} OK → ${shot}`);
}

const pw = loadPW();
const browser = await pw.chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
try {
  // 移动端视口：探测样式 + 截图 + 真实点击建档。
  const ctx1 = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  const p1 = await ctx1.newPage();
  p1.setDefaultTimeout(20000);
  await probe(p1, 390, 844, "/tmp/fb-awaken-390.png");
  await p1.fill(".gate-form input", NAME);
  await p1.click(".gate-form button[type=submit]");
  await p1.waitForSelector(".status");
  const saveId = await p1.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "(b) click-through did not create a save");
  await ctx1.close();

  // 桌面视口：同款探测 + 截图。
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  const p2 = await ctx2.newPage();
  p2.setDefaultTimeout(20000);
  await probe(p2, 1440, 900, "/tmp/fb-awaken-1440.png");
  await ctx2.close();

  console.log("[ASSERT] awaken-cta-weight OK");
  await browser.close();
  process.exit(0);
} catch (e) {
  console.error(`[ASSERT] awaken-cta-weight FAIL: ${e.message}`);
  await browser.close().catch(() => {});
  process.exit(1);
}
