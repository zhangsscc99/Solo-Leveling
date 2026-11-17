#!/usr/bin/env node
// F163 交战态「一组战斗控制」断言：
//   a) 真实 UI 输入触发遭遇（ensureEngaged：自由输入「攻击/前进」直到
//      section.combat 挂载且行动栏「攻击」可用）；
//   b) 交战态下全局「攻击」类可点按钮只出现 1 个——行动栏那一颗；
//      浮层 section.combat 里除 .combat-close 外没有任何 <button>，
//      五个 combat-btn 与 skill/item 子列表全部移除（纯情报面板：
//      敌名 / 敌 HP 条 / 第N回合 / 每回合伤害预估 / 我方 HP·MP）；
//   c) 行动栏为唯一控制组：攻击 1 / 释放技能 2 / 防御 3 / 道具 4 / 逃跑 5
//      全部可用；「道具」展开 .bar-skills 抽屉（无补给时空态文案）；
//   d) 点行动栏「攻击」→ 日志新增「第N回合」且敌 HP/我 HP 至少其一真实
//      变化（miss 合法，至多补点到第三次；击杀按「击败」播报计）；
//   e) 点 .combat-close 关掉浮层后「攻击」仍可点并再结算一个回合——
//      不产生「面板关了就没法打」的死角；
//   f) 390×844 主视口 + 1440×900 复测：无横向溢出
//      （document.documentElement.scrollWidth === clientWidth），
//      截图存 /root/logs/f163-combat-single-{390,1440}.png。
// 稳定性：关键动作后 settle 等待；整套断言失败重试一次（F087 口径）。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import fs from "node:fs";

const { loadPW, findChrome, createSave, assert, readVitals } = await import("../e2e/lib.mjs");
const { fetchSaveView } = await import("./_http.mjs");

