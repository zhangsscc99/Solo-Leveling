#!/usr/bin/env node
// F186 交战提示去重：
//   a) 390×844 交战态：整页可见的交战提示 [role=note] === 1（类名白名单
//      .combat-lock-hint / .save-blocked-hint，.rest-hint 等既有小字
//      不计入），且那一条必须是 .save-blocked-hint、承载合并文案（同时
//      含「存档」与「推进剧情」，且「交战中无法写入存档」连续出现——
//      save-blocked-hint 子串契约）；窄屏不渲染 .combat-lock-hint；
//   b) 1440×900 交战态：.combat-lock-hint 仍是「行动」标签行内后缀
//      （footer 内可见 [role=note] === 2），两条提示各自原文案不变；
//   c) 版式硬契约：.stage ≥ innerHeight×0.6、footer.actions ≤205px、
//      scrollWidth-clientWidth === 0；
//   d) 脱战态两种视口 combat 提示计数均为 0（提示不常驻）——脱战态
//      用「另开全新未交战档接进同一页面」取得，不依赖概率性逃跑；
//   e) 全程 console error / pageerror 为 0。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { act, fetchSaveView, post } = await import("./_http.mjs");

const NAME = `f186-${Date.now().toString(36)}`;
const settle = (page, ms = 450) => page.waitForTimeout(ms);

// 交战提示类名白名单：只这两类计入去重口径；.rest-hint 等既有小字排除。
const COMBAT_HINT = ".combat-lock-hint, .save-blocked-hint";

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

// 整页可见的交战提示列表（白名单类名，返回 {cls, text}）
async function visibleNotes(page) {
  const loc = page.locator(COMBAT_HINT);
  const n = await loc.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    const el = loc.nth(i);
    if (await el.isVisible()) {
      out.push({
        cls: (await el.getAttribute("class")) || "",
        text: (await el.innerText()).trim(),
      });
    }
  }
  return out;
}

async function metrics(page, tag) {
  const m = await page.evaluate(() => ({
    stage: document.querySelector(".stage").getBoundingClientRect().height,
    foot: document.querySelector("footer.actions").getBoundingClientRect().height,
    ih: window.innerHeight,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  console.log(
    `    (${tag}) .stage=${m.stage.toFixed(1)}px (need≥${(m.ih * 0.6).toFixed(1)}),` +
      ` footer.actions=${m.foot.toFixed(1)}px (need≤205), h-overflow=${m.overflow}`
  );
  assert(m.stage >= m.ih * 0.6, `.stage ${m.stage}px < 60% viewport @${tag}`);
  assert(m.foot <= 205, `footer.actions ${m.foot}px > 205px @${tag}`);
  assert(m.overflow === 0, `横向溢出 scrollWidth-clientWidth=${m.overflow} @${tag}`);
  return m;
}

run(
  "combat-hint-dedupe",
  async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    const saveId = await createSave(page, NAME).then(() =>
      page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
    );
    assert(saveId > 0, "save_id missing in localStorage");
    await settle(page, 700);

    // ── d-前置) 脱战态：combat 双提示均不渲染（1440 先验一次）──
    assert(
      (await page.locator(".combat-lock-hint, .save-blocked-hint").count()) === 0,
      "脱战态 combat 提示残留（1440）"
    );

    // ── 打出真实交战态 → reload 回灌 save.combat ──
    await ensureEngaged(saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForSelector(".save-blocked-hint");
    await settle(page, 600);

    // ── a) 390×844：整页可见交战提示 === 1 且为 .save-blocked-hint 合并文案 ──
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 600);
    const notes390 = await visibleNotes(page);
    console.log(`    (390x844) visible combat hints=${notes390.length}: ${JSON.stringify(notes390)}`);
    assert(notes390.length === 1, `390 下整页可见交战提示 === ${notes390.length}（期望 1）`);
    assert(
      notes390[0].cls.includes("save-blocked-hint"),
      `390 下唯一交战提示不是 .save-blocked-hint：${notes390[0].cls}`
    );
    assert(
      notes390[0].text.includes("存档") && notes390[0].text.includes("推进剧情"),
      `合并文案缺关键词："${notes390[0].text}"`
    );
    const hint390 = page.locator(".save-blocked-hint");
    assert(
      (await hint390.count()) === 1 && (await hint390.isVisible()),
      ".save-blocked-hint 不存在或不可见 @390"
    );
    // 窄屏不再渲染 .combat-lock-hint（第二条近义浮层已删除）
    assert(
      (await page.locator(".combat-lock-hint").count()) === 0,
      "390 下 .combat-lock-hint 仍存在于 DOM"
    );
    await metrics(page, "390x844");

    // ── b) 1440×900：行内后缀 + 存档提示并存，各自原文案 ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page, 600);
    const notes1440 = await visibleNotes(page);
    console.log(`    (1440x900) visible combat hints=${notes1440.length}: ${JSON.stringify(notes1440)}`);
    assert(notes1440.length === 2, `1440 下整页可见交战提示 === ${notes1440.length}（期望 2）`);
    const lock1440 = page.locator("footer.actions .combat-lock-hint");
    assert(
      (await lock1440.count()) === 1 && (await lock1440.isVisible()),
      "1440 下 .combat-lock-hint 不在 footer 内或不可见（行内后缀丢失）"
    );
    const lock1440Text = (await lock1440.innerText()).trim();
    assert(
      lock1440Text.includes("无法推进剧情") && lock1440Text.includes("逃跑"),
      `1440 行内后缀文案变动："${lock1440Text}"`
    );
    const saveText = (await page.locator(".save-blocked-hint").innerText()).trim();
    assert(
      saveText.includes("交战中无法写入存档") && /逃跑|打赢/.test(saveText),
      `1440 .save-blocked-hint 文案变动："${saveText}"`
    );
    await metrics(page, "1440x900");

    // ── d) 脱战态：另开全新未交战档接进同一页面（不点「逃跑」）──
    // 旧口径靠连点「逃跑」掷概率脱战——负载/运气差时连挂即假红。脱战
    // 的真实定义就是 save.combat 为空：API 建一个从未交战的新档，写
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
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page, 700);
    // 脱战态下两条 combat 浮层都不渲染（.rest-hint 是独立的常驻小字，
    // 不属于本特性计数口径）。
    const combatHints = async () => {
      const els = page.locator(".combat-lock-hint, .save-blocked-hint");
      let v = 0;
      for (let i = 0; i < (await els.count()); i++) if (await els.nth(i).isVisible()) v++;
      return v;
    };
    assert((await combatHints()) === 0, "脱战后 390 仍有可见 combat 提示");
    await page.setViewportSize({ width: 1440, height: 900 });
    await settle(page, 500);
    assert((await combatHints()) === 0, "脱战后 1440 仍有可见 combat 提示");

    // ── e) console error 0 ──
    assert(
      consoleErrors.length === 0,
      `console error ${consoleErrors.length} 条：${consoleErrors.join(" ; ").slice(0, 400)}`
    );
  },
  { viewport: { width: 1440, height: 900 } }
);
