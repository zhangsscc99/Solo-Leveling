#!/usr/bin/env node
// F076 gate：战斗面板由日志交战信号（遭遇X / 第N回合）驱动开合。
// F163 结构迁移：浮层战斗面板退化为纯情报区，不再渲染任何动作键；
// 交战期唯一控制组是行动栏 .actions-main 的战斗五键（攻击/释放技能/
// 防御/道具/逃跑，快捷键 1–5）。原「面板内五个动作键」断言全部迁到
// 行动栏，并新增「面板内不得再出现重复动作键」的回归断言。
//   负向：新档无 section.combat / 无占位敌人 / 无 Lv.??；
//         手动开「战斗」→ 空态提示 + 面板零动作键 + 行动栏 .combat-entry
//         disabled（承接原「五键 disabled」语义，F113/F119 非交战矮入口）。
//   正向（真实驱动 UI：自由输入 → 服务端回显入日志 → gate 命中）：
//     ①「第 3 回合」→ 面板自动挂载，敌槽「未知目标」，面板无动作键；
//     ②「战斗结束」→ 面板自动收起一次；
//     ③「遭遇哥布林」→ 再次自动挂载，敌名「哥布林」；
//     ④「战斗结束」收起后手动打开 → 再发「观察」→ 面板仍然开着
//        （ended 残留期内日志更新不得强关手动面板，BLOCKING 1 回归断言）。
//   正向⑤（F163 真实交战态）：自由输入逼出真实遭遇（save.combat）→
//        行动栏五键可用且面板仍零动作键（重复控制组回归）→ 点行动栏
//        「攻击」结算一回合：回包与舞台日志新增「第N回合」，敌 HP /
//        我方 HP 至少其一真实变化（miss 合法，至多补点到第三次；击杀
//        按「击败/倒下了」播报计——与 combat-controls-single 同口径）。
import { run, createSave, assert, readVitals } from "../e2e/lib.mjs";

const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;
const { fetchSaveView } = await import("./_http.mjs");

const NAME = `e2e-cgate-${Date.now().toString(36)}`;

