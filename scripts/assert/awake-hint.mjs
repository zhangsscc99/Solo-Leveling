#!/usr/bin/env node
// F199 觉醒页空代号提示（第35轮走查 P1）：
//
//   干净上下文进 /game：代号输入为空时「觉醒」按钮 disabled，但页面上
//   没有任何一行字说明原因，玩家当成死键。契约：
//
//   (a) 代号为空 → 「觉醒」submit 键 disabled 为 true（契约保持，不得
//       为了「能点」放开空代号提交）；且觉醒窗可见文本含「代号」并命中
//       提示语 /先.*代号|登记.*代号/（.gate-hint 存在且可见）；
//   (b) 填入代号（R35hint<ts>）→ .gate-hint 消失、觉醒窗文本不再含
//       「再按「觉醒」」提示语，submit 键 enabled；
//   (c) 390×844 与 1440×900 两个干净上下文各跑一遍，均无横向溢出。
//
//   端点默认 https://openfolio.uk/game，可用 SL_E2E_BASE（或
//   E2E_BASE_URL）覆盖到本 worktree 的隔离实例：
//     PORT=3199 DB_PATH=/tmp/sl-f199.db node server/index.js &
//     SL_E2E_BASE=http://127.0.0.1:3199/game node scripts/assert/awake-hint.mjs
//
//   旧码红证：旧码空代号时 .gate-hint 不存在、觉醒窗可见文本不含
//   提示语 → (a) 第一枪就 FAIL。
const BASE = (
  process.env.SL_E2E_BASE ||
  process.env.E2E_BASE_URL ||
  "https://openfolio.uk/game"
).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, assert } = await import("../e2e/lib.mjs");

const NAME = `R35hint${Date.now().toString(36)}`.slice(0, 20);
const HINT_RE = /先.*代号|登记.*代号/;

async function check(page, tag) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");
  await page.waitForTimeout(400);

  // ── a) 空代号：键 disabled + 就地提示可见 ──
  const btn = page.locator(".gate-form button[type=submit]");
  assert(await btn.isDisabled(), `空代号时「觉醒」键未 disabled @${tag}`);
  const hint = page.locator(".gate-hint");
  assert((await hint.count()) === 1, `.gate-hint 缺失（count=${await hint.count()}）@${tag}`);
  assert(await hint.isVisible(), `.gate-hint 不可见 @${tag}`);
  const gateText = await page.locator(".holo-gate").innerText();
  assert(gateText.includes("代号"), `觉醒窗可见文本不含「代号」@${tag}: "${gateText.slice(0, 160)}"`);
  assert(
    HINT_RE.test(gateText),
    `觉醒窗可见文本不含提示语 ${HINT_RE} @${tag}: "${gateText.slice(0, 160)}"`
  );

  // ── b) 填入代号：提示消失、键 enabled ──
  await page.fill(".gate-form input", NAME);
  await page.waitForTimeout(300);
  assert(
    (await page.locator(".gate-hint").count()) === 0,
    `填入代号后 .gate-hint 仍存在 @${tag}`
  );
  const gateText2 = await page.locator(".holo-gate").innerText();
  assert(
    !gateText2.includes("先登记一个猎人代号"),
    `填入代号后提示语仍在 @${tag}: "${gateText2.slice(0, 160)}"`
  );
  assert(!(await btn.isDisabled()), `填入代号后「觉醒」键仍 disabled @${tag}`);

  // ── c) 无横向溢出 ──
  const noHOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  assert(noHOverflow, `横向溢出 @${tag}`);

  try {
    const fs = await import("node:fs");
    fs.mkdirSync("/root/logs", { recursive: true });
    await page.screenshot({ path: `/root/logs/awake-hint-${tag}.png` });
  } catch {}
}

run("awake-hint", async ({ page, ctx }) => {
  // 1440×900：run() 的默认视口上下文（干净，无 localStorage 存档）
  await check(page, "1440x900");

  // 390×844：另起一个干净上下文（不带上一视口的 localStorage/输入态）
  const browser = ctx.browser();
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
    hasTouch: true,
    isMobile: true,
  });
  try {
    const p2 = await ctx2.newPage();
    p2.setDefaultTimeout(20000);
    await check(p2, "390x844");
  } finally {
    await ctx2.close().catch(() => {});
  }
});
