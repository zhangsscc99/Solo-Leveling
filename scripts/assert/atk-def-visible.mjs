#!/usr/bin/env node
// F083 contract: 顶栏与属性面板显示含装备加成的 攻/防。
//   1. 顶栏 .status-nums 同时出现「攻」「防」标签，数值为纯数字；
//   2. 属性抽屉有「战斗数值」段，攻击/防御合计 = floor(系数×属性) + 装备加成，
//      真值取自 GET /api/saves/:id（容差 0）；装备为空时显示「无配发装备」；
//   3. 装备武器刷新后数值随 equipment 更新；
//   4. 负向：页面无 NaN / undefined / +0 裸占位。
// 折算系数与 server/engine/stats.js 保持一致（atk=1.6×力量, def=0.8×体力）。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const BASE_URL = (process.env.BASE_URL || "http://127.0.0.1:3097/game").replace(/\/+$/, "");
const API = `${BASE_URL}/api`;
const SHOT_DIR = "/www/hermes-home/cache/scratch";

function fail(msg) {
  console.error(`[ASSERT] ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

function loadPW() {
  for (const dir of [path.join(ROOT, "scripts", "e2e"), ROOT, "/www/fable5_project", "/tmp"]) {
    try {
      return createRequire(path.join(dir, "noop.js"))("playwright-core");
    } catch {}
  }
  fail("playwright-core not found");
}
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = "/root/.cache/ms-playwright";
  for (const d of fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const p = path.join(base, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  fail("no chromium binary");
}

async function api(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// 镜像 client api.ts：floor(1.6×str)+eq.atk / floor(0.8×vit)+eq.def（容差 0）。
const expAtk = (s, eq) => Math.floor(s.strength * 1.6) + (eq?.atk ?? 0);
const expDef = (s, eq) => Math.floor(s.vitality * 0.8) + (eq?.def ?? 0);

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
  // 只查状态栏与档案侧栏：stage 日志是服务端原文（如「防御 +0」播报），不在本契约内。
  const text = await page.evaluate(() =>
    [".status", ".sidebar"].map((s) => document.querySelector(s)?.innerText || "").join("\n"));
  for (const bad of ["NaN", "undefined", "+0"]) {
    assert(!text.includes(bad), `状态栏/属性面板出现裸占位文本 ${JSON.stringify(bad)}`);
  }
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
      `攻击合计 ${nums.攻击.total} ≠ floor(1.6×${truth.save.stats.strength})+${truth.equipment.atk}`);
    assert(nums.防御.total === expDef(truth.save.stats, truth.equipment),
      `防御合计 ${nums.防御.total} ≠ floor(0.8×${truth.save.stats.vitality})+${truth.equipment.def}`);
    assert(Number(top.atk) === nums.攻击.total, `顶栏攻 ${top.atk} ≠ 面板合计 ${nums.攻击.total}`);
    assert(Number(top.def) === nums.防御.total, `顶栏防 ${top.def} ≠ 面板合计 ${nums.防御.total}`);

    // 新存档未装备任何物品 → 装备列应为「无配发装备」而非 +0。
    const eqCells = await page.locator(".combat-nums .cn-eq").allInnerTexts();
    assert(eqCells.every((t) => t.includes("无配发装备")), `空装备应显示「无配发装备」，实际 ${eqCells}`);

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, "f083-stats-panel.png") });
    await page.keyboard.press("Escape");
    await page.locator(".status").screenshot({ path: path.join(SHOT_DIR, "f083-statusbar.png") });

    // ── 3) 装备武器后刷新：数值随 equipment 更新 ──
    const eq = await api(`/saves/${saveId}/item`, {
      method: "POST",
      body: JSON.stringify({ item_id: "rusty_hunting_knife", op: "equip" }),
    });
    assert(eq.status === 200 && eq.body?.equipment?.atk > 0, `equip failed (HTTP ${eq.status})`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status .status-nums");
    await page.waitForSelector(".actions .btn-group-sys .btn");
    await page.locator('.btn-group-sys .btn', { hasText: "属性" }).click();
    await page.waitForSelector(".stat-panel .combat-nums");

    truth = (await api(`/saves/${saveId}`)).body;
    nums = await readCombatNums(page);
    assert(nums.攻击.total === expAtk(truth.save.stats, truth.equipment),
      `装备后攻击合计 ${nums.攻击.total} ≠ 期望 ${expAtk(truth.save.stats, truth.equipment)}`);
    assert(nums.攻击.eq === truth.equipment.atk, `装备加成应为 ${truth.equipment.atk}，实际 ${nums.攻击.eq}`);
    const eqCells2 = await page.locator(".combat-nums .cn-eq").allInnerTexts();
    assert(eqCells2.some((t) => t.trim() === `+${truth.equipment.atk}`), `装备列缺 +${truth.equipment.atk}: ${eqCells2}`);

    // ── 4) 负向：无 NaN / undefined / +0 ──
    await checkNoPlaceholders(page);

    console.log(`[ASSERT] atk-def-visible OK save=${saveId} 攻${nums.攻击.total} 防${nums.防御.total}`);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => fail(e.stack || e.message));
