#!/usr/bin/env node
// noise-meter.mjs (F290): 「动静」必须是常驻 HUD 计量条，不再只活在
// 正文括注里——
//
//   实测投诉：连点「环顾四周」6 次 HP/MP/金币纹丝不动，代价
//   「动静 2/4→3/4→4/4」只写在叙事尾注，攒满直接强制遇敌且无预警——
//   玩家把「观察」当成零成本可重复动作（Pre 层反馈缺失）。
//
//   服务端早就把口径下发在 save.observe.noise={cur,max}
//   （observeDisclosure），前端只需渲染、不得自行推导。本断言：
//     A) 390×844 与 1440×900 首屏均存在可见 [data-noise]，role=meter，
//        aria-valuenow===API noise.cur、aria-valuemax===API noise.max，
//        且点亮格数（.noise-cell.on）=== cur——可视计量非纯文本；
//     B) 连点「观察」把动静推到 max-1：每次点击后 DOM aria-valuenow
//        与 API noise.cur 逐字一致，复核区序列严格 +1 递增；
//     C) cur>=max-1 时元素 class 含 warn（预警样式上线）；
//     D) 390 下 [data-noise] 右缘 <= innerWidth-8，且
//        documentElement 无横向溢出（F214/F223 同标准）；
//     E) 下一次观察把保底账推过线、就地开战后（liveCombat），
//        [data-noise] 不可见或不在 DOM——交战态退场不得报错。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空），新档落在
//   ch1_double_gate（可掷怪场景）：前 OBSERVE_TOTAL 次观察免费
//   （noise 恒 0），其后每次 encounter_clock +1，clockNext>=4 开战。
//   旧码（无 [data-noise] 元素）在 A 即 FAIL；新码 PASS。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建——本断言验的正是本 worktree 的客户端。
{
  const dist = path.join(ROOT, "client", "dist");
  let foreign = false;
  try {
    foreign = fs.lstatSync(dist).isSymbolicLink();
  } catch {}
  if (foreign) fs.rmSync(dist, { force: true });
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_CHANNEL_FD;
    delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
    const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: buildEnv,
    });
    if (b.status !== 0) {
      console.error("[E2E] noise-meter: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f290-"));
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
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const BASE = `http://127.0.0.1:${port}/game`;
const API = `${BASE}/api`;
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
    console.error(`[E2E] noise-meter: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = BASE;
const { assert, run, createSave, stageCount } = await import("./lib.mjs");

async function fetchObserve(saveId) {
  const r = await fetch(`${API}/saves/${saveId}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${saveId} failed (HTTP ${r.status})`);
  return body.save.observe;
}

// [data-noise] 现场取证：可见性、aria 值、点亮格数、右缘、文档横溢。
const readMeter = (page) =>
  page.evaluate(() => {
    const el = document.querySelector("[data-noise]");
    const de = document.documentElement;
    if (!el) {
      return {
        exists: false,
        vw: window.innerWidth,
        docSW: de.scrollWidth,
      };
    }
    const b = el.getBoundingClientRect();
    const lit = el.querySelectorAll(".noise-cell.on").length;
    const cells = el.querySelectorAll(".noise-cell").length;
    return {
      exists: true,
      visible: b.width > 0 && b.height > 0 && el.offsetParent !== null,
      right: b.right,
      top: b.top,
      bottom: b.bottom,
      role: el.getAttribute("role"),
      ariaLabel: el.getAttribute("aria-label") || "",
      now: el.getAttribute("aria-valuenow"),
      max: el.getAttribute("aria-valuemax"),
      lit,
      cells,
      warn: el.classList.contains("warn"),
      vw: window.innerWidth,
      vh: window.innerHeight,
      docSW: de.scrollWidth,
      docCW: de.clientWidth,
    };
  });

function checkMeter(m, obs, tag) {
  assert(m.exists, `${tag}: [data-noise] 元素不存在——HUD 计量条缺失`);
  assert(m.visible, `${tag}: [data-noise] 不可见（首屏必须直读，不滚动不进抽屉）`);
  assert(
    m.top >= 0 && m.bottom <= m.vh,
    `${tag}: [data-noise] 不在首屏视口内 top=${m.top.toFixed(1)} bottom=${m.bottom.toFixed(1)} vh=${m.vh}`
  );
  assert(
    m.role === "meter" || m.role === "img",
    `${tag}: [data-noise] role="${m.role}"——需 meter/img 等价语义`
  );
  assert(
    /动静/.test(m.ariaLabel),
    `${tag}: [data-noise] aria-label 未含「动静」: "${m.ariaLabel}"`
  );
  assert(
    Number(m.now) === obs.noise.cur,
    `${tag}: aria-valuenow=${m.now} 与服务端 noise.cur=${obs.noise.cur} 脱节（前端疑在自推导）`
  );
  assert(
    Number(m.max) === obs.noise.max,
    `${tag}: aria-valuemax=${m.max} 与服务端 noise.max=${obs.noise.max} 脱节`
  );
  assert(
    m.cells === obs.noise.max,
    `${tag}: 计量格总数=${m.cells} 与 noise.max=${obs.noise.max} 不符（格子须随下发口径，不写死）`
  );
  assert(
    m.lit === obs.noise.cur,
    `${tag}: 点亮格数=${m.lit} 与 noise.cur=${obs.noise.cur} 不符——计量条须是可视图标非纯文本`
  );
  assert(
    m.right <= m.vw - 8,
    `${tag}: [data-noise] 右缘贴边/越界 right=${m.right.toFixed(1)} > vw-8=${m.vw - 8}`
  );
  assert(
    m.docSW <= m.docCW + 1,
    `${tag}: documentElement 横向溢出 scrollWidth=${m.docSW} > clientWidth=${m.docCW}+1`
  );
}

run("noise-meter", async ({ page }) => {
  const name = `nm${Date.now().toString(36)}`; // ≤20 字，避 409 重名
  await createSave(page, name);
  await page.waitForFunction(() => !document.querySelector(".pending"));
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // ── A/D 两视口首屏：计量条可见、aria 与 API 同源、右缘与横溢红线 ──
  for (const [w, h] of [
    [390, 844],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForSelector("[data-noise]");
    const obs = await fetchObserve(saveId);
    const m = await readMeter(page);
    checkMeter(m, obs, `${w}x${h}`);
    console.log(
      `    [${w}x${h}] [data-noise] 动静 ${m.now}/${m.max} 点亮 ${m.lit}/${m.cells} ` +
        `right=${m.right.toFixed(1)}(限 ${m.vw - 8}) docSW=${m.docSW}/${m.docCW} role=${m.role}`
    );
  }

  // ── B 连点「观察」：DOM 随 API 逐步刷新，复核区严格 +1 ──────────
  await page.setViewportSize({ width: 390, height: 844 });
  const domSeq = [];
  const apiSeq = [];
  let obs = await fetchObserve(saveId);
  let cur = obs.noise.cur;
  const max = obs.noise.max;
  for (let i = 1; i <= 12 && cur < max - 1; i++) {
    const kids0 = await stageCount(page);
    await page.click('button[data-act="观察"]');
    await page.waitForFunction((k) => document.querySelector(".stage-col").children.length > k, kids0, {
      timeout: 15000,
    });
    obs = await fetchObserve(saveId);
    cur = obs.noise.cur;
    // DOM 须与服务端同值——有界等待，不 sleep 赌时序。
    await page.waitForFunction(
      (want) => document.querySelector("[data-noise]")?.getAttribute("aria-valuenow") === String(want),
      cur,
      { timeout: 15000 }
    );
    const m = await readMeter(page);
    checkMeter(m, obs, `390x844 obs#${i}`);
    domSeq.push(Number(m.now));
    apiSeq.push(cur);
    console.log(`    [390x844] 第${i}次观察后 动静 ${cur}/${max}（点亮 ${m.lit}）warn=${m.warn}`);
  }
  assert(
    domSeq.join(",") === apiSeq.join(","),
    `B: DOM 序列与服务端脱节 dom=[${domSeq}] api=[${apiSeq}]`
  );
  // 复核区每次观察严格 +1：取收尾三段（必落在免费区之后）验证递增。
  const tail3 = apiSeq.slice(-3);
  assert(
    tail3.length === 3 && tail3[1] === tail3[0] + 1 && tail3[2] === tail3[1] + 1,
    `B: 复核区动静未严格 +1 递增：收尾序列=[${tail3}]（全程 api=[${apiSeq}]）`
  );

  // ── C cur>=max-1 → warn 预警态 ────────────────────────────────
  assert(
    cur >= max - 1,
    `C: 连点未把动静推进到预警线：cur=${cur} max=${max}（机制口径变了？）`
  );
  const mw = await readMeter(page);
  assert(
    mw.warn,
    `C: 动静 ${cur}/${max} 已达 max-1 但 [data-noise] 无 warn class——「再看一次就要遇敌」无预警`
  );
  console.log(`[OK] (C) 动静 ${cur}/${max} 预警态：class 含 warn，点亮 ${mw.lit}/${mw.cells}`);

  // ── E 下一次观察把保底账推过线开战 → 交战态计量条退场不报错 ──
  const kids0 = await stageCount(page);
  await page.click('button[data-act="观察"]');
  await page.waitForFunction((k) => document.querySelector(".stage-col").children.length > k, kids0, {
    timeout: 15000,
  });
  const after = await readMeter(page);
  assert(
    !after.exists || !after.visible,
    `E: 交战态 [data-noise] 仍可见——应隐藏或置 inert（cur 已过 PITY 线开战）`
  );
  const inCombat = await page.evaluate(() => Boolean(document.querySelector(".combat, [data-combat]")));
  console.log(`[OK] (E) 保底兑现开战后计量条退场：exists=${after.exists} visible=${after.visible} combatDom=${inCombat}`);
});
