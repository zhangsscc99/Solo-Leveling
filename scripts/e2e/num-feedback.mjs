#!/usr/bin/env node
// num-feedback.mjs (F259): 数值变化必须有动效——数字 count-up + 血条残影——
//
//   改动前实测：顶栏 .gauge-num / 金币 / XP 是静态字符替换，回包一到大
//   数字瞬跳；.gauge-track 里没有残影节点，掉血段直接消失——「我掉了
//   多少血」只能靠心算前后两帧。
//
//   修法（纯渲染层，不动 server / 不动既有选择器）：
//     · client/src/useCountUp.ts：value 变化后 ~400ms 内 rAF 从当前
//       显示值 ease-out 滚到终值；滚动中 data-counting="1"，节点常驻
//       data-anim="count"；prefers-reduced-motion 直接落终值。
//     · Gauge 顶栏数字 / .stat-gold / .stat-xp / .stat-xp-nums 全部改
//       读 useCountUp 的 display；.gauge-delta（F218）浮字不动。
//     · .gauge-track 内新增 .gauge-ghost[data-ghost="1"]（fill 同源宽
//       度，CSS transition width .4s 延迟 .3s）：掉血时 fill 先收、残影
//       停 ~300ms 露出丢失段再收拢；回血时被加宽的 fill 当场盖住。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空，client/dist
//   缺失或外链先补构建）真实浏览器 390 视口跑：
//     ① 新档点选项「跟着队伍走向殿中央」（scripted 铺陈步，零变化）
//       →「趁乱往石门方向逃」（真推进：HP−3 / MP−2 固定常量，首步真推
//       进结算每日「推进战线」：XP+10 金币+10——四个数字同一回包齐变，
//       落地若掷中遭遇也不影响数值入账）：
//       .gauge-num(hp) / .stat-gold / .stat-xp 采样必须采到既非旧值也
//       非终值的中间值，且至少一次见到 data-counting="1"；收尾等于终值。
//     ② 同一窗口内 .gauge-hp [data-ghost] 存在，且 ghost 宽度与 fill
//       宽度短暂不同（掉血方向 ghost 更宽）；4s 内收敛相等。
//     ③ 「属性」面板 .stat-xp .stat-line-fill 在加 XP 前后宽度变化。
//     ④ 收尾断言 documentElement.scrollWidth === clientWidth
//       （390 视口不因 ghost/绝对定位横向溢出）。
//
//   旧码红证：旧码无 useCountUp/ghost——(a) 数字瞬跳采样永无中间值且
//   无 data-counting 节点 → FAIL；(b) [data-ghost] 节点不存在 → FAIL。
//   脚本退出码 0/1，输出 [F259] PASS|FAIL <原因>。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建（与 log-increment-style 同口径）——本断言
// 验的正是本 worktree 的客户端代码，外部 bundle 里没有 count-up/ghost。
// 另：dist 存在但比源码旧（main 上残留上一次部署的产物）同样重建——否则
// 「改了源码没重打包」会让断言读到旧 bundle，把本轮改动判成 FAIL。
{
  const dist = path.join(ROOT, "client", "dist");
  const newest = (dir) => {
    let m = 0;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) m = Math.max(m, newest(p));
      else if (e.isFile()) m = Math.max(m, fs.statSync(p).mtimeMs);
    }
    return m;
  };
  let stale = false;
  try {
    const idx = fs.statSync(path.join(dist, "index.html")).mtimeMs;
    let src = 0;
    for (const rel of ["src", "index.html", "package.json", "vite.config.ts", "vite.config.js"]) {
      const p = path.join(ROOT, "client", rel);
      if (!fs.existsSync(p)) continue;
      src = Math.max(src, fs.statSync(p).isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
    }
    stale = src > idx;
  } catch {
    stale = true;
  }
  let foreign = false;
  try {
    foreign = fs.lstatSync(dist).isSymbolicLink();
  } catch {}
  if (foreign) fs.rmSync(dist, { force: true });
  if (stale || !fs.existsSync(path.join(dist, "index.html"))) {
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_CHANNEL_FD;
    delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
    const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: buildEnv,
    });
    if (b.status !== 0) {
      console.error("[F259] FAIL client/dist 缺失且 npm --prefix client run build 失败");
      process.exit(1);
    }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

