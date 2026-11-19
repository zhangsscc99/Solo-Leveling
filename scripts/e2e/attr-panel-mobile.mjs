#!/usr/bin/env node
// attr-panel-mobile.mjs (F283 + F291): 390×844 属性面板的「一屏放下 / 数值
// 贴右 / 辅助文字可读」三条硬契约。
//
//   第 91 轮走查实测：属性面板一屏放下、无需内滚、主数值对齐良好（F283 主
//   症状已消），但三类**辅助文案**（「升级可获得属性点」/「基础·装备·合计」
//   表头 / 「距离 Lv.N 还需 M 经验」）`font-size: 11px` + `color: #46576f`，
//   对面板底（--hull #0c1524）实测对比 **2.48:1**，强光手机屏上几乎读不出。
//   game-detail-bar §9b（手机辅助文字下限 12px）/ §9d（正文对比 ≥4.5:1）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 全部置空；显式传
//   E2E_BASE_URL 时跳过自举，与 mobile.mjs / attr-plus-disabled.mjs 同口径），
//   干净 localStorage 建档 → 打开抽屉 → 点「属性」→ 断言：
//     a) 抽屉开、面板名「属性」、力量/敏捷/体力三行同时可见；
//     b) 无内滚：.side-scroll 与 .stat-panel 的 scrollHeight ≤ clientHeight+2；
//     c) 每行最右元素右缘距面板内容右内缘 ≤ 24px（数值不与标签断开）；
//     d) 「升级可获得属性点」右缘距面板内容右内缘 ≥ 8px（不贴边）；
//     e) F291：三类辅助文案 fontSize ≥ 12 且与有效背景对比 ≥ 4.5:1；
//   失败逐条打印 [ASSERT] 并 exit 1；确定性（无随机），连跑 2 次同结果。
//
//   旧码红证（未改 client/src/styles.css 时直接跑本脚本）：
//     [ASSERT] e) 「升级可获得属性点」字号 11px < 12px
//     [ASSERT] e) 「升级可获得属性点」对比 2.48:1 < 4.5:1（前景 #46576f / 背景 #0c1524）
//     [ASSERT] e) 「基础/装备/合计」表头字号 11px < 12px；对比 2.48:1 < 4.5:1
//     [ASSERT] e) 「距离 Lv.2 还需 N 经验」字号 11px < 12px；对比 2.48:1 < 4.5:1
//   修复后连跑 2 次 PASS、exit=0。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

function newestMtime(dir) {
  let newest = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) newest = Math.max(newest, newestMtime(p));
    else newest = Math.max(newest, fs.statSync(p).mtimeMs);
  }
  return newest;
}

if (!process.env.E2E_BASE_URL) {
  // 前端由 server 以 client/dist 静态托管：dist 缺失或比 client/src 旧
  // （改了样式没重建）时先补构建，否则断言跑的是上一版 CSS。
  const distIndex = path.join(ROOT, "client", "dist", "index.html");
  const stale =
    !fs.existsSync(distIndex) || fs.statSync(distIndex).mtimeMs < newestMtime(path.join(ROOT, "client", "src"));
  if (stale) {
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_CHANNEL_FD;
    delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
    const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: buildEnv,
    });
    if (b.status !== 0) {
      console.error("[E2E] attr-panel-mobile: client/dist 过期且构建失败");
      process.exit(1);
    }
  }

  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f291-"));
  const env = {
    ...process.env,
    PORT: String(port),
    DB_PATH: path.join(tmpDir, "game.db"),
    OPENCODE_GO_API_KEY: "",
    OPENCODE_GO_BASE_URL: "",
    AI_ALIYUN_API_KEY: "",
    AI_ALIYUN_BASE_URL: "",
    AI_ALIYUN_MODEL: "",
  };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));
  process.on("exit", () => {
    try {
      child.kill("SIGKILL");
    } catch {}
  });

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/game/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[E2E] attr-panel-mobile: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
  // E2E_BASE_URL 须在 lib.mjs 求值前落定。
  process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
}

const { loadPW, findChrome } = await import("./lib.mjs");

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`[ASSERT] ${msg}`);
  }
}

const pw = loadPW();
const browser = await pw.chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});

