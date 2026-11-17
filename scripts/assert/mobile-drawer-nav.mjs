#!/usr/bin/env node
// F192 移动端抽屉内面板切换：
//   390×844 新档 →「档案」开抽屉：
//   a) aside.sidebar.open 存在、.side-nav button 数量 ≥4；所有导航键
//      getBoundingClientRect() 落在视口内且 elementFromPoint 命中自身
//      （不被 .side-scroll 或遮罩盖住）；
//   b) 点「技能」→ 抽屉仍开、.side-scroll 文本含「猛虎猛击」或「技能」；
//   c) 点「任务」→ .side-scroll 文本含「每日任务」；
//      点「属性」→ .side-scroll 文本含「力量」或「属性点」；
//   d) documentElement 无横向溢出（scrollWidth - clientWidth === 0）；
//   e) 点 .side-close → aside.sidebar.open 为 null。
// 变异敏感性：旧码抽屉内无 .side-nav → a) 计数断言即红。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `R32f192-${Date.now().toString(36)}`.slice(0, 20);
const VW = 390;
const VH = 844;
const settle = (page, ms = 450) => page.waitForTimeout(ms);
const scrollText = (page) => page.locator(".side-scroll").innerText();

run(
  "mobile-drawer-nav",
  async ({ page }) => {
    await createSave(page, NAME);
    await settle(page, 700);

    // ── 点「档案」开抽屉 ──
    await page.locator(".drawer-toggle").click();
    await page.waitForSelector("aside.sidebar.open");
    await settle(page, 400);

    // ── a) .side-nav 存在且所有导航键在视口内、命中自身 ──
    const navBtns = page.locator(".side-nav button");
    const n = await navBtns.count();
    assert(n >= 4, `.side-nav button 数量=${n} (<4)`);
    for (let i = 0; i < n; i++) {
      const b = navBtns.nth(i);
      const label = (await b.innerText()).trim();
      const geo = await b.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          rect: { x: r.x, y: r.y, w: r.width, h: r.height },
          ok: Boolean(hit) && (hit === el || el.contains(hit)),
          hitCls: hit ? hit.className || hit.tagName : "null",
        };
      });
      assert(
        geo.rect.x >= -0.5 &&
          geo.rect.y >= -0.5 &&
          geo.rect.x + geo.rect.w <= VW + 0.5 &&
          geo.rect.y + geo.rect.h <= VH + 0.5,
        `导航键「${label}」矩形越出视口 ${JSON.stringify(geo.rect)}`
      );
      assert(
        geo.rect.h >= 40,
        `导航键「${label}」触控高度 ${geo.rect.h}px <40`
      );
      assert(
        geo.ok,
        `导航键「${label}」elementFromPoint 命中 ${geo.hitCls}（被遮挡）`
      );
    }

    // ── b) 「技能」：抽屉不关、内容换成技能面板 ──
    await page.locator('.side-nav button:has-text("技能")').click();
    await settle(page, 500);
    assert(
      (await page.locator("aside.sidebar.open").count()) === 1,
      "点「技能」后抽屉被关闭"
    );
    const t1 = await scrollText(page);
    assert(
      t1.includes("猛虎猛击") || t1.includes("技能"),
      `技能面板文本缺关键词："${t1.slice(0, 120)}"`
    );

    // ── c) 「任务」→ 每日任务；「属性」→ 力量/属性点 ──
    await page.locator('.side-nav button:has-text("任务")').click();
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector(".side-scroll");
          return Boolean(el) && el.innerText.includes("每日任务");
        },
        null,
        { timeout: 10000 }
      )
      .catch(() => {});
    const t2 = await scrollText(page);
    assert(
      (await page.locator("aside.sidebar.open").count()) === 1 &&
        t2.includes("每日任务"),
      `任务面板文本缺「每日任务」："${t2.slice(0, 120)}"`
    );

    await page.locator('.side-nav button:has-text("属性")').click();
    await settle(page, 400);
    const t3 = await scrollText(page);
    assert(
      t3.includes("力量") || t3.includes("属性点"),
      `属性面板文本缺关键词："${t3.slice(0, 120)}"`
    );

    // ── d) 无横向溢出 ──
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(overflow === 0, `横向溢出 scrollWidth-clientWidth=${overflow}`);

    // ── e) × 关抽屉 ──
    await page.locator(".side-close").click();
    await page.waitForFunction(() => !document.querySelector("aside.sidebar.open"));
    assert(
      (await page.locator("aside.sidebar.open").count()) === 0,
      "点 × 后 aside.sidebar.open 仍存在"
    );
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
