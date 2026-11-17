#!/usr/bin/env node
// F201 动作后「已记录」微提示（第35+轮走查 P1 复诉）：
//
//   每次 /action 成功回包都已落库（刷新后逐项保留），但此前只有手动
//   「存档」有完成播报，玩家刷新前怀疑进度白打。契约：
//
//   (a) 新档点一次「探索前进」（非交战回包）：顶栏下缘 .save-hint 出现，
//       文案命中 /已记录|已自动记录|已保存/，且 2.5s 内该元素消失；
//   (b) 真实交战态发一次「攻击」（回包仍 save.combat）：同位提示存在，
//       文案为「交战结束后可写入」口径——不得含「已写入存档」、不得
//       命中成功写入语（/已写入|已保存|已记录|成功/）；
//   (c) 390×844 与 1440×900 各跑一遍：documentElement 无横向溢出；
//       提示出现前后 document.body.innerText 剔除提示行后逐行一致
//       （不新增正文行）；.save-hint 与 .status-nums 矩形不相交
//       （不遮挡顶栏数值）。
//
//   端点默认线上，可用 SL_E2E_BASE / E2E_BASE_URL 覆盖到隔离实例：
//     PORT=3198 DB_PATH=/tmp/sl-f201.db node server/index.js &
//     E2E_BASE_URL=http://127.0.0.1:3198/game node scripts/assert/autosave-hint.mjs
//
//   旧码红证：旧码无 .save-hint 元素 → (a) waitForSelector 超时就 FAIL。
const BASE = (
  process.env.SL_E2E_BASE ||
  process.env.E2E_BASE_URL ||
  "https://openfolio.uk/game"
).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, assert, createSave } = await import("../e2e/lib.mjs");
const { fetchSaveView } = await import("./_http.mjs");

const NAME = `f201hint${Date.now().toString(36)}`.slice(0, 20);
const SUCCESS_RE = /已记录|已自动记录|已保存/;
const HINT_LINE_RE = /已记录|已自动记录|已保存|交战结束后可写入/;
const LIE_RE = /已写入|已保存|已记录|成功/;

const saveId = async (page) =>
  Number(await page.evaluate(() => localStorage.getItem("solo_leveling_save_id")));

// 点「探索前进」并拿回 /action 回包 JSON。
async function clickAdvance(page) {
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/action") && r.request().method() === "POST"
    ),
    page
      .locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "探索前进" })
      .first()
      .click(),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 自由输入发指令并拿回回包（交战态探索组让位给五键，走输入框口径一致）。
async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/action") && r.request().method() === "POST"
    ),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 打出一发「非交战」成功动作：若「前进」触发遭遇就先「逃跑」脱身再来，
// 返回该次非交战回包。
async function peacefulAction(page, id) {
  for (let i = 0; i < 8; i++) {
    const r = await clickAdvance(page);
    if (r && r.save && !r.save.combat) return r;
    // 被遭遇咬住：逃跑脱身（50% 掷逃，失败白挨一回合）。
    for (let j = 0; j < 12; j++) {
      const s = (await fetchSaveView(id)).save;
      if (!s.combat) break;
      await send(page, "逃跑");
      await page.waitForTimeout(250);
    }
  }
  assert(false, "8 次「探索前进」均被遭遇打断，拿不到非交战回包");
}

async function check(page, tag) {
  await createSave(page, `${NAME}${tag === "390x844" ? "m" : "d"}`.slice(0, 20));
  const id = await saveId(page);
  assert(id > 0, `localStorage 未写入 save id @${tag}`);

  // ── (a)+(c) 非交战动作：提示出现/淡出 + 布局零扰动 ─────────────
  const r = await peacefulAction(page, id);
  assert(r && r.save && !r.save.combat, `回包非预期交战态 @${tag}`);

  await page.waitForSelector(".save-hint", { state: "visible", timeout: 3000 });
  const hintText = (await page.locator(".save-hint").innerText()).trim();
  assert(
    SUCCESS_RE.test(hintText),
    `非交战动作提示未命中 ${SUCCESS_RE} @${tag}: "${hintText}"`
  );

  // 提示不遮顶栏数值：两矩形不相交。
  const overlap = await page.evaluate(() => {
    const a = document.querySelector(".save-hint").getBoundingClientRect();
    const b = document.querySelector(".status-nums").getBoundingClientRect();
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  assert(!overlap, `.save-hint 与 .status-nums 矩形相交 @${tag}`);

  // 提示期间 body 文本（动作回包已落地，日志行稳定）。
  const linesDuring = (await page.evaluate(() => document.body.innerText))
    .split("\n")
    .filter((l) => !HINT_LINE_RE.test(l));

  // 无横向溢出。
  const noHOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  assert(noHOverflow, `横向溢出 @${tag}`);

  // 2.5s 内消失（1.8s 淡出 + 2s 计时卸载）。
  await page.waitForSelector(".save-hint", { state: "detached", timeout: 2500 });

  // 提示卸载后行结构与提示期间一致（提示不占正文行、卸载不留痕）。
  const linesAfter = (await page.evaluate(() => document.body.innerText))
    .split("\n")
    .filter((l) => !HINT_LINE_RE.test(l));
  assert(
    JSON.stringify(linesDuring) === JSON.stringify(linesAfter),
    `提示出现/卸载前后正文行结构变化 @${tag}`
  );

  // ── (b) 交战态：提示不得谎称已写入 ─────────────────────────────
  let engaged = false;
  for (let i = 0; i < 24 && !engaged; i++) {
    const s = (await fetchSaveView(id)).save;
    if (s.combat) {
      engaged = true;
      break;
    }
    await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
    await page.waitForTimeout(300);
    // 逃跑掷脱/被杀都可能让 UI 与服务端错位，以服务端口径为准。
    engaged = Boolean((await fetchSaveView(id)).save.combat);
  }
  assert(engaged, `24 次动作未能进入交战态 @${tag}`);

  // 发一发仍处交战的「攻击」（击杀脱战则重进再战，最多 6 次）。
  let gotCombatHint = false;
  for (let i = 0; i < 6 && !gotCombatHint; i++) {
    const r2 = await send(page, "攻击");
    if (r2 && r2.save && r2.save.combat) {
      await page.waitForSelector(".save-hint", { state: "visible", timeout: 3000 });
      const t = (await page.locator(".save-hint").innerText()).trim();
      assert(!t.includes("已写入存档"), `交战态提示谎称「已写入存档」@${tag}: "${t}"`);
      assert(
        !LIE_RE.test(t),
        `交战态提示声称写入成功 ${LIE_RE} @${tag}: "${t}"`
      );
      assert(
        /交战结束后可写入/.test(t),
        `交战态提示应为「交战结束后可写入」口径 @${tag}: "${t}"`
      );
      gotCombatHint = true;
    } else {
      // 这发把怪打死了（提示此时按脱战「已记录」正确显示）——重进再战。
      for (let j = 0; j < 24 && !(await fetchSaveView(id)).save.combat; j++) {
        const s = (await fetchSaveView(id)).save;
        await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
        await page.waitForTimeout(300);
      }
    }
  }
  assert(gotCombatHint, `6 次尝试未拿到「仍交战」的攻击回包 @${tag}`);

  try {
    const fs = await import("node:fs");
    fs.mkdirSync("/root/logs", { recursive: true });
    await page.screenshot({ path: `/root/logs/autosave-hint-${tag}.png` });
  } catch {}
}

run("autosave-hint", async ({ page, ctx }) => {
  // 1440×900：run() 默认视口上下文（干净，无 localStorage 存档）
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
