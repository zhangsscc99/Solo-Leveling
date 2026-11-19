#!/usr/bin/env node
// latest-entry-visible.mjs (F261): 正文「最新一条」高亮可辨 + 日志容器
// 底部不硬切，双视口（390×844 / 1440×900）硬契约。
//
//   第 54 轮走查实测：F252 给的 3px --system-dim 左轨 +
//   rgba(79,200,255,.05) 底色在 390 高 DPR 屏上「基本不能分辨这一次
//   新增了什么」；.log 底缘对末行硬切（无渐隐/无滚动提示）会被误读成
//   文字被遮挡。
//
//   ΔRGB 定义（防歧义）：先把两条 .log-entry 的 computedStyle
//   backgroundColor 各自沿祖先链向下跌代合成到 --abyss #060b14 基底
//   （alpha<1 的颜色不是最终呈色，直接比通道会把 5% alpha 误判成
//   Δ=534）；ΔRGB = 合成后两色的 |ΔR| + |ΔG| + |ΔB|。
//
//   断言：
//     ① 高亮可辨：[data-latest="1"] 的 borderLeftWidth ≥ 6px，
//        且其底色与上一条 .log-entry 的 ΔRGB ≥ 18；
//     ② 入场动效：[data-latest="1"] 的 animationName !== "none"
//        （现码已满足，断言保留防回退）；
//     ③ 底部不硬切（双态核查）：
//        - 停顶（scrollTop=0，未到底）：.stage 内的渐隐提示元素
//          （.log-scroll-hint / [data-scroll-hint]）可见且其矩形落在
//          .log 底缘 24px 带内；或 .log scrollHeight <= clientHeight+2；
//        - 滚到底（scrollTop=scrollHeight）：同口径，到底后提示按
//          F262/F277 口径收起属正确行为——此时验收「到底态不把末行
//          溶进渐隐带」落实为：末条 .log-entry 底缘落在 .log client
//          底缘之内且 .log 上无 edge-fade 遮罩压在末行上。
//        ③ 现码已满足（F262 hint + F277 data-edge-fade 机制），断言
//        保留防回退，本任务不改 App.tsx。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 全部置空；client/dist
//   缺失或比 client/src 旧时先 npm --prefix client run build；显式传
//   E2E_BASE_URL 时跳过自举直连，与 attr-panel-mobile.mjs 同口径）。
//   干净 localStorage 建档 → 自由输入框连发 3 次「观察」（指令形态走
//   /action，连发最稳；与「环顾四周」键同口径），waitForResponse +
//   waitForFunction(.pending 消失) 有界等待，无固定 sleep 竞态。
//   失败逐条打印 [ASSERT] 并 exit 1；PASS 打印 [PASS] 并 exit 0。
//   确定性：无随机、无共享状态，连跑 2 次同结果。
//
//   旧码红证（styles.css 未改时直接跑本脚本）：
//     [ASSERT] ① 390x844: 最新条 borderLeftWidth 3px < 6px
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

