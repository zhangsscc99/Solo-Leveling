#!/usr/bin/env node
// Shared helpers for the Solo Leveling E2E gate.
// Uses playwright-core + the pre-installed chromium binary (no browser download).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

export const BASE_URL = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");

export function loadPW() {
  const candidates = [
    HERE, // scripts/e2e/node_modules (primary, pinned dep)
    ROOT, // repo root node_modules
    "/tmp",
    "/root/.hermes/cache/scratch/shot",
  ];
  if (process.env.PW_NODE_PATH) candidates.unshift(process.env.PW_NODE_PATH);
  const errs = [];
  for (const dir of candidates) {
    try {
      return createRequire(path.join(dir, "noop.js"))("playwright-core");
    } catch (e) {
      errs.push(`${dir}: ${e.code || e.message}`);
    }
  }
  throw new Error(`playwright-core not found (${errs.join("; ")})`);
}

export function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const base = "/root/.cache/ms-playwright";
  for (const d of fs
    .readdirSync(base)
    .filter((d) => /^chromium-\d+$/.test(d))
    .sort()
    .reverse()) {
    const p = path.join(base, d, "chrome-linux", "chrome");
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`no chromium binary under ${base}`);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(`assert failed: ${msg}`);
}

export async function launch() {
  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  return browser;
}

// run(name, fn, opts): launches a browser, hands fn a page, screenshots on
// failure to /root/logs/e2e-<name>-<ts>.png, exits 0/1.
export async function run(name, fn, opts = {}) {
  const t0 = Date.now();
  const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let browser = null;
  let page = null;
  let err = null;
  try {
    browser = await launch();
    const ctx = await browser.newContext({
      viewport: opts.viewport || { width: 1440, height: 900 },
      locale: "zh-CN",
      ...(opts.context || {}),
    });
    page = await ctx.newPage();
    page.setDefaultTimeout(opts.timeoutMs || 20000);
    await fn({ page, ctx });
  } catch (e) {
    err = e;
  }
  if (err) {
    let shot = "";
    try {
      fs.mkdirSync("/root/logs", { recursive: true });
      shot = `/root/logs/e2e-${name}-${Date.now()}.png`;
      if (page) await page.screenshot({ path: shot, fullPage: true });
    } catch {
      shot = "";
    }
    console.log(`[E2E] ${name} FAIL (${elapsed()}) ${err.message}${shot ? ` screenshot=${shot}` : ""}`);
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
  console.log(`[E2E] ${name} PASS (${elapsed()})`);
  if (browser) await browser.close().catch(() => {});
  process.exit(0);
}

// createSave: open gate, register a hunter name, wait for the main UI.
export async function createSave(page, name) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");
  await page.fill(".gate-form input", name);
  await page.click(".gate-form button[type=submit]");
  await page.waitForSelector(".status");
  return name;
}

// F247：must_choose 下「探索前进」按钮 disabled——同一条指令改由
// 自由输入框发出（与 dispatch 的 F231 路径同口径）。
export async function sendAdvance(page) {
  await page.fill(".input-row input", "前进");
  await page.press(".input-row input", "Enter");
}

// 「探索前进」行动键 locator——用于断言其 disabled/可见状态，不要直接点。
export function advanceButton(page) {
  return page.locator(".actions-main .btn", { hasText: "探索前进" }).first();
}

export async function stageCount(page) {
  return page.locator(".stage-col > *").count();
}

export async function readVitals(page) {
  const read = async (sel) => {
    const t = (await page.locator(sel).innerText()).trim();
    const m = t.match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { v: Number(m[1]), max: Number(m[2]) } : null;
  };
  return { hp: await read(".status .gauge-hp .gauge-num"), mp: await read(".status .gauge-mp .gauge-num") };
}
