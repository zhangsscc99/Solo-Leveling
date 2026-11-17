#!/usr/bin/env node
// F160 交战中「存档」死键的就地说明：
//   a) 脱战态：footer 不出现「交战中无法写入存档」文案（count == 0）；
//   b) 交战态（API 打出遭遇后 reload 回灌真实 save.combat）：
//      footer 常驻可见文本含「交战中无法写入存档」且含「逃跑」或「打赢」，
//      存档按钮仍 disabled（不破 combat-actions-ui 的 isDisabled 口径）；
//      1440×900 与 390×844 两个视口下 documentElement 均无横向溢出。
// 变异敏感性：旧码只有 title="交战中无法存档"（无可见文本）→ 文案断言红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { act, fetchSaveView } = await import("./_http.mjs");

const NAME = `e2e-f160-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// API 通道打遭遇：与 combat-actions-ui 同口径——冷却期「前进」磨 cd，
// 否则「攻击」掷遭遇，直到 save.combat 真落库。
async function ensureEngaged(saveId, max = 40) {
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(saveId);
    if (s.combat) return s;
    await act(saveId, s.encounter_cd > 0 ? "前进" : "攻击");
  }
  assert(false, "never entered combat via API");
}

async function checkViewport(page, tag) {
  const hint = page.locator(".save-blocked-hint");
  assert((await hint.count()) === 1, `hint element missing @${tag}`);
  assert(await hint.isVisible(), `hint not visible @${tag}`);
  const foot = await page.locator("footer.actions").innerText();
  assert(foot.includes("交战中无法写入存档"), `footer missing blocked copy @${tag}: "${foot.slice(0, 200)}"`);
  assert(/逃跑|打赢/.test(foot), `footer missing escape/win pointer @${tag}`);
  const saveBtn = page.locator(".btn-group-sys .btn", { hasText: "存档" }).first();
  assert(await saveBtn.isDisabled(), `存档 button must stay disabled in combat @${tag}`);
  const noHOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  assert(noHOverflow, `horizontal overflow @${tag}`);
}

run("save-blocked-hint", async ({ page }) => {
  const saveId = await createSave(page, NAME).then(() =>
    page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // ── a) 脱战：提示不存在（count == 0），不占位 ──
  assert(
    (await page.locator(".save-blocked-hint").count()) === 0,
    "save-blocked hint rendered out of combat"
  );
  const footIdle = await page.locator("footer.actions").innerText();
  assert(
    !footIdle.includes("交战中无法写入存档"),
    `footer carries blocked copy out of combat: "${footIdle.slice(0, 200)}"`
  );

  // ── b) 打出真实交战态 → reload 回灌 → 提示常驻可见 ──
  await ensureEngaged(saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".save-blocked-hint");
  await settle(page);

  await checkViewport(page, "1440x900");
  await page.setViewportSize({ width: 390, height: 844 });
  await settle(page, 500);
  await checkViewport(page, "390x844");
});
