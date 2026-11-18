#!/usr/bin/env node
// F222 续档一致性：打完一场真实战斗后刷新页面，.stage-col 直接子节点
// 数与最后 3 条文本必须与刷新前逐字一致——HP/MP/XP 都对，丢的是一条
// 只存在于内存态的日志行（F155/F163 抽屉展开回执、断线警报）。
//
//   a) UI 建档 → 自由输入逼出遭遇 → 点开「释放技能」抽屉（写入一条
//      仅内存态的系统回执行）→「攻击」打到战斗结束；
//   b) 记录 .stage-col 非豁免子节点数 + 最后 3 条文本；
//   c) page.reload()，localStorage 存档自动续上、日志回灌；
//   d) 断言条数相同、最后 3 条文本逐字相同。
//
// 豁免类别（显式列出，打印 exempt:）：.holo-ephemeral——仅内存态的
// 本地回执行（抽屉展开回执 / 断线警报），服务端不落库，刷新后按
// 设计消失；旧码没有该标记，回执行被计入 → 本断言 FAIL（根因存在）。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, assert, createSave } = await import("../e2e/lib.mjs");
const { fetchSaveView, mustChoosePick } = await import("./_http.mjs");

// 觉醒输入框 maxLength=20：名字必须带 Date.now().toString(36) 且 ≤20 字。
const NAME = `f222-${Date.now().toString(36)}`;
const EXEMPT = ".holo-ephemeral";
console.log(`exempt: ${EXEMPT}（仅内存态本地回执行——抽屉展开回执/断线警报，不落库）`);

// 豁免白名单（闭集）：豁免行只能是点名的几种回执，innerText 必须命中
// 该正则——class 是运行时可控的（见下方自检），仅靠 class 不够。
const EXEMPT_TEXT = /已调出(技能|道具)面板|【警报】与系统的连接中断/;
// 一次刷新前最多一条抽屉回执 + 一条断线警报。
const EXEMPT_MAX = 2;

// .stage-col 直接子节点中剔除豁免类后的 [数量, 文本列表, 豁免行文本列表]。
const snapshot = async (page) => {
  const [n, texts] = await page
    .locator(`.stage-col > :not(${EXEMPT})`)
    .evaluateAll((els) => [els.length, els.map((el) => el.innerText)]);
  const exemptTexts = await page
    .locator(`.stage-col > ${EXEMPT}`)
    .evaluateAll((els) => els.map((el) => el.innerText));
  return [n, texts, exemptTexts];
};

const assertExemptClosed = (exemptTexts) => {
  assert(
    exemptTexts.length <= EXEMPT_MAX,
    `exempt row count ${exemptTexts.length} > ${EXEMPT_MAX}: ${JSON.stringify(exemptTexts)}`
  );
  for (const t of exemptTexts) {
    assert(EXEMPT_TEXT.test(t), `exempt row out of whitelist: ${JSON.stringify(t)}`);
  }
};

async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

await run("reload-log-parity", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = Number(await page.evaluate(() => localStorage.getItem("solo_leveling_save_id")));
  assert(Number.isFinite(saveId) && saveId > 0, `save id unreadable: ${saveId}`);

  // ── a) 逼出真实遭遇：「攻击」空挥不耗冷却时循环「前进」磨遭遇 ──
  let engaged = false;
  for (let i = 0; i < 30 && !engaged; i++) {
    const r = await send(page, "攻击");
    if (r && r.save && r.save.combat) {
      engaged = true;
      break;
    }
    const s = r && r.save ? r.save : (await fetchSaveView(saveId)).save;
    const ra = await send(page, "前进");
    if (ra && ra.refused === true) {
      const pick = mustChoosePick((ra.save && ra.save.scene) || s.scene);
      if (pick) await send(page, `选择 ${pick.id}`);
    }
    if (ra && ra.save && ra.save.combat) engaged = true;
    await page.waitForTimeout(300);
  }
  assert(engaged, "never entered combat within 30 actions");

  // 写入一条仅内存态的抽屉回执行（豁免类别必须在刷新前真实存在）。
  const skillBtn = page
    .locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "释放技能" })
    .first();
  await skillBtn.click();
  await page.waitForSelector(".bar-skills");
  // 旧码无 .holo-ephemeral 标记（回执行不豁免、计入总数）——若点了
  // 「释放技能」后一条豁免行都没有，说明豁免类名空转，直接失败。
  const ephBefore = await page.locator(EXEMPT).count();
  assert(ephBefore > 0, "expected an ephemeral receipt after opening skill drawer");
  console.log(`[i] ephemeral rows before reload: ${ephBefore}`);

  // ── 打到战斗结束（阵亡/逃跑/击杀任一收场都算真实战斗）──
  let ended = false;
  for (let i = 0; i < 40 && !ended; i++) {
    const r = await send(page, "攻击");
    if (!r || !r.save || !r.save.combat) ended = true;
    await page.waitForTimeout(250);
  }
  assert(ended, "combat never ended within 40 attacks");
  await page.waitForSelector(".pending", { state: "detached" }).catch(() => {});
  await page.waitForTimeout(400);

  // ── 自检：holo-ephemeral 是运行时可控 class——给任意非豁免行动态
  // 加上该 class 后它会被当作豁免 → 白名单必须基于文本而非仅 class。
  {
    const marked = await page.evaluate((cls) => {
      const el = document.querySelector(`.stage-col > :not(.${cls})`);
      if (!el) return -1;
      el.classList.add(cls);
      const n = document.querySelectorAll(`.stage-col > .${cls}`).length;
      el.classList.remove(cls);
      return n;
    }, "holo-ephemeral");
    if (marked > ephBefore) console.log("[i] class is runtime-controllable: yes");
  }

  // ── b) 刷新前快照 ──
  const [n0, texts0, exempt0] = await snapshot(page);
  assert(n0 >= 4, `stage-col too short before reload (${n0})`);
  const tail0 = texts0.slice(-3);
  assertExemptClosed(exempt0);

  // ── c) 刷新续档 ──
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".stage-col > *");
  await page.waitForSelector(".pending", { state: "detached" }).catch(() => {});
  await page.waitForTimeout(500);

  // ── d) 刷新后断言 ──
  const [n1, texts1] = await snapshot(page);
  const tail1 = texts1.slice(-3);
  assert(
    n1 === n0,
    `.stage-col 非豁免子节点数刷新前后不一致：${n0} -> ${n1}` +
      `\n  before tail: ${JSON.stringify(tail0)}\n  after  tail: ${JSON.stringify(tail1)}`
  );
  assert(
    JSON.stringify(tail1) === JSON.stringify(tail0),
    `最后 3 条文本不一致：\n  before: ${JSON.stringify(tail0)}\n  after : ${JSON.stringify(tail1)}`
  );
  console.log(`[OK] reload parity: ${n0} nodes, last3 identical (ephemeral rows before=${ephBefore})`);
});
