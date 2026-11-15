#!/usr/bin/env node
// mobile.mjs: 390x844 viewport -> bottom action bar visible, drawer button
// opens the sidebar as a drawer.
import { assert, createSave, run } from "./lib.mjs";

const NAME = `e2e-mob-${Date.now().toString(36)}`;
const VW = 390;
const VH = 844;

run(
  "mobile",
  async ({ page }) => {
    await createSave(page, NAME);

    // Bottom action bar pinned to the viewport bottom.
    const bar = page.locator(".actions");
    assert(await bar.isVisible(), "bottom action bar visible");
    const box = await bar.boundingBox();
    assert(box && box.y + box.height >= VH - 5, `action bar pinned to bottom (bottom=${box && box.y + box.height})`);

    // Action buttons reachable inside the bottom bar.
    const btn = page.locator(".actions .btn", { hasText: "探索前进" });
    assert((await btn.count()) >= 1, "探索前进 reachable in bottom bar");

    // Drawer toggle exists on mobile and meets 44px touch target.
    const toggle = page.locator(".drawer-toggle");
    assert(await toggle.isVisible(), "drawer toggle visible on mobile");
    const tbox = await toggle.boundingBox();
    assert(tbox && tbox.height >= 44, `drawer toggle >=44px tall (${tbox && tbox.height})`);

    await toggle.click();
    await page.waitForFunction(
      (vw) => {
        const el = document.querySelector(".sidebar.open");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.x < vw;
      },
      VW
    );
    const sbox = await page.locator(".sidebar.open").boundingBox();
    assert(sbox && sbox.width >= 200, `sidebar drawer slides in (w=${sbox && sbox.width})`);
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