// 交战期唯一控制组：行动组（第一组）内的按钮——排除系统组 .btn-group-sys。
const combatBtn = (page, label) =>
  page.locator(".actions-main .btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

// F163 回归断言：浮层面板内不得再长出一组动作键（.combat-acts/.combat-btn
// 均已移除；除 .combat-close 外不允许任何 <button>）。
async function assertPanelHasNoActions(page, tag) {
  assert(
    (await page.locator("section.combat .combat-acts button").count()) === 0,
    `combat panel still renders .combat-acts action buttons @${tag} (F163 regression)`
  );
  assert(
    (await page.locator("section.combat .combat-btn").count()) === 0,
    `.combat-btn leftover @${tag} (F163 regression)`
  );
  assert(
    (await page.locator("section.combat button:not(.combat-close)").count()) === 0,
    `combat panel renders stray buttons beyond .combat-close @${tag}`
  );
}

// 自由行动输入框发一条指令，并等 /action 回包完整落地（回复已进日志），
// 之后的呈现层等待全部交给 waitForSelector / 固定 settle。
async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 逼出服务端真实交战态（save.combat）——行动栏战斗五键只在 liveCombat
// 下渲染。击杀冷却期「攻击」必空挥，先「前进」磨冷却再逼遭遇
// （与 combat-controls-single ensureEngaged 同口径）。
async function ensureEngaged(page, saveId) {
  for (let i = 0; i < 20; i++) {
    if (await combatBtn(page, "攻击").isEnabled().catch(() => false)) return;
    const s = (await fetchSaveView(saveId)).save;
    if (s.combat) {
      await page.waitForTimeout(400); // UI 尚未刷新到交战态，多等一拍再判
      continue;
    }
    await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
    await page.waitForTimeout(350);
  }
  assert(await combatBtn(page, "攻击").isEnabled(), "ensureEngaged: never entered combat");
}

run("combat-gate", async ({ page }) => {
  await createSave(page, NAME);
  await page.waitForSelector(".stage-col .narration, .stage-col .holo");
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // ── 负向 ① 新档：战斗面板不得自动挂载，不得渲染占位敌人 ──
  await page.waitForTimeout(600);
  assert(
    (await page.locator("section.combat").count()) === 0,
    "section.combat mounted on a fresh save (false-positive combat signal)"
  );
  const fresh = await page.locator("body").innerText();
  assert(!fresh.includes("未知的敌人"), "「未知的敌人」placeholder visible on fresh save");
  assert(!fresh.includes("Lv.??"), "Lv.?? literal visible on page");

  // ── 负向 ② 手动开「战斗」→ 空态提示；面板零动作键，行动栏只剩
  //    .combat-entry 单行矮入口（disabled + aria + title，承接原
  //    「五键 disabled/aria/title」语义），战斗五键整组不渲染 ──
  await page.getByRole("button", { name: "战斗", exact: true }).click();
  await page.waitForSelector("section.combat");
  const panel = await page.locator("section.combat").innerText();
  assert(panel.includes("当前没有交战目标"), "empty-state hint missing in manually opened combat panel");
  assert(!panel.includes("??/??"), "??/?? gauge rendered for the empty enemy slot");
  await assertPanelHasNoActions(page, "no-engagement");
  const entry = page.locator(".actions-main .combat-entry");
  assert((await entry.count()) === 1, ".combat-entry missing in non-engaged action bar");
  assert(await entry.isDisabled(), ".combat-entry enabled with no engagement");
  assert(
    (await entry.getAttribute("aria-disabled")) === "true",
    ".combat-entry missing aria-disabled=\"true\""
  );
  assert(
    (await entry.getAttribute("title")) === "当前没有可攻击的目标",
    ".combat-entry missing title=\"当前没有可攻击的目标\""
  );
  for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
    assert(
      (await combatBtn(page, label).count()) === 0,
      `combat action「${label}」rendered in action bar with no engagement`
    );
  }
  await page.locator(".combat-close").click();
  await page.waitForSelector("section.combat", { state: "detached" });

  // ── 正向 ① 只给回合信号（无敌人名）：自动挂载，敌槽「未知目标」，
  //    面板仍不得渲染动作键 ──
  await send(page, "第 3 回合");
  await page.waitForSelector("section.combat", { timeout: 8000 });
  assert(
    (await page.locator("section.combat .combat-title").innerText()).trim() === "交战",
    "combat panel title should be 交战 after an engage signal"
  );
  const enemy1 = await page.locator("section.combat .combatant-enemy").innerText();
  assert(
    enemy1.includes("未知目标"),
    `engage without enemy name should render 未知目标, got "${enemy1.trim()}"`
  );
  await assertPanelHasNoActions(page, "engage-signal");

  // ── 正向 ② 「战斗结束」→ 面板自动收起一次 ──
  await send(page, "战斗结束");
  await page.waitForSelector("section.combat", { state: "detached", timeout: 8000 });
  await page.waitForTimeout(600);
  assert(
    (await page.locator("section.combat").count()) === 0,
    "combat panel still mounted after 战斗结束"
  );

  // ── 正向 ③ 「遭遇哥布林」→ 再次自动挂载，敌名「哥布林」，面板无动作键 ──
  await send(page, "遭遇哥布林");
  await page.waitForSelector("section.combat", { timeout: 8000 });
  const enemyName = (await page.locator("section.combat .combatant-enemy .combatant-name").innerText()).trim();
  assert(enemyName === "哥布林", `enemy name should be 哥布林, got "${enemyName}"`);
  await assertPanelHasNoActions(page, "named-engage");

  // ── 正向 ④ 收束后手动打开 → 后续日志不得强关（BLOCKING 1 回归）──
  await send(page, "战斗结束");
  await page.waitForSelector("section.combat", { state: "detached", timeout: 8000 });
  await page.getByRole("button", { name: "战斗", exact: true }).click();
  await page.waitForSelector("section.combat");
  await send(page, "观察");
  await page.waitForTimeout(600);
  assert(
    (await page.locator("section.combat").count()) === 1,
    "manually opened combat panel was force-closed by a log update in ended state"
  );

  // ── 正向 ⑤ F163 真实交战：行动栏是唯一控制组 ──
  // 逼出 save.combat → 行动栏五键全部可用（承接原「面板五键可用」），
  // 面板仍零动作键（重复控制组回归），点行动栏「攻击」结算一回合。
  await ensureEngaged(page, saveId);
  await page.waitForSelector(".actions-main.actions-combat", { timeout: 8000 });
  await page.waitForSelector("section.combat", { timeout: 8000 });
  await page.waitForTimeout(400);
  await assertPanelHasNoActions(page, "live-combat");
  assert(
    (await page.getByRole("button", { name: /^攻击/ }).count()) === 1,
    `expected exactly 1 clickable「攻击」button, got ${await page.getByRole("button", { name: /^攻击/ }).count()}`
  );
  for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
    assert(await combatBtn(page, label).isEnabled(), `「${label}」disabled during engagement`);
  }
  {
    let changed = false;
    for (let i = 0; i < 3 && !changed; i++) {
      const vit0 = await readVitals(page);
      const enemy0 = await page
        .locator(".combatant-enemy .gauge-num")
        .innerText()
        .catch(() => null);
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/action") && r.request().method() === "POST"
        ),
        combatBtn(page, "攻击").click(),
      ]);
      await resp.finished().catch(() => {});
      const json = await resp.json().catch(() => null);
      await page.waitForTimeout(400);
      assert(json && /第\s*\d+\s*回合/.test(json.reply?.content || ""), "attack reply lacks 第N回合");
      const stage = await page.locator(".stage").innerText();
      assert(/第\s*\d+\s*回合/.test(stage), "stage log missing 第N回合 after attack");
      const vit1 = await readVitals(page);
      const enemyNext = await page
        .locator(".combatant-enemy .gauge-num")
        .innerText()
        .catch(() => null);
      changed =
        (vit1.hp?.v ?? null) !== (vit0.hp?.v ?? null) ||
        enemyNext !== enemy0 ||
        /击败|倒下了/.test(json.reply?.content || "");
      if (!json?.save?.combat) break; // 已击杀/脱战，不再多点
    }
    assert(changed, "attack never changed player/enemy HP within 3 clicks");
  }
});
