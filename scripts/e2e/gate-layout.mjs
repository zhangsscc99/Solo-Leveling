#!/usr/bin/env node
// gate-layout.mjs (F268): 门牌页（觉醒页）输入框与「觉醒」按钮的
// 间距、按钮距面板内缘、输入框左内边距、两行 .gate-line 的主次、
// .gate-form 横向溢出——逐条量实测值：
//
//   1) input.right → .btn.primary.left 间距 ≥ 10px（指标 ≥8，建议 12；
//      旧码 gap:var(--sp-2)=8px → 红）
//   2) .btn.primary.right 距 .holo-inner 内容右内缘 ≥ 12px
//      （旧码按钮贴内容缘 ~0 → 红）
//   3) input padding-left ≥ 13px（指标 ≥10，建议 12–14；
//      旧码 padding:0 var(--sp-3)=12px → 红）
//   4) 两行 .gate-line 的 fontSize 或 fontWeight 不相等（铺垫 vs 指令；
//      行高/字号 ≥1.6）——旧码两行完全相同 → 红
//   5) 390×844 与 1440×900 下 .gate-form 无横向溢出
//      （scrollWidth <= clientWidth + 1）
import { assert, BASE_URL, run } from "./lib.mjs";

const EPS = 0.5; // 边框/亚像素舍入容差

function measure() {
  const input = document.querySelector(".gate-form input");
  const btn = document.querySelector(".gate-form .btn.primary");
  const inner = document.querySelector(".holo-inner");
  const form = document.querySelector(".gate-form");
  const ir = input.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const nr = inner.getBoundingClientRect();
  const innerPadR = parseFloat(getComputedStyle(inner).paddingRight);
  const padLeft = parseFloat(getComputedStyle(input).paddingLeft);
  const lines = [...document.querySelectorAll(".gate-body .gate-line")].map((el) => {
    const c = getComputedStyle(el);
    return {
      fontSize: parseFloat(c.fontSize),
      fontWeight: c.fontWeight,
      lhRatio: parseFloat(c.lineHeight) / parseFloat(c.fontSize),
    };
  });
  return {
    gap: br.left - ir.right,
    btnToInnerEdge: nr.right - innerPadR - br.right,
    padLeft,
    lines,
    formOverflow: form.scrollWidth - form.clientWidth,
  };
}

run(
  "gate-layout",
  async ({ page }) => {
    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".holo-gate");
    await page.waitForSelector(".gate-form input");

    const fails = [];
    const m390 = await page.evaluate(measure);
    console.log(
      `    [390] gap=${m390.gap.toFixed(2)} btnToInner=${m390.btnToInnerEdge.toFixed(2)} ` +
        `padLeft=${m390.padLeft} lines=${JSON.stringify(m390.lines)} ` +
        `formOverflow=${m390.formOverflow}`
    );

    if (!(m390.gap >= 10 - EPS))
      fails.push(`① 输入框→「觉醒」间距 ${m390.gap.toFixed(2)}px < 10px（期望 ≥10，建议 12）`);
    if (!(m390.btnToInnerEdge >= 12 - EPS))
      fails.push(
        `② 「觉醒」右缘距 .holo-inner 内容右内缘 ${m390.btnToInnerEdge.toFixed(2)}px < 12px`
      );
    if (!(m390.padLeft >= 13 - EPS))
      fails.push(`③ input padding-left ${m390.padLeft}px < 13px（期望 ≥10，建议 12–14）`);
    if (m390.lines.length < 2) {
      fails.push(`④ .gate-line 只有 ${m390.lines.length} 行`);
    } else {
      const [l1, l2] = m390.lines;
      if (l1.fontSize === l2.fontSize && l1.fontWeight === l2.fontWeight)
        fails.push(
          `④ 两行 .gate-line 字号字重完全相同（${l1.fontSize}px / w${l1.fontWeight}）——无主次`
        );
      for (const [i, l] of m390.lines.entries())
        if (!(l.lhRatio >= 1.6 - 0.01))
          fails.push(`④ 第 ${i + 1} 行 line-height/font-size=${l.lhRatio.toFixed(2)} < 1.6`);
    }
    if (!(m390.formOverflow <= 1))
      fails.push(`⑤ 390 下 .gate-form 横向溢出 scrollWidth-clientWidth=${m390.formOverflow}`);

    // 1440×900 只做溢出检查
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector(".gate-form input");
    const m1440 = await page.evaluate(measure);
    console.log(`    [1440] gap=${m1440.gap.toFixed(2)} formOverflow=${m1440.formOverflow}`);
    if (!(m1440.formOverflow <= 1))
      fails.push(`⑤ 1440 下 .gate-form 横向溢出 scrollWidth-clientWidth=${m1440.formOverflow}`);

    assert(fails.length === 0, "\n" + fails.map((f) => `    ${f}`).join("\n"));
  },
  { viewport: { width: 390, height: 844 } }
);
