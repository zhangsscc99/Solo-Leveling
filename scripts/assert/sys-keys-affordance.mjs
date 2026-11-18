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

    // ── ④ F255 契约：系统组折行平铺，全部键落在视口内、无横滑无渐隐 ──
    //   第 53 轮走查把「横滑 meta 行」本身判成 P0 缺陷：390 下 8 键排到
    //   ~520px，地图只露 15px、任务/影子/战斗/存档整条在视口外，真实手指
    //   按不到（横滑容器还会把微位移判成滚动手势吞掉 click）。故本条断言
    //   由「必须可横滑 + 渐隐提示」翻转为「不许横滑、8 键全在视口内」。
    const dims = await page.locator(".btn-group-sys").evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }));
    assert(
      dims.sw <= dims.cw + 2,
      `.btn-group-sys 仍在横滑：scrollWidth=${dims.sw} clientWidth=${dims.cw}（F255：横滑容器会让视口外的键按不到）`
    );
    const visibleFades = await page.evaluate(
      () =>
        [...document.querySelectorAll(".sys-fade")].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && parseFloat(getComputedStyle(el).opacity) > 0;
        }).length
    );
    assert(visibleFades === 0, `390 下仍存在 ${visibleFades} 个可见 .sys-fade（横滑终止后无渐隐可言）`);
    assert(
      (await page.locator(".sys-swipe-hint").count()) === 0,
      "390 下仍渲染 .sys-swipe-hint（F255 已停用横滑暗示）"
    );

    // ── ③ 8 键各自完整落在视口内，elementFromPoint(中心) 命中自身/后代 ──
    for (const label of SYS_KEYS) {
      const btn = page.locator(".btn-group-sys > .btn", { hasText: label }).first();
      assert((await btn.count()) === 1, `系统键「${label}」不存在`);
      const res = await btn.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        if (r.x < -0.5 || r.right > window.innerWidth + 0.5) {
          return { ok: false, why: `键面越出视口 x=${r.x.toFixed(1)}..${r.right.toFixed(1)}`, cx, cy };
        }
        if (r.height < 40) return { ok: false, why: `触控高度 ${r.height.toFixed(1)}px < 40px`, cx, cy };
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
        `「${label}」未落在视口内或命中被挡：${res.why || `elementFromPoint(${(res.cx || 0).toFixed(0)},${(res.cy || 0).toFixed(0)}) 命中 ${res.hit}`}`
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
