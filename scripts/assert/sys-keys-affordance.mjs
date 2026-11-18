#!/usr/bin/env node
// F212 系统键横滑暗示（390 窄屏）：
//   ① .btn-group-sys 确实需要横滑（scrollWidth > clientWidth + 40）；
//      首屏右缘 .sys-fade-r 为可测量元素（boundingBox.width > 0、
//      opacity > 0），左缘 .sys-fade-l 隐藏；
//   ② scrollLeft 滚到末端后右缘渐隐消失、左缘对称渐隐出现；
//      滚回起点恢复（状态由 .sys-scroll[data-at-start/at-end] 驱动）；
//   ③ 8 个系统键（背包/技能/属性/地图/任务/影子/战斗/存档）各自能被
//      滚进视口后由 elementFromPoint(中心) 命中自身或后代；
//   ④ 首屏 .sys-swipe-hint ≤1.5s 内出现、≤2.5s 内消失，出现期间矩形
//      不与 .actions-main 相交（不占行高）；
//   ⑤ 1440×900 桌面：无可见 .sys-fade，无 .sys-swipe-hint；
//   ⑥ .side-scroll 结构不变：开「技能」面板后存在且直接子元素 >0。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `e2e-sysaff-${Date.now().toString(36)}`;
const SYS_KEYS = ["背包", "技能", "属性", "地图", "任务", "影子", "战斗", "存档"];

async function fadeState(page) {
  return page.evaluate(() => {
    const out = {};
    for (const k of ["l", "r"]) {
      const el = document.querySelector(`.sys-fade-${k}`);
      if (!el) {
        out[k] = null;
        continue;
      }
      const r = el.getBoundingClientRect();
      out[k] = { w: r.width, op: parseFloat(getComputedStyle(el).opacity) };
    }
    return out;
  });
}

