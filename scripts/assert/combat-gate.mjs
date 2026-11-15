#!/usr/bin/env node
// F076 gate：战斗面板由日志交战信号（遭遇X / 第N回合）驱动开合。
//   负向：新档无 section.combat / 无占位敌人 / 无 Lv.??；
//         手动开「战斗」→ 空态提示 + 五键 disabled。
//   正向（真实驱动 UI：自由输入 → 服务端回显入日志 → gate 命中）：
//     ①「第 3 回合」→ 面板自动挂载，敌槽「未知目标」，五键可用；
//     ②「战斗结束」→ 面板自动收起一次；
//     ③「遭遇哥布林」→ 再次自动挂载，敌名「哥布林」，攻击键可用；
//     ④「战斗结束」收起后手动打开 → 再发「观察」→ 面板仍然开着
//        （ended 残留期内日志更新不得强关手动面板，BLOCKING 1 回归断言）。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `e2e-cgate-${Date.now().toString(36)}`;

// 自由行动输入框发一条指令，并等 /action 回包完整落地（回复已进日志），
// 之后的呈现层等待全部交给 waitForSelector / 固定 settle。
async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
}

run("combat-gate", async ({ page }) => {
  await createSave(page, NAME);
  await page.waitForSelector(".stage-col .narration, .stage-col .holo");

  // ── 负向 ① 新档：战斗面板不得自动挂载，不得渲染占位敌人 ──
  await page.waitForTimeout(600);
  assert(
    (await page.locator("section.combat").count()) === 0,
    "section.combat mounted on a fresh save (false-positive combat signal)"
  );
  const fresh = await page.locator("body").innerText();
  assert(!fresh.includes("未知的敌人"), "「未知的敌人」placeholder visible on fresh save");
  assert(!fresh.includes("Lv.??"), "Lv.?? literal visible on page");

  // ── 负向 ② 手动开「战斗」→ 空态提示，五键 disabled + aria + title ──
  await page.getByRole("button", { name: "战斗", exact: true }).click();
  await page.waitForSelector("section.combat");
  const panel = await page.locator("section.combat").innerText();
  assert(panel.includes("当前没有交战目标"), "empty-state hint missing in manually opened combat panel");
  assert(!panel.includes("??/??"), "??/?? gauge rendered for the empty enemy slot");
  const acts = await page.locator("section.combat .combat-acts button").all();
  assert(acts.length === 5, `expected 5 combat action buttons, got ${acts.length}`);
  for (const b of acts) {
    const label = (await b.innerText()).trim();
    assert(await b.isDisabled(), `combat action「${label}」enabled with no engagement`);
    assert(
      (await b.getAttribute("aria-disabled")) === "true",
      `combat action「${label}」missing aria-disabled="true"`
    );
    assert(
      (await b.getAttribute("title")) === "当前没有交战目标",
      `combat action「${label}」missing title="当前没有交战目标"`
    );
  }
  await page.locator(".combat-close").click();
  await page.waitForSelector("section.combat", { state: "detached" });

  // ── 正向 ① 只给回合信号（无敌人名）：自动挂载，敌槽「未知目标」，五键可用 ──
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
  for (const b of await page.locator("section.combat .combat-acts button").all()) {
    const label = (await b.innerText()).trim();
    assert(!(await b.isDisabled()), `combat action「${label}」disabled during engagement`);
  }

  // ── 正向 ② 「战斗结束」→ 面板自动收起一次 ──
  await send(page, "战斗结束");
  await page.waitForSelector("section.combat", { state: "detached", timeout: 8000 });
  await page.waitForTimeout(600);
  assert(
    (await page.locator("section.combat").count()) === 0,
    "combat panel still mounted after 战斗结束"
  );

  // ── 正向 ③ 「遭遇哥布林」→ 再次自动挂载，敌名「哥布林」，攻击键可用 ──
  await send(page, "遭遇哥布林");
  await page.waitForSelector("section.combat", { timeout: 8000 });
  const enemyName = (await page.locator("section.combat .combatant-enemy .combatant-name").innerText()).trim();
  assert(enemyName === "哥布林", `enemy name should be 哥布林, got "${enemyName}"`);
  const atk = page.locator("section.combat .combat-acts button", { hasText: "攻击" });
  assert(!(await atk.isDisabled()), "攻击 button disabled during engagement");

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
});
