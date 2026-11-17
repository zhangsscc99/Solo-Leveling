#!/usr/bin/env node
// desktop-layout.mjs — F172 桌面版心断言。
//   1440×900：主列（.stage-col / .actions-main）boundingBox 中心与视口中心
//     水平差 ≤24px、宽度 ∈[760,1100]、文档无横向滚动、.key-badge 计算样式
//     opacity ≤0.55 且 font-size ≤11px（且角标盒完全落在按钮盒内）。
//   390×844：无横向滚动；行动栏四键 + 系统键八键 elementFromPoint 命中自身
//     （抽屉关闭态）。
// 任一断言失败 → 打印实测值并 exit 1；全过 → 逐条 PASS。
import { BASE_URL, assert, createSave, launch } from "./lib.mjs";

const NAME = `dl-${Date.now().toString(36)}`.slice(0, 20);
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

// 主列容器几何：返回 {x, w, center, leftGap, rightGap}
async function colBox(page, sel) {
  const box = await page.locator(sel).boundingBox();
  assert(box, `${sel} boundingBox 可取`);
  return {
    x: box.x,
    w: box.width,
    center: box.x + box.width / 2,
    right: box.x + box.width,
  };
}

async function hitTest(page, loc) {
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  assert(box, "按钮 boundingBox 可取");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  return loc.evaluate(
    (el, [x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return { ok: Boolean(hit) && el.contains(hit), hit: hit ? hit.className || hit.tagName : "null", x, y };
    },
    [cx, cy]
  );
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

  // ── 1440×900 桌面断言 ─────────────────────────────
  await check("1440 主列 .stage-col 居中且宽度在版心区间", async () => {
    const b = await colBox(page, ".stage-col");
    const off = Math.abs(b.center - VW / 2);
    const left = b.x;
    const right = VW - b.right;
    assert(off <= 24, `中心偏离视口 ${off.toFixed(1)}px (>24)`);
    assert(b.w >= 760 && b.w <= 1100, `宽度 ${b.w.toFixed(1)}px 不在 [760,1100]`);
    assert(Math.abs(left - right) <= 60, `左右留白差 ${Math.abs(left - right).toFixed(1)}px (>60)`);
    return `w=${b.w.toFixed(1)} center=${b.center.toFixed(1)} off=${off.toFixed(1)} 留白 ${left.toFixed(0)}/${right.toFixed(0)}`;
  });

  await check("1440 底栏 .actions-main 与主列同版心", async () => {
    const b = await colBox(page, ".actions-main");
    const off = Math.abs(b.center - VW / 2);
    assert(off <= 24, `中心偏离视口 ${off.toFixed(1)}px (>24)`);
    assert(b.w >= 760 && b.w <= 1100, `宽度 ${b.w.toFixed(1)}px 不在 [760,1100]`);
    return `w=${b.w.toFixed(1)} center=${b.center.toFixed(1)} off=${off.toFixed(1)}`;
  });

  await check("1440 无横向滚动", async () => {
    const d = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(d === 0, `scrollWidth-clientWidth=${d}`);
    return "scrollWidth-clientWidth=0";
  });

  await check("快捷键角标 .key-badge 低对比且不悬出按钮", async () => {
    const n = await page.locator(".btn .key-badge").count();
    assert(n > 0, "页面没有 .key-badge 角标元素");
    const st = await page.locator(".btn .key-badge").first().evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const p = el.parentElement.getBoundingClientRect();
      return {
        opacity: parseFloat(cs.opacity),
        fontSize: parseFloat(cs.fontSize),
        inside: r.top >= p.top - 0.5 && r.bottom <= p.bottom + 0.5 &&
                r.left >= p.left - 0.5 && r.right <= p.right + 0.5,
      };
    });
    assert(st.opacity <= 0.55, `opacity=${st.opacity} (>0.55)`);
    assert(st.fontSize <= 11, `font-size=${st.fontSize}px (>11)`);
    assert(st.inside, "角标盒悬出按钮盒外");
    return `n=${n} opacity=${st.opacity} fontSize=${st.fontSize}px inside=${st.inside}`;
  });

  // ── 390×844 移动断言（面板关闭态）─────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  await check("390 抽屉关闭（面板关闭态）", async () => {
    const open = await page.locator(".sidebar.open").count();
    assert(open === 0, `.sidebar.open 存在 (${open})`);
    return "closed";
  });

  await check("390 无横向滚动", async () => {
    const d = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(d === 0, `scrollWidth-clientWidth=${d}`);
    return "scrollWidth-clientWidth=0";
  });

  await check("390 行动栏四键可点（elementFromPoint 命中自身）", async () => {
    const btns = page.locator(".action-groups .btn-group:not(.btn-group-sys) > .btn");
    const n = await btns.count();
    assert(n === 4, `行动键数量=${n} (!=4)`);
    for (let i = 0; i < n; i++) {
      const h = await hitTest(page, btns.nth(i));
      const label = (await btns.nth(i).innerText()).trim().split("\n")[0];
      assert(h.ok, `「${label}」elementFromPoint(${h.x.toFixed(0)},${h.y.toFixed(0)}) 命中 ${h.hit}`);
    }
    return "4/4 hit self";
  });

  await check("390 系统键八键可点（elementFromPoint 命中自身）", async () => {
    const btns = page.locator(".action-groups .btn-group-sys > .btn");
    const n = await btns.count();
    assert(n === 8, `系统键数量=${n} (!=8)`);
    for (let i = 0; i < n; i++) {
      const h = await hitTest(page, btns.nth(i));
      const label = (await btns.nth(i).innerText()).trim().split("\n")[0];
      assert(h.ok, `「${label}」elementFromPoint(${h.x.toFixed(0)},${h.y.toFixed(0)}) 命中 ${h.hit}`);
    }
    return "8/8 hit self";
  });
} catch (e) {
  results.push(`FATAL ${e.message}`);
}

for (const r of results) console.log(`[DL] ${r}`);
const fails = results.filter((r) => r.startsWith("FAIL") || r.startsWith("FATAL"));
if (browser) await browser.close().catch(() => {});
console.log(
  `[E2E] desktop-layout ${fails.length ? "FAIL" : "PASS"} (${((Date.now() - t0) / 1000).toFixed(1)}s)` +
    (fails.length ? ` — ${fails.length} 项未过` : "")
);
process.exit(fails.length ? 1 : 0);