const NAME = `e2e-f163-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// 行动组（第一组）内的按钮定位——排除系统组。
const combatBtn = (page, label) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

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

// 保证处于交战态：击杀冷却期「攻击」必空挥，先「前进」磨冷却再逼遭遇。
async function ensureEngaged(page, saveId) {
  for (let i = 0; i < 20; i++) {
    if (await combatBtn(page, "攻击").isEnabled().catch(() => false)) return;
    const s = (await fetchSaveView(saveId)).save;
    if (s.combat) {
      // UI 尚未刷新到交战态（刚结算完），多等一拍再判。
      await settle(page);
      continue;
    }
    await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
    await settle(page, 350);
  }
  assert(await combatBtn(page, "攻击").isEnabled(), "ensureEngaged: never entered combat");
}

async function assertNoOverflow(page, tag) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  console.log(`    (${tag}) scrollWidth=${m.sw} clientWidth=${m.cw}`);
  assert(m.sw === m.cw, `horizontal overflow @${tag}: scrollWidth ${m.sw} !== clientWidth ${m.cw}`);
}

async function body(page, saveId) {
  // ── a) 真实 UI 输入进入交战态 ─────────────────────────────────
  await ensureEngaged(page, saveId);
  await page.waitForSelector("section.combat");
  await settle(page);

  // ── b) 全局「攻击」可点按钮只此一颗；浮层内除关闭键无任何按钮 ──
  assert(
    (await page.getByRole("button", { name: /^攻击/ }).count()) === 1,
    `expected exactly 1 clickable「攻击」button, got ${await page.getByRole("button", { name: /^攻击/ }).count()}`
  );
  assert(
    (await page.locator("section.combat button:not(.combat-close)").count()) === 0,
    "combat panel still renders action buttons (should be info-only)"
  );
  assert((await page.locator("section.combat .combat-btn").count()) === 0, ".combat-btn leftover");
  assert((await page.locator("section.combat .combat-sub").count()) === 0, ".combat-sub leftover");
  // 纯情报面板字段齐全：敌名 / 敌 HP 条 / 第N回合 / 每回合预估 / 我方 HP·MP。
  const enemyName = (await page.locator(".combatant-enemy .combatant-name").innerText()).trim();
  assert(enemyName.length > 0, "enemy name missing in info panel");
  assert(
    (await page.locator(".combatant-enemy .combat-gauge").count()) >= 1,
    "enemy HP gauge missing"
  );
  assert(
    /第\s*\d+\s*回合/.test(await page.locator(".combat-turn").innerText()),
    `turn counter missing: "${await page.locator(".combat-turn").innerText()}"`
  );
  assert((await page.locator(".combat-est").count()) === 1, "per-turn damage estimate row missing");
  assert(
    (await page.locator("section.combat .combatant:not(.combatant-enemy) .combat-gauge").count()) === 2,
    "player HP+MP gauges missing"
  );

  // ── c) 行动栏 = 唯一控制组：五键全在且可用，道具抽屉可开合 ─────
  for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
    assert(await combatBtn(page, label).isEnabled(), `「${label}」disabled during engagement`);
  }
  await combatBtn(page, "道具").click();
  await page.waitForSelector(".bar-skills");
  const itemRows = await page.locator(".bar-skills .bar-skill").count();
  const itemEmpty = await page.locator(".bar-skills .combat-sub-empty").count();
  assert(itemRows + itemEmpty >= 1, "item drawer opened but rendered neither rows nor empty state");
  await combatBtn(page, "道具").click(); // 收起，后续截图与断言走紧凑底栏
  await page.waitForSelector(".bar-skills", { state: "detached" });

  // ── d) 行动栏「攻击」结算一回合（沿用战斗断言口径） ────────────
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
      await settle(page);
      assert(json && /第\s*\d+\s*回合/.test(json.reply?.content || ""), "attack reply lacks 第N回合");
      const stage = await page.locator(".stage").innerText();
      assert(/第\s*\d+\s*回合/.test(stage), "stage log missing 第N回合 after attack");
      const vit1 = await readVitals(page);
      const enemy1 = await page
        .locator(".combatant-enemy .gauge-num")
        .innerText()
        .catch(() => null);
      changed =
        vit1.hp.v !== vit0.hp.v ||
        enemy1 !== enemy0 ||
        /击败|倒下了/.test(json.reply?.content || "");
      if (!changed && i === 2) break;
      if (!json?.save?.combat) break; // 已击杀/脱战，不再多点
    }
    assert(changed, "attack never changed player/enemy HP within 3 clicks");
  }

  // ── e) 关掉浮层 → 行动栏「攻击」仍可点并再结算一回合 ───────────
  await ensureEngaged(page, saveId);
  await page.waitForSelector("section.combat");
  await page.locator(".combat-close").click();
  await page.waitForSelector("section.combat", { state: "detached" });
  assert(
    (await page.getByRole("button", { name: /^攻击/ }).count()) === 1,
    "「攻击」button missing after closing the combat panel (dead corner)"
  );
  assert(await combatBtn(page, "攻击").isEnabled(), "「攻击」disabled after closing panel");
  {
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/action") && r.request().method() === "POST"
      ),
      combatBtn(page, "攻击").click(),
    ]);
    await resp.finished().catch(() => {});
    const json = await resp.json().catch(() => null);
    await settle(page);
    assert(
      json && /第\s*\d+\s*回合/.test(json.reply?.content || ""),
      `post-close attack did not settle a turn: ${(json?.reply?.content || "").slice(0, 120)}`
    );
  }

  // ── f) 390×844 主视口：浮层开着截情报面板 + 无横向溢出 ─────────
  // 面板在交战持续期内被手动收起后不会被顶开（边沿触发口径）——
  // 截图需要它开着，走系统组「战斗」手动再开。
  await ensureEngaged(page, saveId);
  if ((await page.locator("section.combat").count()) === 0) {
    await page.locator(".btn-group-sys .btn", { hasText: "战斗" }).first().click();
  }
  await page.waitForSelector("section.combat");
  await settle(page);
  await assertNoOverflow(page, "390");
  fs.mkdirSync("/root/logs", { recursive: true });
  await page.screenshot({ path: "/root/logs/f163-combat-single-390.png", fullPage: true });

  // ── 1440×900 复测：重新进入交战态（浮层开着）截图 + 溢出 ──────
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, 500);
  await ensureEngaged(page, saveId);
  // 面板在交战持续期内被手动收起后不会被顶开（边沿触发口径）——
  // 复测截图需要它开着，走系统组「战斗」手动再开。
  if ((await page.locator("section.combat").count()) === 0) {
    await page.locator(".btn-group-sys .btn", { hasText: "战斗" }).first().click();
  }
  await page.waitForSelector("section.combat");
  await settle(page);
  await assertNoOverflow(page, "1440");
  await page.screenshot({ path: "/root/logs/f163-combat-single-1440.png", fullPage: true });
}

// F087 口径：整套断言失败重试一次（每次开新档，互不污染）。
async function main() {
  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let lastErr = null;
  for (let a = 0; a < 2; a++) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    try {
      const saveId = await createSave(page, `${NAME}-${a}`).then(() =>
        page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
      );
      assert(saveId > 0, "save_id missing in localStorage");
      await body(page, saveId);
      await ctx.close();
      console.log(`[ASSERT] combat-controls-single OK (attempt ${a + 1})`);
      await browser.close();
      process.exit(0);
    } catch (e) {
      lastErr = e;
      try {
        fs.mkdirSync("/root/logs", { recursive: true });
        await page.screenshot({
          path: `/root/logs/e2e-combat-controls-single-${Date.now()}.png`,
          fullPage: true,
        });
      } catch {}
      console.log(`[ASSERT] combat-controls-single attempt ${a + 1} failed: ${e.message}${a === 0 ? " — retrying once" : ""}`);
      await ctx.close().catch(() => {});
    }
  }
  await browser.close();
  console.error(`[ASSERT] combat-controls-single FAIL: ${lastErr && lastErr.message}`);
  process.exit(1);
}

main();