run(
  "sys-keys-affordance",
  async ({ page }) => {
    await createSave(page, NAME);

    // ── ④ 首屏一次性暗示：≤1.5s 内出现 ──
    await page.waitForSelector(".sys-swipe-hint", { timeout: 1500 }).catch(() => {
      throw new Error("首屏 1.5s 内未出现 .sys-swipe-hint 横滑暗示");
    });
    const hintBox = await page.locator(".sys-swipe-hint").boundingBox();
    const mainBox = await page.locator(".actions-main").boundingBox();
    assert(hintBox && mainBox, "sys-swipe-hint / actions-main boundingBox 可取");
    const overlap = !(
      hintBox.x + hintBox.width <= mainBox.x ||
      mainBox.x + mainBox.width <= hintBox.x ||
      hintBox.y + hintBox.height <= mainBox.y ||
      mainBox.y + mainBox.height <= hintBox.y
    );
    assert(
      !overlap,
      `.sys-swipe-hint 与 .actions-main 相交 hint=${JSON.stringify(hintBox)} main=${JSON.stringify(mainBox)}`
    );
    // ≤2.5s 内消失（淡出后布局零位移 → 节点卸载）
    await page.waitForSelector(".sys-swipe-hint", { state: "detached", timeout: 2500 }).catch(() => {
      throw new Error(".sys-swipe-hint 2.5s 内未消失");
    });

    // ── ① 需要横滑 + 首屏右缘渐隐可见、左缘隐藏 ──
    const dims = await page.locator(".btn-group-sys").evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }));
    assert(
      dims.sw > dims.cw + 40,
      `.btn-group-sys 不需要横滑 scrollWidth=${dims.sw} clientWidth=${dims.cw}`
    );
    let st = await fadeState(page);
    assert(st.r !== null, ".sys-fade-r 元素不存在（渐隐必须是可测量元素）");
    assert(st.r.w > 0, `.sys-fade-r 宽度=${st.r.w} 未 >0`);
    assert(st.r.op > 0, `首屏 .sys-fade-r opacity=${st.r.op}（应可见右缘渐隐）`);
    assert(st.l === null || st.l.w === 0 || st.l.op === 0, "首屏 .sys-fade-l 应隐藏（在滚动起点）");

    // ── ② 滚到末端：右缘隐、左缘现；滚回起点恢复 ──
    await page.locator(".btn-group-sys").evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForFunction(
      () => document.querySelector(".sys-scroll")?.dataset.atEnd === "true"
    );
    await page.waitForTimeout(300); // opacity 0.2s 过渡
    st = await fadeState(page);
    assert(
      st.r === null || st.r.w === 0 || st.r.op < 0.05,
      `滚到末端后 .sys-fade-r 仍可见 op=${st.r && st.r.op}`
    );
    assert(st.l !== null && st.l.w > 0 && st.l.op > 0.5, `滚到末端后 .sys-fade-l 不可见 ${JSON.stringify(st.l)}`);

    await page.locator(".btn-group-sys").evaluate((el) => {
      el.scrollLeft = 0;
    });
    await page.waitForFunction(
      () => document.querySelector(".sys-scroll")?.dataset.atStart === "true"
    );
    await page.waitForTimeout(300);
    st = await fadeState(page);
    assert(st.r !== null && st.r.w > 0 && st.r.op > 0.5, `滚回起点 .sys-fade-r 未恢复 ${JSON.stringify(st.r)}`);
    assert(st.l === null || st.l.w === 0 || st.l.op < 0.05, `滚回起点 .sys-fade-l 仍可见 ${JSON.stringify(st.l)}`);

    // ── ③ 8 键各自滚入视口后 elementFromPoint 命中自身/后代 ──
    for (const label of SYS_KEYS) {
      const btn = page.locator(".btn-group-sys > .btn", { hasText: label }).first();
      assert((await btn.count()) === 1, `系统键「${label}」不存在`);
      const res = await btn.evaluate((el) => {
        const sc = el.closest(".btn-group-sys");
        if (sc) {
          const r = el.getBoundingClientRect();
          const sr = sc.getBoundingClientRect();
          sc.scrollLeft += r.x + r.width / 2 - (sr.x + sr.width / 2);
        }
        const r2 = el.getBoundingClientRect();
        const cx = r2.x + r2.width / 2;
        const cy = r2.y + r2.height / 2;
        if (cx < -0.5 || cx > window.innerWidth + 0.5) {
          return { ok: false, why: `滚入后中心仍在视口外 cx=${cx.toFixed(1)}`, cx, cy };
        }
        const hit = document.elementFromPoint(cx, cy);
        return {
          ok: Boolean(hit) && (hit === el || el.contains(hit)),
          hit: hit ? hit.className || hit.tagName : "null",
          cx,
          cy,
        };
      });
      assert(
        res.ok,
        `「${label}」滚入后 elementFromPoint(${(res.cx || 0).toFixed(0)},${(res.cy || 0).toFixed(0)}) 命中 ${res.hit || res.why}`
      );
    }

    // ── ⑥ .side-scroll 结构不变 ──
    await page.locator(".btn-group-sys > .btn", { hasText: "技能" }).first().click();
    await page.waitForSelector(".sidebar.open");
    const sideKids = await page
      .locator(".sidebar .side-scroll")
      .evaluate((el) => el.children.length)
      .catch(() => -1);
    assert(sideKids > 0, `.sidebar .side-scroll 缺失或无直接子元素 (${sideKids})`);
    await page.locator(".side-close").click();

    // ── ⑤ 1440×900 桌面：无可见渐隐、无暗示 ──
    const browser = page.context().browser();
    const dctx = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "zh-CN",
    });
    try {
      const dp = await dctx.newPage();
      await createSave(dp, `${NAME}-d`);
      await dp.waitForTimeout(2200); // 覆盖暗示整个 1.8s 窗口
      assert(
        (await dp.locator(".sys-swipe-hint").count()) === 0,
        "1440 下渲染了 .sys-swipe-hint"
      );
      const visibleFades = await dp.evaluate(() => {
        return [...document.querySelectorAll(".sys-fade")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && parseFloat(getComputedStyle(el).opacity) > 0;
        }).length;
      });
      assert(visibleFades === 0, `1440 下存在 ${visibleFades} 个可见 .sys-fade`);
    } finally {
      await dctx.close();
    }
  },
  { viewport: { width: 390, height: 844 }, context: { hasTouch: true, isMobile: true } }
);
