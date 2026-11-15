#!/usr/bin/env node
// F076 gate：战斗面板只在明确交战信号（遭遇X / 第N回合）时才自动挂载。
//   ① 新档主界面不得出现 section.combat 与「未知的敌人」占位；
//   ② 战斗行动键不存在或全部 disabled；
//   ③ 手动点「战斗」→ 空态提示 + 五键 disabled/aria-disabled/title；
//   ④ 页面任意位置不得出现 Lv.?? 字面量。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `e2e-cgate-${Date.now().toString(36)}`;

run("combat-gate", async ({ page }) => {
  await createSave(page, NAME);
  await page.waitForSelector(".stage-col .narration, .stage-col .holo");

  // ① 新档：战斗面板不得自动挂载，不得渲染占位敌人。
  assert(
    (await page.locator("section.combat").count()) === 0,
    "section.combat mounted on a fresh save (false-positive combat signal)"
  );
  const fresh = await page.locator("body").innerText();
  assert(!fresh.includes("未知的敌人"), "「未知的敌人」placeholder visible on fresh save");

  // ② 战斗行动键不存在或全部 disabled。
  for (const b of await page.locator("section.combat .combat-acts button").all()) {
    assert(await b.isDisabled(), "combat action button enabled with no enemy");
  }

  // ③ 手动开「战斗」→ 空态提示，五键 disabled + aria-disabled + title。
  await page.getByRole("button", { name: "战斗", exact: true }).click();
  await page.waitForSelector("section.combat");
  const panel = await page.locator("section.combat").innerText();
  assert(panel.includes("当前没有交战目标"), "empty-state hint missing in manually opened combat panel");
  const acts = await page.locator("section.combat .combat-acts button").all();
  assert(acts.length === 5, `expected 5 combat action buttons, got ${acts.length}`);
  for (const b of acts) {
    const label = (await b.innerText()).trim();
    assert(await b.isDisabled(), `combat action「${label}」enabled with no enemy`);
    assert(
      (await b.getAttribute("aria-disabled")) === "true",
      `combat action「${label}」missing aria-disabled="true"`
    );
    assert(
      (await b.getAttribute("title")) === "当前没有敌人",
      `combat action「${label}」missing title="当前没有敌人"`
    );
  }

  // ④ 无 Lv.?? 字面量；空敌人槽不得渲染 ??/?? 血槽。
  const after = await page.locator("body").innerText();
  assert(!after.includes("Lv.??"), "Lv.?? literal visible on page");
  assert(!panel.includes("??/??"), "??/?? gauge rendered for the empty enemy slot");
});
