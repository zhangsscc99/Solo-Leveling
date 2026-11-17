#!/usr/bin/env node
// F185 交战态行动栏上方的「为什么不能前进」提示：
//   a) 390×844 新档非交战态：页面不存在任何含「无法推进剧情」的元素；
//   b) 连点「前进」（被逼退/换标就继续点同一颗主按钮，最多 8 次）直到
//      行动栏出现战斗五键（footer.actions button:has-text("攻击")）；
//   c) 交战提示（.combat-lock-hint 或窄屏 .save-blocked-hint）可见、
//      role="note"、文本同时含「无法推进剧情」
//      与「逃跑」，且几何上在战斗按钮之上；
//   d) 脱战态提示消失（count === 0）——脱战态用「另开全新未交战档
//      接进同一页面」确定性取得，不依赖概率性逃跑；
//   e) documentElement 无横向溢出（scrollWidth - clientWidth === 0），
//      全程 console error / pageerror 为 0。
//   f) 交战态 .stage 高度 ≥ innerHeight×0.6（F094/F113/F119 版式契约
//      回归锁：提示不得以任何方式抬高底栏）；
//   g) 交战态 footer.actions 高度 ≤205px（390×844 基线 197 + 8px 容差）
//      ——防止再往行动栏里塞整行。
// 变异敏感性：旧码无该行 → a) 绿但 c) 必红（提示不存在）。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { post } = await import("./_http.mjs");

const NAME = `f185-${Date.now().toString(36)}`;
const settle = (page, ms = 450) => page.waitForTimeout(ms);

// F186：提示二选一承载——窄屏（≤880px，本脚本 390 视口）由
// .save-blocked-hint 的合并文案承载（含「无法推进剧情」+「逃跑」），
// 桌面由 .combat-lock-hint 行内后缀承载；断言只验「二者之一」存在。
const HINT = ".combat-lock-hint, .save-blocked-hint";
// 交战五键只在 liveCombat（.actions-main.actions-combat）下渲染；
// 守关房叫阵态按钮文案是「叫阵 · 攻击」，裸 has-text 会误判交战。
const atkBtn = (page) =>
  page.locator('footer.actions .actions-combat button:has-text("攻击")');
// 行动组（第一组）主按钮：非交战态是「前进」及其换标形态（折返/叫阵/
// 进入下章），都是探索推进那颗 primary 键。
const advanceBtn = (page) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn.primary").first();

async function actionButtonTexts(page) {
  return page.locator("footer.actions .btn").allInnerTexts();
}

run(
  "combat-lock-hint",
  async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    await createSave(page, NAME);
    await settle(page, 700);

    const hint = page.locator(HINT);

    // ── a) 非交战态：不存在含「无法推进剧情」的元素 ──
    const stray = page.locator("text=无法推进剧情");
    assert(
      (await stray.count()) === 0 && (await hint.count()) === 0,
      `非交战态出现提示：stray=${await stray.count()} hint=${await hint.count()}`
    );

    // ── b) 连点「前进」直到战斗五键出现（最多 8 次）──
    let engaged = (await atkBtn(page).count()) > 0;
    for (let i = 0; i < 8 && !engaged; i++) {
      const adv = advanceBtn(page);
      if ((await adv.count()) === 0) break;
      if (await adv.isDisabled().catch(() => true)) {
        await settle(page, 700);
        continue;
      }
      await adv.click();
      await settle(page, 800);
      engaged = (await atkBtn(page).count()) > 0;
    }
    assert(
      engaged,
      `8 次推进仍未交战，行动栏按钮=[${(await actionButtonTexts(page)).join(" | ")}]`
    );

    // ── c) 提示可见、role=note、双关键词、在按钮之上 ──
    await settle(page, 500);
    assert(
      (await hint.count()) === 1 && (await hint.first().isVisible()),
      `交战中提示不存在或不可见，按钮=[${(await actionButtonTexts(page)).join(" | ")}]`
    );
    const text = (await hint.first().innerText()).trim();
    assert(
      text.includes("无法推进剧情") && text.includes("逃跑"),
      `提示文案缺关键词："${text}"`
    );
    assert(
      (await hint.first().getAttribute("role")) === "note",
      `提示缺 role="note"，实际 role=${await hint.first().getAttribute("role")}`
    );
    const hintBox = await hint.first().boundingBox();
    const atkBox = await atkBtn(page).first().boundingBox();
    assert(
      hintBox && atkBox && hintBox.y + hintBox.height <= atkBox.y + 1,
      `提示不在行动按钮之上：hint=${JSON.stringify(hintBox)} atk=${JSON.stringify(atkBox)}`
    );

    // ── f/g) 版式回归锁：.stage ≥60% 视口、footer.actions ≤205px ──
    {
      const m = await page.evaluate(() => ({
        stage: document.querySelector(".stage").getBoundingClientRect().height,
        foot: document.querySelector("footer.actions").getBoundingClientRect().height,
        ih: window.innerHeight,
      }));
      console.log(
        `    (f/g) .stage=${m.stage.toFixed(1)}px (need≥${(m.ih * 0.6).toFixed(1)}),` +
          ` footer.actions=${m.foot.toFixed(1)}px (need≤205, 基线~197)`
      );
      assert(
        m.stage >= m.ih * 0.6,
        `.stage height ${m.stage}px < 60% viewport (need ≥${m.ih * 0.6}px)`
      );
      assert(
        m.foot <= 205,
        `footer.actions height ${m.foot}px > 205px（390×844 基线 ~197，留 8px 容差）`
      );
    }

    // ── d) 脱战态提示消失：另开全新未交战档接进同一页面（确定性取态）──
    // 旧口径靠连点「逃跑」掷概率脱战——全表并发时连续被拦即假红。脱战的
    // 真实定义就是 save.combat 为空：API 建一个从未交战的新档，写
    // localStorage 后 reload，走与建档/接档同一条 boot 路径。
    const { status: stB, body: bodyB } = await post("/saves", {
      player_name: `${NAME}-b`,
    });
    assert(
      stB === 201 && bodyB && bodyB.save && bodyB.save.id,
      `脱战对照档建档失败 (HTTP ${stB})`
    );
    await page.evaluate(
      (id) => localStorage.setItem("solo_leveling_save_id", String(id)),
      bodyB.save.id
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page, 700);
    assert(
      (await atkBtn(page).count()) === 0,
      `脱战对照档仍呈交战态，按钮=[${(await actionButtonTexts(page)).join(" | ")}]`
    );
    const postText = (await hint.count()) ? (await hint.first().innerText()).trim() : "";
    assert(
      (await hint.count()) === 0,
      `脱战后提示仍残留：count=${await hint.count()} text="${postText}"`
    );

    // ── e) 无横向溢出 + console error 为 0 ──
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    assert(overflow === 0, `横向溢出 scrollWidth-clientWidth=${overflow}`);
    assert(
      consoleErrors.length === 0,
      `console error ${consoleErrors.length} 条：${consoleErrors.join(" ; ").slice(0, 400)}`
    );
  },
  { viewport: { width: 390, height: 844 }, context: { hasTouch: true, isMobile: true } }
);
