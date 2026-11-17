#!/usr/bin/env node
// F177 灰置「休息」的可见原因（触屏无 hover，title 等于不存在）：
//   a) 新档首屏：休息按钮 disabled，.rest-hint 可见、文本 ≥4 字、
//      等于/包含服务端 save.rest.reason（新档口径含「俱满/无需休息」）；
//   b) 负向锁：压低 hp 使 rest.available=true 后 reload，.rest-hint
//      不存在或为空——证明它只在禁用态出现；
//   c) 交战口径：真实 save.combat 下 .rest-hint 不得残留；
//   d) 390×844 下 documentElement 无横向溢出。
// 变异敏感性：旧码只有 title=reason（无可见文本）→ a) 直接红。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { act, fetchSaveView, clearCombat } = await import("./_http.mjs");

const NAME = `e2e-f177-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

async function hintState(page) {
  const hint = page.locator(".rest-hint");
  const count = await hint.count();
  return { count, text: count ? (await hint.first().innerText()).trim() : "", visible: count ? await hint.first().isVisible() : false };
}

async function assertNoOverflow(page, tag) {
  const noHOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
  );
  assert(noHOverflow, `horizontal overflow @${tag}`);
}

// API 通道打遭遇：与 save-blocked-hint/combat-actions-ui 同口径——
// 冷却期「前进」磨 cd，否则「攻击」掷遭遇，直到 save.combat 真落库。
async function ensureEngaged(saveId, max = 40) {
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(saveId);
    if (s.combat) return s;
    await act(saveId, s.encounter_cd > 0 ? "前进" : "攻击");
  }
  assert(false, "never entered combat via API");
}

// 压低 hp 制造可休息态：进战先「防御」吃反击掉血，再清场脱战，
// 脱出后 hp<max_hp 时服务端 rest.available 即转 true。
async function makeRestAvailable(saveId, max = 6) {
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(saveId);
    if (!s.combat && s.rest && s.rest.available === true) return s;
    if (!s.combat) await ensureEngaged(saveId);
    for (let t = 0; t < 3; t++) {
      const { save: cur } = await fetchSaveView(saveId);
      if (!cur.combat) break;
      await act(saveId, "防御");
    }
    await clearCombat(saveId);
  }
  const { save: s } = await fetchSaveView(saveId);
  assert(s.rest && s.rest.available === true, `rest never became available: ${JSON.stringify(s.rest)}`);
  return s;
}

run(
  "rest-disabled-hint",
  async ({ page }) => {
    const saveId = await createSave(page, NAME).then(() =>
      page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
    );
    assert(saveId > 0, "save_id missing in localStorage");
    await settle(page);

    // ── a) 新档首屏：休息 disabled + .rest-hint 可见且透传服务端 reason ──
    const restBtn = page.locator('footer.actions button:has-text("休息")').first();
    assert((await restBtn.count()) === 1, "休息 button missing on fresh save");
    assert(await restBtn.isDisabled(), "休息 must be disabled on a full-vitals fresh save");
    const { save: fresh } = await fetchSaveView(saveId);
    assert(fresh.rest && fresh.rest.available === false && fresh.rest.reason,
      `fresh save rest not blocked: ${JSON.stringify(fresh.rest)}`);
    let h = await hintState(page);
    assert(h.count === 1 && h.visible, ".rest-hint missing or hidden while rest is disabled");
    assert(h.text.length >= 4, `.rest-hint text too short: "${h.text}"`);
    assert(/俱满|无需休息/.test(h.text), `.rest-hint missing fresh-save wording: "${h.text}"`);
    assert(
      h.text.includes(fresh.rest.reason),
      `.rest-hint "${h.text}" does not contain server reason "${fresh.rest.reason}"`
    );
    await assertNoOverflow(page, "1440x900-disabled");
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    h = await hintState(page);
    assert(h.count === 1 && h.visible && h.text.length >= 4, ".rest-hint missing @390x844");
    await assertNoOverflow(page, "390x844-disabled");

    // ── b) 负向锁：可休息状态下 .rest-hint 不存在或为空 ──
    await makeRestAvailable(saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page);
    h = await hintState(page);
    assert(h.count === 0 || h.text === "", `.rest-hint leaked into rest-available state: "${h.text}"`);

    // ── c) 交战口径：.rest-hint 不得残留 ──
    await ensureEngaged(saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page);
    h = await hintState(page);
    assert(h.count === 0, `.rest-hint残留于交战态: "${h.text}"`);
    await assertNoOverflow(page, "390x844-combat");
  },
  { viewport: { width: 1440, height: 900 }, context: { hasTouch: true, isMobile: true } }
);
