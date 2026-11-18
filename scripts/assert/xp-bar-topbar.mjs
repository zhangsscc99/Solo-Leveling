#!/usr/bin/env node
// P208 contract: 顶栏 XP 旁出现极细进度条 .xp-bar/.xp-bar-fill。
//   a) 轨道宽 ≤56px，填充宽度比 ≈ save.xp/save.xp_to_next（容差 ±3%，
//      真值取 GET /api/saves/:id，前端不推算等级曲线）；
//   b) title 与 aria-label 同含「经验 {xp}/{xp_to_next}」与
//      「距 Lv.{level+1} 还需 {xp_to_next-xp}」；
//   c) 刷新后逐项一致（React 随 save 状态自然重渲染，无本地缓存副本）；
//   d) 390×844：header 高 ≤142px、无横向溢出（scrollWidth ≤ clientWidth）、
//      XP 单元格与同行其它 .stat 同一行；
//   e) 负向：元素缺失或轨道 >56px 直接 FAIL。
// BASE 默认 http://127.0.0.1:3020/game，用 E2E_BASE_URL 覆盖。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPW, findChrome } from "../e2e/lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE_URL = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE_URL;
const API = `${BASE_URL}/api`;
const SHOT_DIR = "/www/hermes-home/cache/scratch";

function fail(msg) {
  console.error(`[ASSERT] FAIL ${msg}`);
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

async function measure(page) {
  return page.evaluate(() => {
    const cell = document.querySelector(".status-nums .stat-xp");
    const track = document.querySelector(".xp-bar");
    const fill = document.querySelector(".xp-bar-fill");
    if (!cell || !track || !fill) return null;
    const tr = track.getBoundingClientRect();
    const fr = fill.getBoundingClientRect();
    const cr = cell.getBoundingClientRect();
    const stats = [...document.querySelectorAll(".status-nums .stat")].map((el) => ({
      text: el.textContent.trim(),
      top: Math.round(el.getBoundingClientRect().top),
      isXp: el === cell,
    }));
    const header = document.querySelector(".status").getBoundingClientRect();
    return {
      title: cell.getAttribute("title") || "",
      aria: cell.getAttribute("aria-label") || "",
      trackW: tr.width,
      fillW: fr.width,
      cellTop: Math.round(cr.top),
      stats,
      headerH: Math.round(header.height),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

function checkXpBar(m, truth, tag) {
  assert(m, `${tag}: 缺 .xp-bar / .xp-bar-fill`);
  assert(m.trackW > 0 && m.trackW <= 56, `${tag}: 轨道宽 ${m.trackW.toFixed(1)}px 超出 ≤56px`);
  const expect = truth.xp_to_next > 0 ? truth.xp / truth.xp_to_next : 0;
  const actual = m.trackW > 0 ? m.fillW / m.trackW : -1;
  assert(
    Math.abs(actual - expect) <= 0.03,
    `${tag}: 填充比 ${(actual * 100).toFixed(1)}% ≠ 经验比 ${(expect * 100).toFixed(1)}%（±3%）`
  );
  const s1 = `经验 ${truth.xp}/${truth.xp_to_next}`;
  const s2 = `距 Lv.${truth.level + 1} 还需 ${Math.max(0, truth.xp_to_next - truth.xp)}`;
  for (const [name, v] of [["title", m.title], ["aria-label", m.aria]]) {
    assert(v.includes(s1), `${tag}: ${name} 缺「${s1}」: ${JSON.stringify(v)}`);
    assert(v.includes(s2), `${tag}: ${name} 缺「${s2}」: ${JSON.stringify(v)}`);
  }
}

async function main() {
  const created = await api("/saves", {
    method: "POST",
    body: JSON.stringify({ player_name: `p208-${Date.now().toString(36)}` }),
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
    await page.waitForSelector(".xp-bar .xp-bar-fill", { state: "attached" });

    const truth = (await api(`/saves/${saveId}`)).body.save;
    assert(typeof truth.xp === "number" && typeof truth.xp_to_next === "number",
      `存档缺 xp/xp_to_next: ${JSON.stringify({ xp: truth.xp, xp_to_next: truth.xp_to_next })}`);

    // a)+b) 桌面视口：宽度、填充比、文案
    checkXpBar(await measure(page), truth, "1440px");

    // c) 刷新后逐项一致
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".xp-bar .xp-bar-fill", { state: "attached" });
    const truth2 = (await api(`/saves/${saveId}`)).body.save;
    checkXpBar(await measure(page), truth2, "刷新后");

    // d) 390×844 视口：header 高度、横向溢出、XP 与同行 .stat 同排
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForSelector(".status .status-nums");
    const m390 = await measure(page);
    checkXpBar(m390, truth2, "390px");
    assert(m390.headerH <= 142, `@390 header 高 ${m390.headerH}px > 142px`);
    assert(m390.overflow <= 0, `@390 横向溢出 ${m390.overflow}px`);
    const rowMates = m390.stats.filter((s) => !s.isXp && Math.abs(s.top - m390.cellTop) < 3);
    assert(rowMates.length > 0, `@390 XP 单元格未与任何 .stat 同行: ${JSON.stringify(m390.stats)}`);

    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.locator(".status").screenshot({ path: path.join(SHOT_DIR, "p208-xp-bar.png") });
  } finally {
    await browser.close();
  }
  console.log("[ASSERT] P208 顶栏 XP 进度条: PASS");
}

main().catch((e) => fail(e.stack || String(e)));
