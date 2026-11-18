#!/usr/bin/env node
// action.mjs: click 探索前进 -> a new narration entry is appended to the log.
// F124：首推是章首铺陈步——有真实位移、追加叙事、零消耗；第二推才是
// 正常推进，HP 或 MP 必须下降。
import { assert, createSave, readVitals, run, stageCount } from "./lib.mjs";

const NAME = `e2e-act-${Date.now().toString(36)}`;

run("action", async ({ page }) => {
  await createSave(page, NAME);

  const before = await readVitals(page);
  assert(before.hp && before.mp, "vitals readable before action");
  const n0 = await stageCount(page);
  const narr0 = await page.locator(".stage-col .narration").count();

  await page.locator(".actions-main .btn", { hasText: "探索前进" }).first().click();

  // Wait for the server round-trip: user echo + reply appended, pending gone.
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".stage-col > *").length >= n + 2 &&
      !document.querySelector(".pending"),
    n0
  );

  const narr1 = await page.locator(".stage-col .narration").count();
  assert(narr1 > narr0, `new narration appended (${narr0} -> ${narr1})`);

  // 首推是免费的剧情铺陈（F124）：叙事追加但 HP/MP 不变。
  const afterFirst = await readVitals(page);
  assert(
    afterFirst.hp.v === before.hp.v && afterFirst.mp.v === before.mp.v,
    `first scripted advance must be free (HP ${before.hp.v}->${afterFirst.hp.v}, MP ${before.mp.v}->${afterFirst.mp.v})`
  );

  // 第二推是真实推进：等待回包后 HP 或 MP 必须下降。
  // P204 must_choose：某些场景裸「前进」是零消耗拒绝（正文「这里必须做出
  // 选择：1) … 2) …」），此时按界面提示点第一个主线选项把这一步走完——
  // 断言口径不变：真实推进仍然要付体力。
  const n1 = await stageCount(page);
  await page.locator(".actions-main .btn", { hasText: "探索前进" }).first().click();
  await page.waitForFunction(
    (n) =>
      document.querySelectorAll(".stage-col > *").length >= n + 2 &&
      !document.querySelector(".pending"),
    n1
  );

  const refused = await page.evaluate(() =>
    [...document.querySelectorAll(".stage-col > *")]
      .slice(-3)
      .some((e) => /必须做出选择/.test(e.textContent || ""))
  );
  if (refused) {
    const choice = page.locator(".btn-group-choice > .btn").first();
    assert((await choice.count()) > 0, "must_choose refusal without any choice button");
    await choice.click();
    await page.waitForFunction(() => !document.querySelector(".pending"));
    await page.waitForTimeout(300);
  }

  const after = await readVitals(page);
  assert(
    after.hp.v !== before.hp.v || after.mp.v !== before.mp.v,
    `second advance must cost vitals (HP ${before.hp.v}->${after.hp.v}, MP ${before.mp.v}->${after.mp.v})`
  );
});