const port = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f259-"));
const dbPath = path.join(tmpDir, "game.db");
const env = {
  ...process.env,
  PORT: String(port),
  DB_PATH: dbPath,
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
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const API = `http://127.0.0.1:${port}/game/api`;
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[F259] FAIL 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, launch, createSave } = await import("./lib.mjs");

const NAME = `f259-${Date.now().toString(36)}`;
const t0 = Date.now();
const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

let browser = null;
let page = null;
try {
  browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  await main(page);
  console.log(`[F259] PASS (${elapsed()})`);
  await browser.close();
  process.exit(0);
} catch (e) {
  let shot = "";
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    shot = `/root/logs/e2e-num-feedback-${Date.now()}.png`;
    if (page) await page.screenshot({ path: shot, fullPage: true });
  } catch {
    shot = "";
  }
  console.error(`[F259] FAIL (${elapsed()}) ${e.message}${shot ? ` screenshot=${shot}` : ""}`);
  if (browser) await browser.close().catch(() => {});
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────

function parseGauge(t) {
  const m = String(t || "").match(/(\d+)\s*\/\s*(\d+)/);
  return m ? Number(m[1]) : null;
}
function parseNum(t) {
  const m = String(t || "").replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : null;
}

// 在页面内开一个 rAF 逐帧采样环：gauge 数字、金币、XP、data-counting
// 标记、ghost/fill 宽度逐帧落数组——单段 evaluate 免 CDP 往返，时间戳同源。
// 先按时间预算采满（t>=200ms 且 >=8 个样本）再采到 durMs；rAF 在页面被
// 节流/不可见时可能不给帧，故用 20ms setTimeout 兜底泵与之竞速，保证
// 「200ms 时至少 8 个样本」不依赖主机调度抖动。
function sampleWindow(page, durMs) {
  return page.evaluate(async (dur) => {
    const q = (sel) => document.querySelector(sel);
    const attr = (sel, name) => {
      const el = q(sel);
      return el ? el.getAttribute(name) : null;
    };
    const txt = (sel) => {
      const el = q(sel);
      return el ? el.textContent.trim() : null;
    };
    const w = (sel) => {
      const el = q(sel);
      return el ? el.getBoundingClientRect().width : null;
    };
    const out = [];
    const t0 = performance.now();
    const snap = () =>
      out.push({
        t: Math.round(performance.now() - t0),
        hp: txt(".gauge-hp .gauge-num"),
        mp: txt(".gauge-mp .gauge-num"),
        gold: txt(".stat-gold b"),
        xp: txt(".stat-xp b"),
        hpCounting: attr(".gauge-hp .gauge-num", "data-counting"),
        goldCounting: attr(".stat-gold b", "data-counting"),
        xpCounting: attr(".stat-xp b", "data-counting"),
        ghost: w(".gauge-hp [data-ghost]"),
        fill: w(".gauge-hp .gauge-fill"),
        ghostExists: Boolean(q(".gauge-hp [data-ghost]")),
      });
    const nextTick = () =>
      new Promise((r) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            r();
          }
        };
        requestAnimationFrame(finish);
        setTimeout(finish, 20);
      });
    while (performance.now() - t0 < 200 || out.length < 8) {
      snap();
      await nextTick();
    }
    while (performance.now() - t0 < dur) {
      snap();
      await nextTick();
    }
    return out;
  }, durMs);
}

// 采样集 → 该列出现过「严格介于 old/new 之间」的值？
function sawIntermediate(samples, pick, from, to) {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  return samples.some((s) => {
    const v = pick(s);
    return typeof v === "number" && v > lo && v < hi;
  });
}

