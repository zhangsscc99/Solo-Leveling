#!/usr/bin/env node
// F083 contract: 顶栏与属性面板显示含装备加成的 攻/防。
//   1. 顶栏 .status-nums 同时出现「攻」「防」标签，数值为纯数字；
//   2. 属性抽屉有「战斗数值」段，攻击/防御合计 = floor(系数×属性) + 装备加成，
//      真值取自 GET /api/saves/:id（容差 0），系数直接取 server/engine/stats.js；
//      F147 起新档自动穿上配发装备 → 装备列逐格 +N；真卸下后显示「未装备」；
//   3. 卸下→重新装备武器 + 防具刷新后数值随 equipment 更新；
//   4. 移动端 360/375/390/414：每个 .stat 的 <b> 与标签同行（sameLine），
//      header 高度 ≤142px（main 版 390px 实测 137px 量级）；
//   5. 负向：数值单元格无 NaN / undefined / +0 裸占位。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPW, findChrome } from "../e2e/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const BASE_URL = (process.env.BASE_URL || process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
const API = `${BASE_URL}/api`;
const SHOT_DIR = "/www/hermes-home/cache/scratch";

function fail(msg) {
  console.error(`[ASSERT] ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function api(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// 折算系数直接取服务端：def 用 stats.defenseOf（= 0.8×体力）；
// atk 系数 stats.js 未单独导出，用 physicalDamage({strength:100},0) 探测
// （整数探针下 round 无失真，得 K.dmgStr=1.6）。展示口径仍是 floor + 装备加成。
const statsLib = createRequire(path.join(ROOT, "noop.js"))(
  path.join(ROOT, "server", "engine", "stats.js")
);
const ATK_COEF = statsLib.physicalDamage({ stats: { strength: 100 } }, 0) / 100;
const expAtk = (s, eq) =>
  Math.floor(statsLib.statOf({ stats: s }, "strength") * ATK_COEF) + (eq?.atk ?? 0);
const expDef = (s, eq) => Math.floor(statsLib.defenseOf({ stats: s })) + (eq?.def ?? 0);

async function readCombatNums(page) {
  // 从「战斗数值」两行的 aria-label 解析合计（最贴近读屏口径）。
  return page.evaluate(() => {
    const out = {};
    for (const row of document.querySelectorAll(".combat-nums-row")) {
      const m = (row.getAttribute("aria-label") || "").match(/^(攻击|防御) 合计 (\d+)，基础 (\d+)，装备加成 (\d+)$/);
      if (m) out[m[1]] = { total: Number(m[2]), base: Number(m[3]), eq: Number(m[4]) };
    }
    return out;
  });
}

async function checkNoPlaceholders(page) {
  // +0 负向扫描限定在顶栏/面板的数值单元格，避免误伤背包「攻击 +4」等正常文案；
  // stage 日志是服务端原文（如「防御 +0」播报），不在本契约内。
  const cells = await page.evaluate(() =>
    [".status-nums .stat b", ".combat-nums .cn-num", ".combat-nums .cn-eq"]
      .flatMap((s) => [...document.querySelectorAll(s)].map((el) => el.textContent.trim()))
  );
  for (const t of cells) {
    assert(!/\+0/.test(t), `数值单元格出现裸占位 +0: ${JSON.stringify(t)}`);
    assert(t !== "NaN" && t !== "undefined", `数值单元格出现 ${JSON.stringify(t)}`);
  }
  const text = await page.evaluate(() =>
    [".status", ".sidebar"].map((s) => document.querySelector(s)?.innerText || "").join("\n"));
  for (const bad of ["NaN", "undefined"]) {
    assert(!text.includes(bad), `状态栏/属性面板出现裸占位文本 ${JSON.stringify(bad)}`);
  }
}

// 实测每个 .stat 的 <b> 与标签是否同行 + header 高度（审查同款口径）。
async function measureBar(page) {
  return page.evaluate(() => {
    const stats = [...document.querySelectorAll(".status-nums .stat")].map((el) => {
      const b = el.querySelector("b");
      const er = el.getBoundingClientRect();
      const br = b.getBoundingClientRect();
      return {
        text: el.textContent.trim(),
        w: Math.round(er.width),
        h: Math.round(er.height),
        // <b> 字体基线与行盒有 ≤2px 视觉偏移；换行时偏移 ≥ 一个行高(≈19px)。
        sameLine: Math.abs(er.top - br.top) < 3,
      };
    });
    const header = document.querySelector(".status").getBoundingClientRect();
    return { stats, headerH: Math.round(header.height) };
  });
}

async function assertMobileBar(page, width) {
  await page.setViewportSize({ width, height: 844 });
  await page.waitForSelector(".status .status-nums");
  const { stats, headerH } = await measureBar(page);
  assert(stats.length === 9, `@${width} 顶栏应有 9 项 .stat，实测 ${stats.length}`);
  const bad = stats.filter((s) => !s.sameLine);
  assert(
    bad.length === 0,
    `@${width} 有 ${bad.length} 项数字被挤到第二行: ${bad.map((s) => s.text).join(",")}`
  );
  assert(headerH <= 142, `@${width} header 高 ${headerH}px > 142px（main 版量级 137px）`);
  return { stats, headerH };
}

async function main() {
  // 现建存档，不碰线上数据。
  const created = await api("/saves", {
    method: "POST",
    body: JSON.stringify({ player_name: `f083-${Date.now().toString(36)}` }),
  });
  assert(created.status === 201 && created.body?.save?.id, `create save failed (HTTP ${created.status})`);
  const saveId = created.body.save.id;

  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((id) => localStorage.setItem("solo_leveling_save_id", String(id)), saveId);
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status .status-nums");

    // ── 1) 顶栏：攻/防标签 + 数字 ──
    const top = await page.evaluate(() => {
      const stats = [...document.querySelectorAll(".status-nums .stat")];
      const pick = (label) => {
        const el = stats.find((s) => s.textContent.trim().startsWith(label));
        const b = el?.querySelector("b");
        return b ? b.textContent.trim() : null;
      };
      return { atk: pick("攻"), def: pick("防") };
    });
    assert(top.atk !== null && /^\d+$/.test(top.atk), `顶栏缺「攻」或其值非数字: ${top.atk}`);
    assert(top.def !== null && /^\d+$/.test(top.def), `顶栏缺「防」或其值非数字: ${top.def}`);

    // ── 2) 属性抽屉：战斗数值段，与 API 真值比对（容差 0）──
    await page.locator('.btn-group-sys .btn', { hasText: "属性" }).click();
    await page.waitForSelector(".stat-panel .combat-nums");

    let truth = (await api(`/saves/${saveId}`)).body;
    let nums = await readCombatNums(page);
    assert(nums.攻击 && nums.防御, "战斗数值段缺攻击或防御行");
    assert(nums.攻击.total === expAtk(truth.save.stats, truth.equipment),
      `攻击合计 ${nums.攻击.total} ≠ floor(${ATK_COEF}×${truth.save.stats.strength})+${truth.equipment.atk}`);
    assert(nums.防御.total === expDef(truth.save.stats, truth.equipment),
      `防御合计 ${nums.防御.total} ≠ floor(0.8×${truth.save.stats.vitality})+${truth.equipment.def}`);
    assert(Number(top.atk) === nums.攻击.total, `顶栏攻 ${top.atk} ≠ 面板合计 ${nums.攻击.total}`);
    assert(Number(top.def) === nums.防御.total, `顶栏防 ${top.def} ≠ 面板合计 ${nums.防御.total}`);

    // F147 后新档自带配发装备：旧契约「空装备显示『无配发装备』」作废——
    // 新契约是「装备列逐格 +N，合计 = 基础 + N」。逐格核对 aria 三元组与
    // 可见单元格，真值全部取自 GET /saves/:id + save.stats 现算，禁写死。
    assert(truth.equipment.weapon && truth.equipment.armor,
      `F147: 新档应自动穿上配发武器/防具: ${JSON.stringify(truth.equipment)}`);
    assert(nums.攻击.base === expAtk(truth.save.stats, null),
      `攻击基础 ${nums.攻击.base} ≠ floor(${ATK_COEF}×${truth.save.stats.strength})`);
    assert(nums.防御.base === expDef(truth.save.stats, null),
      `防御基础 ${nums.防御.base} ≠ floor(0.8×${truth.save.stats.vitality})`);
    assert(nums.攻击.eq === truth.equipment.atk,
      `攻击装备加成 ${nums.攻击.eq} ≠ ${truth.equipment.atk}（配发武器）`);
    assert(nums.防御.eq === truth.equipment.def,
      `防御装备加成 ${nums.防御.eq} ≠ ${truth.equipment.def}（配发防具）`);
    assert(nums.攻击.total === nums.攻击.base + nums.攻击.eq,
      `攻击合计 ${nums.攻击.total} ≠ 基础${nums.攻击.base}+装备${nums.攻击.eq}`);
    assert(nums.防御.total === nums.防御.base + nums.防御.eq,
      `防御合计 ${nums.防御.total} ≠ 基础${nums.防御.base}+装备${nums.防御.eq}`);
    const eqCells0 = await page.evaluate(() =>
      [...document.querySelectorAll(".combat-nums-row")].map((row) => ({
        label: row.querySelector(".cn-label")?.textContent.trim(),
        eq: row.querySelector(".cn-eq")?.textContent.trim(),
      }))
    );
    const eqCell0 = (label) => (eqCells0.find((r) => r.label === label) || {}).eq;
    assert(eqCells0.length === 2, `战斗数值应有两行装备列，实测 ${eqCells0.length}`);
    assert(eqCell0("攻击") === `+${truth.equipment.atk}`,
      `攻击装备列应显示 +${truth.equipment.atk}: ${JSON.stringify(eqCells0)}`);
    assert(eqCell0("防御") === `+${truth.equipment.def}`,
      `防御装备列应显示 +${truth.equipment.def}: ${JSON.stringify(eqCells0)}`);

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, "f083-stats-panel.png") });
    await page.keyboard.press("Escape");
    await page.locator(".status").screenshot({ path: path.join(SHOT_DIR, "f083-statusbar.png") });

    // ── 2b) 空装备态：没有 unequip op——配发品在背包仅剩 1 件，走真实
    //     discard：qty 扣到 0 服务端 clearSlot 清空装备位（equipped 槽随
    //     物品消失而空）。先 GET 确认 weapon/armor 真为空，再刷新断言
    //     「未装备」与 合计=基础。
    const removed = {};
    for (const slot of ["weapon", "armor"]) {
      const itemId = truth.equipment[slot] && truth.equipment[slot].item_id;
      assert(itemId, `equipment.${slot} 应有配发装备可卸下: ${JSON.stringify(truth.equipment)}`);
      const rm = await api(`/saves/${saveId}/item`, {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, op: "discard" }),
      });
      assert(rm.status === 200, `discard ${slot}「${itemId}」failed (HTTP ${rm.status})`);
      removed[slot] = itemId;
    }
    truth = (await api(`/saves/${saveId}`)).body;
    assert(!truth.equipment.weapon && !truth.equipment.armor,
      `卸下后 equipment.weapon/armor 应为空: ${JSON.stringify(truth.equipment)}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status .status-nums");
    const topEmpty = await page.evaluate(() => {
      const stats = [...document.querySelectorAll(".status-nums .stat")];
      const pick = (label) => {
        const el = stats.find((s) => s.textContent.trim().startsWith(label));
        return el?.querySelector("b")?.textContent.trim() ?? null;
      };
      return { atk: pick("攻"), def: pick("防") };
    });
    assert(Number(topEmpty.atk) === expAtk(truth.save.stats, null),
      `空装备顶栏攻 ${topEmpty.atk} ≠ 基础 ${expAtk(truth.save.stats, null)}`);
    assert(Number(topEmpty.def) === expDef(truth.save.stats, null),
      `空装备顶栏防 ${topEmpty.def} ≠ 基础 ${expDef(truth.save.stats, null)}`);

    await page.locator('.btn-group-sys .btn', { hasText: "属性" }).click();
    await page.waitForSelector(".stat-panel .combat-nums");
    const numsEmpty = await readCombatNums(page);
    assert(numsEmpty.攻击 && numsEmpty.防御, "空装备时战斗数值段缺攻击或防御行");
    assert(numsEmpty.攻击.eq === 0 && numsEmpty.防御.eq === 0,
      `空装备时装备加成应为 0: ${JSON.stringify(numsEmpty)}`);
    assert(numsEmpty.攻击.total === expAtk(truth.save.stats, null),
      `空装备攻击合计 ${numsEmpty.攻击.total} ≠ 基础 ${expAtk(truth.save.stats, null)}`);
    assert(numsEmpty.防御.total === expDef(truth.save.stats, null),
      `空装备防御合计 ${numsEmpty.防御.total} ≠ 基础 ${expDef(truth.save.stats, null)}`);
    const eqCellsEmpty = await page.locator(".combat-nums .cn-eq").allInnerTexts();
    assert(eqCellsEmpty.length === 2,
      `战斗数值应有两行装备列，实测 ${eqCellsEmpty.length}: ${eqCellsEmpty}`);
    assert(eqCellsEmpty.every((t) => t.trim() === "未装备"),
      `空装备应显示「未装备」，实际 ${eqCellsEmpty}`);
    await page.keyboard.press("Escape");

    // ── 3) 重新装备武器 + 防具刷新：顶栏/面板攻防合计都随 equipment 更新 ──
    //     上面 discard 已把配发品从背包清掉——先按 DB 直插补回再 equip
    //     （combat-equip-gate 同款口径），equip 是真实的空槽→落位迁移。
    {
      const Database = createRequire(import.meta.url)("better-sqlite3");
      const dbPath =
        process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
      const db = new Database(dbPath);
      const addInv = db.prepare(
        "INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, 1) " +
          "ON CONFLICT(save_id, item_id) DO UPDATE SET qty = qty + 1"
      );
      addInv.run(saveId, removed.weapon);
      addInv.run(saveId, removed.armor);
      db.close();
    }
    for (const itemId of [removed.weapon, removed.armor]) {
      const eq = await api(`/saves/${saveId}/item`, {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, op: "equip" }),
      });
      assert(eq.status === 200, `equip ${itemId} failed (HTTP ${eq.status})`);
    }
    truth = (await api(`/saves/${saveId}`)).body;
    assert(truth.equipment.atk > 0 && truth.equipment.def > 0,
      `装备后应有 atk/def 加成: ${JSON.stringify(truth.equipment)}`);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status .status-nums");

    const top2 = await page.evaluate(() => {
      const stats = [...document.querySelectorAll(".status-nums .stat")];
      const pick = (label) => {
        const el = stats.find((s) => s.textContent.trim().startsWith(label));
        return el?.querySelector("b")?.textContent.trim() ?? null;
      };
      return { atk: pick("攻"), def: pick("防") };
    });
    assert(Number(top2.atk) === expAtk(truth.save.stats, truth.equipment),
      `装备后顶栏攻 ${top2.atk} ≠ 期望 ${expAtk(truth.save.stats, truth.equipment)}`);
    assert(Number(top2.def) === expDef(truth.save.stats, truth.equipment),
      `装备后顶栏防 ${top2.def} ≠ 期望 ${expDef(truth.save.stats, truth.equipment)}`);

    await page.locator('.btn-group-sys .btn', { hasText: "属性" }).click();
    await page.waitForSelector(".stat-panel .combat-nums");
    nums = await readCombatNums(page);
    assert(nums.攻击.total === expAtk(truth.save.stats, truth.equipment),
      `装备后攻击合计 ${nums.攻击.total} ≠ 期望 ${expAtk(truth.save.stats, truth.equipment)}`);
    assert(nums.防御.total === expDef(truth.save.stats, truth.equipment),
      `装备后防御合计 ${nums.防御.total} ≠ 期望 ${expDef(truth.save.stats, truth.equipment)}`);
    assert(nums.攻击.eq === truth.equipment.atk, `装备加成应为 ${truth.equipment.atk}，实际 ${nums.攻击.eq}`);
    assert(nums.防御.eq === truth.equipment.def, `防具加成应为 ${truth.equipment.def}，实际 ${nums.防御.eq}`);
    const eqCells2 = await page.locator(".combat-nums .cn-eq").allInnerTexts();
    assert(eqCells2.length === 2, `战斗数值应有两行装备列，实测 ${eqCells2.length}: ${eqCells2}`);
    assert(eqCells2.some((t) => t.trim() === `+${truth.equipment.atk}`), `装备列缺 +${truth.equipment.atk}: ${eqCells2}`);
    assert(eqCells2.some((t) => t.trim() === `+${truth.equipment.def}`), `装备列缺 +${truth.equipment.def}: ${eqCells2}`);

    // ── 4) 移动端四宽度：数字不被挤到第二行，header ≤142px ──
    await page.keyboard.press("Escape"); // 收起属性抽屉，否则 fixed 抽屉盖住 .status 截图
    const report = [];
    for (const w of [360, 375, 390, 414]) {
      const r = await assertMobileBar(page, w);
      report.push(`${w}px: ${r.stats.length}项全同行 header=${r.headerH}px`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".status").screenshot({ path: path.join(SHOT_DIR, "f083-statusbar-390.png") });

    // ── 5) 负向：数值单元格无 NaN / undefined / +0 ──
    await checkNoPlaceholders(page);

    console.log(`[ASSERT] atk-def-visible OK save=${saveId} 攻${nums.攻击.total} 防${nums.防御.total} | ${report.join(" | ")}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => fail(e.stack || e.message));
