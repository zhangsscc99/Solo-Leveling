#!/usr/bin/env node
// desktop-log-occlusion.mjs — F262 桌面端首屏正文末行被底部操作栏遮挡。
//   第55轮 walk-20261118T2255Z-d2.png（1440×900）：中央叙事区末行被
//   `.actions` 覆盖/裁切，读者读到一半断在栏下；同图「亮蓝主按钮与
//   浅色次按钮体量接近」主次竞争。
//
//   1440×900 干净档建档进第一章后断言：
//     ① 日志滚动到底后，最新 `.log-entry` 的 getBoundingClientRect().bottom
//        ≤ `.actions` 的 top + 1（不重叠；顺带打印首屏停顶态同一矩形，
//        供复现核对——旧码首屏 DOM 末条 bottom≈1063 > 栏顶≈687，
//        滚到底后若仍越出即「读到底仍被裁」）；
//     ② `.log`(=`.stage-col`) scrollHeight > clientHeight 时，必须存在
//        `[data-scroll-hint]` 元素，或底部 24px 内存在渐隐遮罩元素
//        （bottom 24px 带 linear-gradient 背景/mask 的节点）；
//     ③ 首屏唯一主行动（`.btn.cta-primary` / `[data-primary-cta]` /
//        `.btn-primary`）的 offsetHeight ≥ 次高可见按钮 offsetHeight + 8。
//   任一失败打印实际矩形数值；退出码即结论。
import { BASE_URL, assert, createSave, launch } from "./lib.mjs";

const NAME = `dlo-${Date.now().toString(36)}`.slice(0, 20);
const VW = 1440;
const VH = 900;

const results = [];
async function check(name, fn) {
  try {
    const got = await fn();
    results.push(`PASS ${name} — ${got}`);
  } catch (e) {
    results.push(`FAIL ${name} — ${e.message}`);
  }
}