try {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");
  await page.fill(".gate-form input", `f291-${Date.now() % 100000}`);
  await page.click(".gate-form button[type=submit]");
  await page.waitForSelector(".status");

  // 开抽屉 → 点「属性」系统键（走真实触点，不直接调 openTab）。
  const attrBtn = page.locator(".btn-group-sys .btn", { hasText: "属性" }).first();
  await attrBtn.tap();
  await page.waitForSelector("aside.sidebar.open");
  await page.waitForSelector(".stat-panel");
  await page.waitForTimeout(300); // 0.2s 滑入过渡

  const state = await page.evaluate(() => {
    const parse = (s) => {
      const m = /rgba?\(([^)]+)\)/.exec(s || "");
      if (!m) return null;
      const p = m[1].split(",").map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lin = (c) => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const lum = (rgb) => 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
    const effectiveBg = (el) => {
      let n = el;
      while (n) {
        const bg = parse(getComputedStyle(n).backgroundColor);
        if (bg && bg.a > 0.9) return bg;
        n = n.parentElement;
      }
      return { r: 6, g: 11, b: 20, a: 1 };
    };
    const ratio = (a, b) => {
      const l1 = lum(a);
      const l2 = lum(b);
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    };
    const hex = (c) =>
      "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

    const side = document.querySelector("aside.sidebar");
    const scroll = document.querySelector(".side-scroll");
    const panel = document.querySelector(".stat-panel");
    const title = document.querySelector(".side-title .cur");
    const pr = panel.getBoundingClientRect();
    const cs = getComputedStyle(panel);
    const padR = parseFloat(cs.paddingRight) || 0;
    const contentRight = pr.right - padR;

    const rows = [...panel.querySelectorAll(".stat-line")].map((row) => {
      const kids = [...row.children];
      const rightmost = kids.reduce((acc, k) => {
        const r = k.getBoundingClientRect();
        return Math.max(acc, r.right);
      }, 0);
      const label = row.querySelector(".stat-line-label");
      return {
        label: label ? label.textContent.trim() : "",
        rightGap: +(contentRight - rightmost).toFixed(1),
      };
    });

    const helper = (el, name) => {
      if (!el) return { name, found: false };
      const c = getComputedStyle(el);
      const fg = parse(c.color) || { r: 0, g: 0, b: 0, a: 1 };
      const bg = effectiveBg(el);
      return {
        name,
        found: true,
        text: (el.textContent || "").trim().slice(0, 24),
        fontSize: parseFloat(c.fontSize),
        contrast: +ratio(fg, bg).toFixed(2),
        fg: hex(fg),
        bg: hex(bg),
      };
    };

    const pointsHint = document.querySelector(".stat-points-hint");
    const colsHead = document.querySelector(".combat-nums-cols");
    const xpHint = document.querySelector(".stat-xp-hint");
    const colsEl = colsHead ? colsHead.querySelector("span:not(:empty)") || colsHead : null;

    return {
      open: side.classList.contains("open"),
      cur: title ? title.textContent.trim() : null,
      hasStats: ["力量", "敏捷", "体力"].every((t) => panel.innerText.includes(t)),
      scrollOverflow: scroll ? scroll.scrollHeight - scroll.clientHeight : -1,
      panelOverflow: panel.scrollHeight - panel.clientHeight,
      contentRightGap: +(contentRight - (pr.right - padR)).toFixed(1),
      rows,
      pointsHintGap: pointsHint ? +(contentRight - pointsHint.getBoundingClientRect().right).toFixed(1) : null,
      helpers: [
        helper(pointsHint, "升级可获得属性点"),
        helper(colsEl, "基础/装备/合计"),
        helper(xpHint, "距离 Lv.2 还需 N 经验"),
      ],
    };
  });

  check(state.open, "a) 抽屉未打开");
  check(state.cur === "属性", `a) 面板名不是属性：${state.cur}`);
  check(state.hasStats, "a) 属性页特征行（力量/敏捷/体力）不同时可见");
  check(state.scrollOverflow <= 2, `b) .side-scroll 出现内滚：溢出 ${state.scrollOverflow}px`);
  check(state.panelOverflow <= 2, `b) .stat-panel 内容超出：溢出 ${state.panelOverflow}px`);
  for (const r of state.rows) {
    check(r.rightGap <= 24, `c) ${r.label} 行数值距面板右内缘 ${r.rightGap}px > 24px`);
  }
  check(
    state.pointsHintGap !== null && state.pointsHintGap >= 8,
    `d) 「升级可获得属性点」距面板右内缘 ${state.pointsHintGap}px < 8px`
  );
  for (const h of state.helpers) {
    check(h.found, `e) ${h.name} 节点不存在`);
    if (!h.found) continue;
    check(h.fontSize >= 12, `e) 「${h.name}」字号 ${h.fontSize}px < 12px`);
    check(
      h.contrast >= 4.5,
      `e) 「${h.name}」对比 ${h.contrast}:1 < 4.5:1（前景 ${h.fg} / 背景 ${h.bg}）`
    );
  }

  if (process.env.E2E_VERBOSE) console.log(JSON.stringify(state, null, 2));
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`[E2E] attr-panel-mobile: ${failures} 项断言失败`);
  process.exit(1);
}
console.log("[E2E] attr-panel-mobile PASS（属性面板 390×844：无内滚 / 数值贴右 / 辅助文字 ≥12px 且 ≥4.5:1）");
process.exit(0);
