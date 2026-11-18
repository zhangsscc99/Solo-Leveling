#!/usr/bin/env node
// F214 contract: 390×844 下顶栏经验徽记 .stat.stat-xp（数值 + .xp-bar
// 进度条）完整落在视口内，无横向溢出；1440×900 桌面 XP 仍在视口内
// 零回归。
//   - .stat.stat-xp rect：right <= innerWidth、left >= 0、宽高 > 0；
//   - .stat-xp .xp-bar rect：同口径完整在视口内；
//   - .stat-xp 文本含数字；
//   - .status scrollWidth <= clientWidth + 1（顶栏自身不横滚）；
//   - 1440×900：.stat.stat-xp 存在、宽高 > 0、right <= innerWidth。
// BASE 默认 https://openfolio.uk/game，用 E2E_BASE_URL / API_BASE 覆盖。
// 失败打印 step= 与实测数值并截图 /root/logs/e2e-F214-*.png，exit 1。
import fs from "node:fs";
import { loadPW, findChrome } from "../e2e/lib.mjs";

const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
const API = process.env.API_BASE || `${BASE}/api`;
const NAME = `F214-${Date.now().toString(36)}`.slice(0, 20);

let page = null;
async function fail(step, detail) {
  let shot = "";
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    shot = `/root/logs/e2e-F214-${Date.now()}.png`;
    if (page) await page.screenshot({ path: shot, fullPage: true });
  } catch {
    shot = "";
  }
  console.error(`[ASSERT] FAIL step=${step} ${detail}${shot ? ` screenshot=${shot}` : ""}`);
  process.exit(1);
}
function assert(cond, step, detail) {
  if (!cond) return fail(step, detail);
}

async function api(pathname, init) {
  const res = await fetch(`${API}${pathname}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

async function measure() {
  return page.evaluate(() => {
    const cell = document.querySelector(".status-nums .stat-xp");
    const bar = document.querySelector(".stat-xp .xp-bar");
    const status = document.querySelector(".status");
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width, height: b.height };
    };
    return {
      vw: window.innerWidth,
      cell: r(cell),
      bar: r(bar),
      text: cell ? cell.textContent.trim() : null,
      status: status
        ? { scrollWidth: status.scrollWidth, clientWidth: status.clientWidth }
        : null,
    };
  });
}

function checkVisible(m, tag) {
  assert(m.cell, `${tag}/stat-xp`, `.status-nums .stat-xp 缺失`);
  const c = m.cell;
  assert(
    c.width > 0 && c.height > 0 && c.left >= 0 && c.right <= m.vw,
    `${tag}/stat-xp`,
    `rect left=${c.left.toFixed(1)} right=${c.right.toFixed(1)} w=${c.width.toFixed(1)} h=${c.height.toFixed(1)} vw=${m.vw}`
  );
  assert(m.bar, `${tag}/xp-bar`, `.stat-xp .xp-bar 缺失`);
  const b = m.bar;
  assert(
    b.width > 0 && b.height > 0 && b.left >= 0 && b.right <= m.vw,
    `${tag}/xp-bar`,
    `rect left=${b.left.toFixed(1)} right=${b.right.toFixed(1)} w=${b.width.toFixed(1)} h=${b.height.toFixed(1)} vw=${m.vw}`
  );
  assert(/\d/.test(m.text || ""), `${tag}/xp-num`, `.stat-xp 文本无数字: ${JSON.stringify(m.text)}`);
}

async function main() {
  const created = await api("/saves", {
    method: "POST",
    body: JSON.stringify({ player_name: NAME }),
  });
  assert(created.status === 201 && created.body?.save?.id, "create-save",
    `HTTP ${created.status} body=${JSON.stringify(created.body)}`);
  const saveId = created.body.save.id;

  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
    await ctx.addInitScript((id) => localStorage.setItem("solo_leveling_save_id", String(id)), saveId);
    page = await ctx.newPage();
    page.setDefaultTimeout(20000);

    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status .status-nums");
    await page.waitForSelector(".stat-xp .xp-bar", { state: "attached" });

    const m390 = await measure();
    checkVisible(m390, "390x844");
    assert(
      m390.status && m390.status.scrollWidth <= m390.status.clientWidth + 1,
      "390x844/status-overflow",
      `.status scrollWidth=${m390.status?.scrollWidth} clientWidth=${m390.status?.clientWidth}`
    );
    console.log(
      `[ASSERT] 390x844: stat-xp left=${m390.cell.left.toFixed(1)} right=${m390.cell.right.toFixed(1)} | ` +
        `xp-bar left=${m390.bar.left.toFixed(1)} right=${m390.bar.right.toFixed(1)} | ` +
        `status scroll ${m390.status.scrollWidth}/${m390.status.clientWidth}`
    );

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector(".status .status-nums");
    const m1440 = await measure();
    assert(m1440.cell && m1440.cell.width > 0 && m1440.cell.height > 0 && m1440.cell.right <= m1440.vw,
      "1440x900/stat-xp",
      `rect=${JSON.stringify(m1440.cell)} vw=${m1440.vw}`);
    console.log(
      `[ASSERT] 1440x900: stat-xp left=${m1440.cell.left.toFixed(1)} right=${m1440.cell.right.toFixed(1)}`
    );
  } finally {
    await browser.close().catch(() => {});
  }
  console.log("[ASSERT] F214 mobile-xp-visible: PASS");
}

main().catch((e) => fail("exception", e.stack || String(e)));
