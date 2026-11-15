#!/usr/bin/env node
// action.mjs: click 探索前进 -> a new narration entry is appended to the log
// and HP or MP changes.
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

  const after = await readVitals(page);
  assert(
    after.hp.v !== before.hp.v || after.mp.v !== before.mp.v,
    `HP or MP changed (HP ${before.hp.v}->${after.hp.v}, MP ${before.mp.v}->${after.mp.v})`
  );
});
