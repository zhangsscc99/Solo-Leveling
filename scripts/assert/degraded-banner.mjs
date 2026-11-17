#!/usr/bin/env node
// F118 AI 降级提示契约（UI，第二版——降级提示不做长期噪音）：
//   /ai-action 回包 degraded:true 时——
//   (a) 尾注只盖在本会话第一条降级气泡尾部，第二条起不再追加；
//   (b) 状态栏浮现一次性细条「叙事引擎：规则模式（AI 暂不可用）· 点 ×
//       收起」，× 收起后本会话不再出现（再降级也不复发）；
//   (c) 从未访问 /ai-action 的新档不得出现横幅/尾注；
//   (d) 390px 下横幅单行不换行、不遮输入框与行动按钮、页面无横向
//       溢出（scrollWidth === clientWidth），全程无 console error。
//
//   自由输入框发自然语言长句 → 客户端分流 /ai-action；本环境无 AI key，
//   网关恒降级，回包必带 degraded:true。
//
//   E2E_BASE_URL 指向隔离实例（默认 https://openfolio.uk/game）。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `F118-${Date.now().toString(36)}`;
const NAME2 = `F118b-${Date.now().toString(36)}`;
// 必须避开指令信号词（攻击/前进/观察/数字等），否则会分流去 /action。
const SENTENCES = [
  "我蹲下身，捡起地上一枚发烫的碎片",
  "我抬头望向通道尽头，仔细听远处的动静",
  "我把碎片收进口袋，贴着墙根慢慢挪动脚步",
];

// 发一句自然语言长句并等回包落到日志（busy 态解除）。
async function sendSentence(page, sentence) {
  await page.fill(".input-row input", sentence);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/ai-action") && r.request().method() === "POST"
    ),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  const body = await resp.json().catch(() => null);
  assert(body && body.degraded === true, `/ai-action 回包未带 degraded:true：${JSON.stringify(body).slice(0, 200)}`);
  await page.waitForFunction(() => !document.querySelector(".pending"));
}

const noOverflow = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth === document.documentElement.clientWidth
  );

run(
  "degraded-banner",
  async ({ page }) => {
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrs.push(String(e)));

    await createSave(page, NAME);
    await page.waitForSelector(".input-row input");

    // ── 第一句降级长句：首条气泡带尾注 + 一次性细条出现 ──
    await sendSentence(page, SENTENCES[0]);

    await page.waitForSelector(".degraded-note", { timeout: 8000 });
    assert(
      (await page.locator(".degraded-note").count()) === 1,
      "(a) 首条降级气泡尾注数量异常"
    );
    const note = await page.locator(".degraded-note").last().innerText();
    assert(
      note.includes("系统叙事降级：按规则解析"),
      `(a) 尾注文案不符：${note}`
    );

    const banner = page.locator(".degraded-banner");
    assert((await banner.count()) === 1, "(b) 一次性降级细条未出现");
    const bannerText = (await banner.innerText()).trim();
    assert(
      bannerText.includes("规则模式"),
      `(b) 细条文案不符：${bannerText}`
    );
    assert(await banner.isVisible(), "(b) 降级细条不可见");

    // 不挡输入框与行动按钮：细条整体在输入行上方（几何不重叠）。
    const bb = await banner.boundingBox();
    const ib = await page.locator(".input-row input").boundingBox();
    const ab = await page
      .locator(".actions-main .btn", { hasText: "探索前进" })
      .first()
      .boundingBox();
    assert(bb && ib && ab, "(b) 无法读取细条/输入框/按钮几何");
    assert(
      bb.y + bb.height <= ib.y && bb.y + bb.height <= ab.y,
      `(b) 细条与输入行/行动按钮重叠：banner y=${bb.y}+${bb.height}, input y=${ib.y}, action y=${ab.y}`
    );
    assert(
      await page.locator(".input-row input").isEnabled(),
      "(b) 降级后输入框不可用"
    );

    // 390px：细条单行、页面无横向溢出。
    assert(await noOverflow(page), "(d) 390px 下出现横向溢出");
    const bannerLines = await banner.evaluate(
      (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    );
    assert(bannerLines <= 1, `(d) 390px 下细条折成 ${bannerLines} 行`);

    // ── 第二句降级长句：不再追加尾注 ──
    await sendSentence(page, SENTENCES[1]);
    assert(
      (await page.locator(".degraded-note").count()) === 1,
      "(a) 第二条降级回包仍追加尾注"
    );
    assert(await noOverflow(page), "(d) 第二句后出现横向溢出");

    // ── × 收起：细条消失且本会话不复发 ──
    await page.click(".degraded-banner-close");
    assert(
      (await page.locator(".degraded-banner").count()) === 0,
      "(b) × 收起后细条仍存在"
    );
    await sendSentence(page, SENTENCES[2]);
    assert(
      (await page.locator(".degraded-banner").count()) === 0,
      "(b) 收起后再降级细条复发"
    );
    assert(await noOverflow(page), "(d) 收起后出现横向溢出");

    // ── 刷新：会话态重置，页面正常不报错 ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");

    // ── (c) 从未访问 /ai-action 的新档：横幅/尾注都不存在 ──
    await page.evaluate(() => localStorage.clear());
    await createSave(page, NAME2);
    await page.waitForSelector(".input-row input");
    const body2 = await page.locator("body").innerText();
    assert(
      !body2.includes("规则模式") && !body2.includes("系统叙事降级"),
      "(c) 未降级的新档出现降级文案"
    );
    assert(
      (await page.locator(".degraded-banner, .degraded-note").count()) === 0,
      "(c) 未降级的新档渲染了 .degraded-banner/.degraded-note"
    );
    assert(await noOverflow(page), "(d) 新档出现横向溢出");

    assert(consoleErrs.length === 0, `console error: ${consoleErrs.join(" | ")}`);
    console.log(`    降级提示：首条尾注+一次性细条，× 收起不复发，新档干净`);
  },
  { viewport: { width: 390, height: 844 } }
);