const t0 = Date.now();
let browser = null;
try {
  browser = await launch();
  const ctx = await browser.newContext({
    viewport: { width: VW, height: VH },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await createSave(page, NAME);
  await page.waitForSelector(".actions-main .btn");
  // 首屏停顶态（F217：新档停在正文开头）先取样一次，再做滚动断言。
  await page.waitForTimeout(400);

  const probe = () =>
    page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const col = q(".stage-col");
      const actions = q(".actions");
      const colR = col.getBoundingClientRect();
      const aR = actions.getBoundingClientRect();
      const entries = [...document.querySelectorAll(".log-entry")];
      const last = entries[entries.length - 1];
      const lastR = last ? last.getBoundingClientRect() : null;
      // 首屏读者眼中的「最后一行」：顶缘仍在裁剪视口内的最低一条。
      const colCs = getComputedStyle(col);
      const clipBottom = colR.bottom - parseFloat(colCs.borderBottomWidth);
      let lowestVisible = null;
      for (const el of entries) {
        const r = el.getBoundingClientRect();
        if (r.top < clipBottom - 1 && (!lowestVisible || r.top > lowestVisible.top)) {
          lowestVisible = { top: r.top, bottom: r.bottom };
        }
      }
      return {
        clipBottom,
        actionsTop: aR.top,
        actionsBottom: aR.bottom,
        entries: entries.length,
        lastTop: lastR && lastR.top,
        lastBottom: lastR && lastR.bottom,
        lowestVisible,
        scrollTop: col.scrollTop,
        scrollH: col.scrollHeight,
        clientH: col.clientHeight,
        hint: Boolean(q("[data-scroll-hint]")),
      };
    });

  const first = await probe();
  console.log(
    `    [首屏] entries=${first.entries} scrollTop=${first.scrollTop} ` +
      `scrollH=${first.scrollH} clientH=${first.clientH} ` +
      `末条 bottom=${first.lastBottom?.toFixed(1)} ` +
      `最低可见条 bottom=${first.lowestVisible?.bottom.toFixed(1)} ` +
      `clip=${first.clipBottom.toFixed(1)} actionsTop=${first.actionsTop.toFixed(1)}`
  );

  // ②的 DOM 证据要在首屏停顶态取——提示到底后按设计卸载。
  const hintInfo = await page.evaluate(() => {
    const col = document.querySelector(".stage-col");
    const clipBottom = col.getBoundingClientRect().bottom;
    const hint = document.querySelector("[data-scroll-hint]");
    const fadeEl = [...document.querySelectorAll(".stage *")].find((el) => {
      // 容器自身的 mask 不算「元素」——要的是独立的渐隐/提示节点。
      if (el === col) return false;
      const r = el.getBoundingClientRect();
      if (r.height === 0) return false;
      // 与「裁剪缘向上 24px」条带相交的候选节点。
      if (r.bottom < clipBottom - 24 || r.top > clipBottom) return false;
      const cs = getComputedStyle(el);
      const g = (v) => typeof v === "string" && v.includes("gradient") && v !== "none";
      return g(cs.backgroundImage) || g(cs.maskImage) || g(cs.webkitMaskImage);
    });
    return {
      hasHint: Boolean(hint),
      hintRect: hint ? hint.getBoundingClientRect() : null,
      fadeCls: fadeEl ? String(fadeEl.className).slice(0, 60) : null,
      clipBottom,
    };
  });

  // 读者滚到底（「读到底仍被裁」的复现路径）。
  await page.evaluate(() => {
    const el = document.querySelector(".stage-col");
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(250);
  const bottom = await probe();
  console.log(
    `    [滚到底] scrollTop=${bottom.scrollTop} 末条 bottom=${bottom.lastBottom?.toFixed(1)} ` +
      `clip=${bottom.clipBottom.toFixed(1)} actionsTop=${bottom.actionsTop.toFixed(1)}`
  );

  // ── ① 最新 .log-entry 底边不得越进 .actions ─────────────
  await check("① 滚到底后最新 .log-entry 不被 .actions 覆盖", async () => {
    assert(bottom.lastBottom != null, "页面没有 .log-entry 元素");
    assert(
      bottom.lastBottom <= bottom.actionsTop + 1,
      `最新 .log-entry bottom=${bottom.lastBottom.toFixed(1)} > ` +
        `.actions top=${bottom.actionsTop.toFixed(1)} +1 ` +
        `（被底栏覆盖 ${(bottom.lastBottom - bottom.actionsTop).toFixed(1)}px；` +
        `scrollTop=${bottom.scrollTop} scrollH=${bottom.scrollH} clientH=${bottom.clientH}）`
    );
    return `last.bottom=${bottom.lastBottom.toFixed(1)} actions.top=${bottom.actionsTop.toFixed(1)}`;
  });

  // ── ② 可滚即须有滚动提示或底部渐隐遮罩元素 ──────────────
  await check("② 日志可滚时存在 [data-scroll-hint] 或底部渐隐遮罩元素", async () => {
    assert(
      first.scrollH > first.clientH,
      `.log 未溢出 scrollH=${first.scrollH} clientH=${first.clientH}（断言环境不成立）`
    );
    const info = hintInfo;
    assert(
      info.hasHint || info.fadeCls,
      `无 [data-scroll-hint]，底部 24px 内也无渐隐遮罩元素 ` +
        `（clipBottom=${info.clipBottom.toFixed(1)}）——读者无法察觉正文还能下滚`
    );
    return info.hasHint
      ? `data-scroll-hint bottom=${info.hintRect.bottom.toFixed(1)}`
      : `渐隐元素 .${info.fadeCls}`;
  });

  // ── ③ 唯一主行动体量压过次按钮 ─────────────────────────
  await check("③ 首屏唯一主按钮比次高可见按钮高 ≥8px", async () => {
    const m = await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")]
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top >= 0 && r.bottom <= innerHeight;
        })
        .map((b) => ({
          h: b.offsetHeight,
          t: (b.innerText || "").split("\n")[0].slice(0, 10),
          primary:
            b.matches(".btn-primary") ||
            b.matches(".cta-primary") ||
            b.getAttribute("data-primary-cta") === "1" ||
            b.getAttribute("data-primary") === "1",
        }));
      const primaries = btns.filter((b) => b.primary);
      const rest = btns.filter((b) => !b.primary).sort((a, b) => b.h - a.h);
      return { primaries, second: rest[0] || null, n: btns.length };
    });
    assert(m.primaries.length === 1, `主按钮数量=${m.primaries.length}（应唯一）`);
    assert(m.second, "没有可对比的次按钮");
    const p = m.primaries[0];
    assert(
      p.h >= m.second.h + 8,
      `主按钮「${p.t}」offsetHeight=${p.h} < 次高「${m.second.t}」${m.second.h} + 8 ` +
        `（主次体量无区分，与次按钮视觉竞争）`
    );
    return `primary=${p.h}px second=${m.second.h}px (${m.n} 颗可见)`;
  });
} catch (e) {
  results.push(`FATAL ${e.message}`);
}

for (const r of results) console.log(`[DLO] ${r}`);
const fails = results.filter((r) => r.startsWith("FAIL") || r.startsWith("FATAL"));
if (browser) await browser.close().catch(() => {});
console.log(
  `[E2E] desktop-log-occlusion ${fails.length ? "FAIL" : "PASS"} (${((Date.now() - t0) / 1000).toFixed(1)}s)` +
    (fails.length ? ` — ${fails.length} 项未过` : "")
);
process.exit(fails.length ? 1 : 0);