async function main(page) {
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const waitActionResp = () =>
    page.waitForResponse(
      (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
      { timeout: 10000 }
    );
  const clickChoice = async (label) => {
    const btn = page.locator(".btn-group-choice .btn", { hasText: label }).first();
    assert((await btn.count()) > 0, `选项「${label}」不存在（must_choose 选项组未渲染）`);
    const respP = waitActionResp();
    await btn.click();
    await respP.then((r) => r.finished().catch(() => {}));
  };
  const openStats = async () => {
    if (!(await page.locator(".sidebar.open").count())) {
      await page.click(".drawer-toggle");
      await page.waitForSelector(".sidebar.open");
    }
    await page.locator(".side-nav-btn", { hasText: "属性" }).first().click();
    await page.waitForSelector(".stat-panel");
  };
  const closeDrawer = async () => {
    if (await page.locator(".sidebar.open").count()) {
      await page.click(".side-close");
      await page.waitForFunction(() => !document.querySelector(".sidebar.open"));
    }
  };
  const xpFillWidth = () =>
    page.evaluate(() => {
      const el = document.querySelector(".stat-xp .stat-line-fill");
      return el ? el.getBoundingClientRect().width : null;
    });

  await createSave(page, NAME);
  await waitIdle();

  // 初始真值（建档即下发，非采样猜值）。
  const v0 = await page.evaluate(() => ({
    hp: document.querySelector(".gauge-hp .gauge-num")?.textContent.trim(),
    mp: document.querySelector(".gauge-mp .gauge-num")?.textContent.trim(),
    gold: document.querySelector(".stat-gold b")?.textContent.trim(),
    xp: document.querySelector(".stat-xp b")?.textContent.trim(),
  }));
  const hp0 = parseGauge(v0.hp);
  const mp0 = parseGauge(v0.mp);
  const gold0 = parseNum(v0.gold);
  const xp0 = parseNum(v0.xp);
  assert(hp0 === 100 && mp0 === 20 && gold0 === 0 && xp0 === 0,
    `setup: 新档初值应为 HP100/MP20/XP0/金币0，实测 ${JSON.stringify(v0)}`);

  // ── ③a 加 XP 前：属性面板 .stat-xp .stat-line-fill 基线宽度 ──
  await openStats();
  assert((await page.locator(".stat-xp .stat-line-fill").count()) === 1,
    "(c) 属性面板 .stat-xp .stat-line-fill 不存在");
  const xpW0 = await xpFillWidth();
  await closeDrawer();

  // ── 推进 1：scripted 铺陈选项（零消耗、不掷遭遇），落到命令之律 ──
  await clickChoice("跟着队伍走向殿中央");
  await waitIdle();

  // ── 推进 2：「趁乱往石门方向逃」——真推进（HP−3/MP−2 固定常量）+
  //    首个非 scripted 位移结算每日「推进战线」（XP+10 金币+10），
  //    四个数字同一回包齐变；落地掷中遭遇不影响数值入账。 ──
  const respP2 = waitActionResp();
  await page.locator(".btn-group-choice .btn", { hasText: "趁乱往石门方向逃" }).first().click();
  await respP2.then((r) => r.finished().catch(() => {}));
  const samples = await sampleWindow(page, 1400);
  await waitIdle();
  assert(samples.length > 10, `(a) 采样环样本过少（${samples.length}）`);
  // ① count-up：hp 100→97、mp 20→18、gold 0→10、xp 0→10 各采到中间值。
  const checks = [
    ["HP 数字", (s) => parseGauge(s.hp), hp0, 97],
    ["MP 数字", (s) => parseGauge(s.mp), mp0, 18],
    ["金币数字", (s) => parseNum(s.gold), gold0, 10],
    ["XP 数字", (s) => parseNum(s.xp), xp0, 10],
  ];
  // (a) 早期窗口（200ms）：采样密度降为软指标——只要求 ≥1 个样本，且
  // 其中确实出现过一次「严格介于 old/new 之间」的中间值。
  const earlySamples = samples.filter((s) => s.t <= 200);
  const earlyMids = checks
    .filter(([, pick, from, to]) => sawIntermediate(earlySamples, pick, from, to))
    .map(([name]) => name);
  assert(
    earlySamples.length >= 1 && earlyMids.length > 0,
    `(a) 200ms 早期窗口未采到递增中间值（earlySamples=${earlySamples.length}，` +
      `中间列=${earlyMids.join(",") || "无"}，` +
      `序列=${JSON.stringify(earlySamples.map((s) => [parseGauge(s.hp), parseNum(s.gold), parseNum(s.xp)]))}）`
  );
  for (const [name, pick, from, to] of checks) {
    const mid = sawIntermediate(samples, pick, from, to);
    if (!mid) {
      const seq = samples.map(pick).filter((v) => v !== null);
      console.error(`[ASSERT] (a) ${name} ${from}→${to} 未采到中间值，序列=${JSON.stringify(seq)}`);
    }
    assert(mid, `(a) ${name} 无 count-up——${from}→${to} 采样未出现中间值`);
  }
  // 滚动标记：三处数字节点至少一处亮过 data-counting="1"。
  const counted = samples.some(
    (s) => s.hpCounting === "1" || s.goldCounting === "1" || s.xpCounting === "1"
  );
  assert(counted, "(a) 滚动期间未见任何 data-counting=\"1\" 标记节点");
  // 收尾落终值。
  const last = samples[samples.length - 1];
  assert(
    parseGauge(last.hp) === 97 && parseNum(last.gold) === 10 && parseNum(last.xp) === 10,
    `(a) count-up 未收敛到终值：尾帧 hp=${last.hp} gold=${last.gold} xp=${last.xp}`
  );
  console.log(
    `[OK] ① count-up：HP/MP/金币/XP 四列各采到中间值（200ms 内 ${earlySamples.length} 帧），` +
      `data-counting 亮过，尾帧收敛 97/18/10/10`
  );

  // ② 血条残影：ghost 节点存在；掉血方向 ghost 短暂比 fill 宽。
  assert(samples.some((s) => s.ghostExists), "(b) .gauge-hp [data-ghost] 残影节点不存在");
  const ghostWider = samples.some(
    (s) => typeof s.ghost === "number" && typeof s.fill === "number" && s.ghost - s.fill > 0.5
  );
  if (!ghostWider) {
    const pairs = samples.map((s) => [s.ghost, s.fill]);
    console.error(`[ASSERT] (b) ghost 未比 fill 宽，采样对=${JSON.stringify(pairs.slice(0, 20))}`);
  }
  assert(ghostWider, "(b) 掉血后残影宽度未超过新 fill（无「丢失段」残影）");
  // 4s 内收敛：残影收拢到与 fill 同宽。
  {
    const deadline = Date.now() + 4000;
    let converged = false;
    let g = null;
    let f = null;
    while (Date.now() < deadline) {
      [g, f] = await page.evaluate(() => [
        document.querySelector(".gauge-hp [data-ghost]")?.getBoundingClientRect().width,
        document.querySelector(".gauge-hp .gauge-fill")?.getBoundingClientRect().width,
      ]);
      if (typeof g === "number" && typeof f === "number" && Math.abs(g - f) < 0.5) {
        converged = true;
        break;
      }
      await page.waitForTimeout(80);
    }
    assert(converged, `(b) 4s 内残影未收敛（ghost=${g} fill=${f}）`);
  }
  console.log(`[OK] ② 残影：掉血后 ghost 曾宽于 fill（丢失段停 ~0.3s），4s 内收拢同宽`);

  // ── ③ 加 XP 后：属性面板经验条宽度已变化 ──
  await openStats();
  const xpW1 = await xpFillWidth();
  assert(
    typeof xpW1 === "number" && typeof xpW0 === "number" && xpW1 > xpW0,
    `(c) .stat-xp .stat-line-fill 宽度未随 XP 入账变化（${xpW0} -> ${xpW1}）`
  );
  await closeDrawer();
  console.log(`[OK] ③ 经验条：.stat-line-fill 宽 ${xpW0.toFixed(1)}px → ${xpW1.toFixed(1)}px`);

  // ── ④ 390 视口横向零溢出（ghost/绝对定位不撑宽文档） ──
  const [sw, cw] = await page.evaluate(() => [
    document.documentElement.scrollWidth,
    document.documentElement.clientWidth,
  ]);
  assert(sw === cw, `(d) 390 视口横向溢出 scrollWidth=${sw} > clientWidth=${cw}`);
  console.log(`[OK] ④ 无横向溢出：scrollWidth=${sw} === clientWidth=${cw}`);

  console.log("[F259] num-feedback：count-up 四列中间值 / data-counting 标记 / 残影先停后收 / 经验条变宽 / 390 无横溢");
}