let child = null;
let tmpDir = null;
if (!process.env.E2E_BASE_URL) {
  // 前端由 server 以 client/dist 静态托管：dist 缺失或比 client/src 旧
  // （改了样式没重建）时先补构建，否则断言跑的是上一版 CSS。
  const distIndex = path.join(ROOT, "client", "dist", "index.html");
  const stale =
    !fs.existsSync(distIndex) ||
    fs.statSync(distIndex).mtimeMs < newestMtime(path.join(ROOT, "client", "src"));
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
      console.error("[E2E] latest-entry-visible: client/dist 过期且构建失败");
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f261-"));
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
  child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));
  process.on("exit", () => {
    try {
      child && child.kill("SIGKILL");
    } catch {}
    try {
      tmpDir && fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/game/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(
      `[E2E] latest-entry-visible: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
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

const ACTIONS = 3;
const VIEWPORTS = [
  { w: 390, h: 844, tag: "390x844", mobile: true },
  { w: 1440, h: 900, tag: "1440x900", mobile: false },
];

try {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      viewport: { width: vp.w, height: vp.h },
      ...(vp.mobile ? { hasTouch: true, isMobile: true } : {}),
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const waitIdle = () =>
      page.waitForFunction(() => !document.querySelector(".pending"));

    await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gate-form input");
    await page.fill(".gate-form input", `f261-${vp.tag}-${Date.now() % 100000}`);
    await page.click(".gate-form button[type=submit]");
    await page.waitForSelector(".status");
    await waitIdle();

    // 连做 3 次动作（「观察」指令与「环顾四周」键同口径走 /action）。
    for (let i = 1; i <= ACTIONS; i++) {
      const respP = page.waitForResponse(
        (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
        { timeout: 8000 }
      );
      await page.fill(".input-row input", "观察");
      await page.press(".input-row input", "Enter");
      await respP.then((r) => r.finished().catch(() => {}));
      await waitIdle();
    }
    // 等入场动画（240ms）落定再取 computedStyle——动画中的中间帧会
    // 污染读数；有界等待即可（动画时长恒定，无竞态）。
    await page.waitForTimeout(500);

    // ── ①② 最新条样式取证：一次 evaluate 拿全，逐条 check ──
    const m = await page.evaluate(() => {
      const parse = (s) => {
        const m = /rgba?\(([^)]+)\)/.exec(s || "");
        if (!m) return null;
        const p = m[1].split(",").map((x) => parseFloat(x));
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      };
      // 沿祖先链把各层 backgroundColor 依序合成到 --abyss #060b14 基底，
      // 得「最终呈色」。ΔRGB = 两色 |ΔR|+|ΔG|+|ΔB|。
      const effColor = (el) => {
        let base = { r: 6, g: 11, b: 20, a: 1 };
        const layers = [];
        let n = el;
        while (n) {
          const c = parse(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0) layers.unshift(c);
          n = n.parentElement;
        }
        for (const l of layers) {
          base = {
            r: l.r * l.a + base.r * (1 - l.a),
            g: l.g * l.a + base.g * (1 - l.a),
            b: l.b * l.a + base.b * (1 - l.a),
            a: 1,
          };
        }
        return base;
      };
      const entries = [...document.querySelectorAll(".log .log-entry")];
      const last = entries[entries.length - 1];
      const prev = entries[entries.length - 2];
      if (!last || !prev) return { entryCount: entries.length };
      const cs = getComputedStyle(last);
      const lastEff = effColor(last);
      const prevEff = effColor(prev);
      return {
        entryCount: entries.length,
        isFlagged: last.getAttribute("data-latest") === "1",
        borderLeftWidth: parseFloat(cs.borderLeftWidth),
        animationName: cs.animationName,
        rawBg: cs.backgroundColor,
        lastEff,
        prevEff,
        dRGB:
          Math.abs(lastEff.r - prevEff.r) +
          Math.abs(lastEff.g - prevEff.g) +
          Math.abs(lastEff.b - prevEff.b),
      };
    });

    check(m.entryCount >= ACTIONS, `① ${vp.tag}: .log-entry 仅 ${m.entryCount} 条`);
    if (m.entryCount >= 2) {
      check(m.isFlagged, `① ${vp.tag}: 最末 .log-entry 未带 data-latest="1"`);
      check(
        m.borderLeftWidth >= 6,
        `① ${vp.tag}: 最新条 borderLeftWidth ${m.borderLeftWidth}px < 6px`
      );
      check(
        m.dRGB >= 18,
        `① ${vp.tag}: 最新条与上一条 ΔRGB ${m.dRGB.toFixed(1)} < 18 ` +
          `(latest=${JSON.stringify(m.lastEff)} prev=${JSON.stringify(m.prevEff)} raw=${m.rawBg})`
      );
      check(
        m.animationName && m.animationName !== "none",
        `② ${vp.tag}: [data-latest="1"] animationName=${m.animationName}（要求非 none 入场动效）`
      );
    }

    // ── ③ 底部不硬切（双态核查） ──
    const probe = () =>
      page.evaluate(() => {
        const log = document.querySelector(".log");
        if (!log) return { hasLog: false };
        const lr = log.getBoundingClientRect();
        const hints = [
          ...document.querySelectorAll(".stage .log-scroll-hint, .stage [data-scroll-hint]"),
        ].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const entries = [...log.querySelectorAll(".log-entry")];
        const le = entries[entries.length - 1];
        const ler = le ? le.getBoundingClientRect() : null;
        // .stage 上挂着的提示矩形是否落在 .log 底缘 24px 带内
        // （提示挂在 .stage 底、.log 底缘与 .stage 底缘间还有
        // .actions 等邻接元素时按矩形距离判定，不按 DOM 父级）。
        const hintInBand = hints.some(
          (el) => Math.abs(lr.bottom - el.getBoundingClientRect().bottom) <= 24
        );
        return {
          hasLog: true,
          scrollTop: log.scrollTop,
          scrollHeight: log.scrollHeight,
          clientHeight: log.clientHeight,
          fits: log.scrollHeight <= log.clientHeight + 2,
          hintCount: hints.length,
          hintInBand,
          edgeFade: log.getAttribute("data-edge-fade") === "1",
          lastBottomInView: ler ? ler.bottom <= lr.bottom + 1 : null,
          logBottom: lr.bottom,
          lastBottom: ler ? ler.bottom : null,
        };
      });

    // 态一：停顶（有下文可读时必须有渐隐提示落在底缘带内，或一屏放得下）。
    await page.evaluate(() => {
      const log = document.querySelector(".log");
      if (log) log.scrollTop = 0;
    });
    // React onScroll → setLogHint 是异步的：有界等到提示挂载（可滚且
    // 未到底）或确认本就一屏放下/已到底无提示。
    await page
      .waitForFunction(
        () => {
          const log = document.querySelector(".log");
          if (!log) return true;
          if (log.scrollHeight <= log.clientHeight + 2) return true;
          return Boolean(
            document.querySelector(".stage .log-scroll-hint, .stage [data-scroll-hint]")
          );
        },
        { timeout: 5000 }
      )
      .catch(() => {});
    const top = await probe();
    check(top.hasLog, `③ ${vp.tag}: .log 容器不存在`);
    if (top.hasLog) {
      check(
        top.fits || top.hintInBand,
        `③ ${vp.tag} 停顶态: 无 24px 带内渐隐提示且非一屏放下 ` +
          `(fits=${top.fits} hintCount=${top.hintCount} hintInBand=${top.hintInBand} ` +
          `scroll=${top.scrollHeight}/${top.clientHeight}@${top.scrollTop})`
      );
    }

    // 态二：滚到底——要么提示仍在带内/一屏放下，要么末行完整停
    // 在 client 底缘内且无 edge-fade 遮罩溶它（到底态不能把末行
    // 溶进渐隐带）。
    await page.evaluate(() => {
      const log = document.querySelector(".log");
      if (log) log.scrollTop = log.scrollHeight;
    });
    await page
      .waitForFunction(
        () => {
          const log = document.querySelector(".log");
          if (!log) return true;
          const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 2;
          if (!atBottom) return false;
          // 到底后提示应已按 F262 口径卸载（或本就不存在）——等它
          // 消失落定再取证，避免读到收起中的中间帧。
          return !document.querySelector(
            ".stage .log-scroll-hint, .stage [data-scroll-hint]"
          );
        },
        { timeout: 5000 }
      )
      .catch(() => {});
    const bot = await probe();
    check(bot.hasLog, `③ ${vp.tag}: .log 容器不存在（到底态）`);
    if (bot.hasLog) {
      const bottomOK =
        bot.fits ||
        bot.hintInBand ||
        (bot.lastBottomInView === true && !bot.edgeFade);
      check(
        bottomOK,
        `③ ${vp.tag} 到底态: 末行被渐隐/边界裁切 ` +
          `(fits=${bot.fits} hintInBand=${bot.hintInBand} edgeFade=${bot.edgeFade} ` +
          `lastBottom=${bot.lastBottom} logBottom=${bot.logBottom})`
      );
    }

    console.log(
      `    [${vp.tag}] entries=${m.entryCount} blw=${m.borderLeftWidth}px ` +
        `dRGB=${m.dRGB != null ? m.dRGB.toFixed(1) : "n/a"} anim=${m.animationName} ` +
        `top(fits=${top.fits},hintInBand=${top.hintInBand}) ` +
        `bot(fits=${bot.fits},hintInBand=${bot.hintInBand},edgeFade=${bot.edgeFade},lastInView=${bot.lastBottomInView})`
    );
    await ctx.close();
  }
} finally {
  await browser.close().catch(() => {});
}

if (failures > 0) {
  console.error(`[E2E] latest-entry-visible FAIL (${failures} 条断言未过)`);
  process.exit(1);
}
console.log("[PASS] latest-entry-visible: 最新条 6px 左轨 + ΔRGB≥18 / 入场动效在位 / 底部双态不硬切");
process.exit(0);
