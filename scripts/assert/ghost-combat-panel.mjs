#!/usr/bin/env node
// F141 幽灵战斗面板：帮助指令表文本不得被当成交战信号。
//   (a) 新档打完一场仗 → 自由输入「帮助」→ 刷新页面 →
//       战斗面板不得自动顶开（旧代码：指令表行「遭遇战中：「攻击」…」被
//       ENEMY_RE 把「战中：」抓成敌人名、旧回合行命中 TURN_RE →
//       gate=engage → 刷新后顶开「交战 第N回合」幽灵面板）。
//   (b) 同档真交战（save.combat 非空）时刷新 → 面板仍自动展开且显示
//       真实敌名与回合数——服务端结构字段是第一信号，防假绿反向断言。
// 变异敏感性：旧代码在 (a) 步 section.combat 必挂载且标题为「交战」→ 红。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { fetchSaveView } = await import("./_http.mjs");

const NAME = `e2e-f141-${Date.now().toString(36)}`;

// 自由行动输入框发指令，等 /action 回包完整落地并返回响应 JSON。
async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 逼出遭遇并返回交战态 save；击杀冷却期先「前进」磨掉再「攻击」。
async function ensureEngaged(page, saveId) {
  for (let i = 0; i < 25; i++) {
    const s = (await fetchSaveView(saveId)).save;
    if (s.combat) return s;
    const r = await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
    if (r && r.save && r.save.combat) return r.save;
  }
  assert(false, "never engaged within 25 actions");
}

run("ghost-combat-panel", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");
  await page.waitForSelector(".input-row input");

  // ── (a) 打完一场仗 →「帮助」→ 刷新 → 不得出现幽灵「交战」面板 ──
  let s = await ensureEngaged(page, saveId);
  // 完整打完：「攻击」到 save.combat 清空（击败/倒下/回溯皆收束，
  // 日志里留下整段真实战报供刷新后回扫）。
  for (let i = 0; i < 60 && s.combat; i++) {
    const r = await send(page, "攻击");
    s = r && r.save ? r.save : s;
  }
  assert(!s.combat, "battle never ended within 60 attack actions");
  const help = await send(page, "帮助");
  assert(
    help && /可用指令|遭遇战中/.test((help.reply && help.reply.content) || ""),
    `help reply missing the command table: ${JSON.stringify(help && help.reply).slice(0, 160)}`
  );

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForTimeout(1200); // 回灌 + gate effect 落定余量

  const mounted = await page.locator("section.combat").count();
  if (mounted > 0) {
    const t = await page.locator("section.combat").innerText();
    assert(
      !/交战|Lv\.-/.test(t),
      `ghost combat panel after reload shows engagement copy: "${t.slice(0, 160)}"`
    );
    assert(false, `ghost combat panel auto-mounted after reload: "${t.slice(0, 160)}"`);
  }
  // 服务端口径自检：脱战是真实落库状态，不是前端碰巧没渲染。
  const sView = (await fetchSaveView(saveId)).save;
  assert(sView.combat === null, `server still reports live combat: ${JSON.stringify(sView.combat)}`);

  // ── (b) 同档真交战刷新 → 面板照常显示敌名与回合（反向防假绿）──
  const live = await ensureEngaged(page, saveId);
  const enemyName = live.combat.enemy.name;
  const liveTurn = live.combat.turn;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector("section.combat", { timeout: 8000 });
  assert(
    (await page.locator("section.combat .combat-title").innerText()).trim() === "交战",
    "live combat must still auto-open the panel after reload"
  );
  const shown = (await page.locator(".combatant-enemy .combatant-name").innerText()).trim();
  assert(shown === enemyName, `enemy name should be「${enemyName}」, got "${shown}"`);
  const turnText = (await page.locator(".combat-turn").innerText()).trim();
  assert(
    new RegExp(`第\\s*${liveTurn}\\s*回合`).test(turnText),
    `combat panel should show 第 ${liveTurn} 回合, got "${turnText}"`
  );
});
