#!/usr/bin/env node
// rest-full-feedback.mjs (F245): 禁用态「休息」的即时反馈——
//
//   F236 把「休息」死键补上 disabled + 常驻 .rest-hint 之后仍剩半截
//   缺陷：真实 pointer 点击落在 disabled 键上没有任何回执（无 toast、
//   无日志增量），玩家分不清「没点上」还是「系统没理」。F245 给禁用键
//   外包一层透明承接壳 .rest-tap-catcher（仅 restBlocked 渲染），点击
//   点亮 .sys-toast、文案透传服务端 save.rest.reason。本脚本自起隔离
//   实例（空闲端口 + 临时 DB_PATH，AI key 置空），浏览器走 lib.mjs
//   launch()，三分支取证：
//     A) 新档满状态（hp/mp 俱满）：.rest-tap-catcher 存在，真实点击后
//        200ms 内出现 .sys-toast 且文本匹配 /体力|魔力/，可见时长
//        ≥1.2s（showToast 存活 2600ms）；.stage-col 零增量、存档
//        hp/mp 不变（拒绝是 no-op，不消耗不记账）；
//     B) DB 直改 hp=max_hp/2、rest_used=3：同一承接壳点击 → .sys-toast
//        文本匹配 /次|用完/（服务端 reason 原文「本章休息次数已用完」）；
//     C) DB 直改 hp=max_hp/2、rest_used=0、encounter_cd=9（压住休憩掷敌，
//        口径同 rest-feedback.mjs）：承接壳 count===0（可用态不渲染），
//        真点击照常回血——.stage-col 有日志增量、存档 hp 上涨，且无
//        拒绝类 toast。
//
//   任一分支失败 → stderr 打 DEFECT: <分支> <现象> 并让断言 FAIL。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

// better-sqlite3 原生模块锁 ABI 137（node v24）：外层 node 版本不符时
// 用 v24.5.0 重 exec 本脚本一次；该路径缺失则明示退出。
if (process.versions.modules !== "137") {
  const node24 = "/root/.nvm/versions/node/v24.5.0/bin/node";
  if (!fs.existsSync(node24)) {
    console.error(
      `[E2E] rest-full-feedback: node ABI=${process.versions.modules} ≠ 137（better-sqlite3 需要 node v24），` +
        `且 ${node24} 不存在`
    );
    process.exit(1);
  }
  const r = spawnSync(node24, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status === null ? 1 : r.status);
}

// worktree 无 client/dist 时软链主仓构建产物（已存在跳过；失败仅告警
// 继续——server 会以 404 暴露缺 dist，健康检查照常）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  try {
    fs.symlinkSync("/www/Solo-Leveling/client/dist", path.join(ROOT, "client", "dist"), "dir");
  } catch (e) {
    console.warn(`[E2E] rest-full-feedback: client/dist 软链失败（继续）: ${e.message}`);
  }
}

fs.mkdirSync("/root/logs", { recursive: true });

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f245-"));
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
    console.error(`[E2E] rest-full-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

// DB 直改口径与 rest-feedback/deny-feedback 相同：同一临时 DB_PATH 上
// 开短连接写（WAL 多连接安全），写完即关。
function dbWrite(fn) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function defect(branch, desc) {
  console.error(`DEFECT: ${branch} ${desc}`);
  throw new Error(`[REST-FULL-${branch}] ${desc}`);
}

run("rest-full-feedback", async ({ page }) => {
  const REST_BTN = page.locator("footer.actions .btn", { hasText: "休息" }).first();
  const CATCHER = page.locator(".rest-tap-catcher").first();
  const TOAST = page.locator(".sys-toast").first();
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await waitIdle();
  };
  const shot = (tag) =>
    page.screenshot({ path: `/root/logs/e2e-rest-full-${tag}-${Date.now()}.png`, fullPage: true });

  const stageState = () =>
    page.evaluate(() => {
      const c = document.querySelector(".stage-col");
      return { kids: c ? c.children.length : -1, text: c ? c.textContent || "" : "" };
    });
  const catcherCount = () => page.locator(".rest-tap-catcher").count();

  // 点承接壳并计时 .sys-toast：返回 { appearMs, text, visibleMs }。
  // appearMs 用页面内时钟测——点击事件的 e.timeStamp 到 MutationObserver
  // 记下 .sys-toast 插入的 performance.now()，剔除 Playwright RTT/轮询
  // 开销；visibleMs 从可见到消失轮询差值。
  async function clickCatcherAndTimeToast() {
    await page.evaluate(() => {
      const c = document.querySelector(".rest-tap-catcher");
      window.__restClickAt = -1;
      window.__restToastAt = -1;
      if (c)
        c.addEventListener(
          "click",
          (e) => {
            window.__restClickAt = e.timeStamp;
          },
          { once: true }
        );
      const mo = new MutationObserver(() => {
        if (document.querySelector(".sys-toast")) {
          window.__restToastAt = performance.now();
          mo.disconnect();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
      window.__restMo = mo;
    });
    const t0 = Date.now();
    await CATCHER.click();
    await TOAST.waitFor({ state: "visible", timeout: 5000 });
    const stamps = await page.evaluate(() => {
      if (window.__restMo) window.__restMo.disconnect();
      return { click: window.__restClickAt, toast: window.__restToastAt };
    });
    const appearMs =
      stamps.click >= 0 && stamps.toast >= 0
        ? Math.round(stamps.toast - stamps.click)
        : Date.now() - t0;
    const text = ((await TOAST.innerText()) || "").trim();
    const deadline = Date.now() + 8000;
    let visibleMs = -1;
    while (Date.now() < deadline) {
      const on = await page.evaluate(() => Boolean(document.querySelector(".sys-toast")));
      if (!on) {
        visibleMs = Date.now() - t0 - appearMs;
        break;
      }
      await page.waitForTimeout(40);
    }
    return { appearMs, text, visibleMs };
  }

  // ── A 新档满状态：承接壳 → 200ms 内 toast，可见 ≥1.2s，零消耗 ────
  const name = `rff${Date.now().toString(36)}`; // ≤20 字，避 409 重名
  assert(name.length <= 20, `save name 超长：${name}`);
  await createSave(page, name);
  await waitIdle();
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  const svA = await fetchSave(saveId);
  assert(
    svA.rest && svA.rest.available === false,
    `A: 新档 save.rest.available=${svA.rest && svA.rest.available}（预期满状态禁用）`
  );
  assert((await catcherCount()) === 1, `A: .rest-tap-catcher count=${await catcherCount()}（预期 1）`);

  const s0 = await stageState();
  const a = await clickCatcherAndTimeToast();
  if (a.appearMs > 200 || !/体力|魔力/.test(a.text)) {
    defect(
      "A",
      `满状态点「休息」toast ${a.appearMs}ms 出现、文本「${a.text}」` +
        `（预算 200ms 内、须含体力/魔力）`
    );
  }
  assert(a.appearMs <= 200, `A: .sys-toast ${a.appearMs}ms 才出现（>200ms）`);
  assert(/体力|魔力/.test(a.text), `A: .sys-toast 不含体力/魔力：「${a.text}」`);
  assert(
    a.visibleMs >= 1200,
    `A: .sys-toast 可见时长 ${a.visibleMs}ms（<1200ms，反馈一闪而过）`
  );
  const s1 = await stageState();
  const svA2 = await fetchSave(saveId);
  assert(
    s1.kids === s0.kids && s1.text === s0.text,
    `A: 拒绝点击后 .stage-col 有增量 kids ${s0.kids}->${s1.kids}`
  );
  assert(
    svA2.hp === svA.hp && svA2.mp === svA.mp && svA2.rest_used === svA.rest_used,
    `A: 拒绝点击消耗了存档 hp ${svA.hp}->${svA2.hp} mp ${svA.mp}->${svA2.mp} rest_used ${svA.rest_used}->${svA2.rest_used}`
  );
  await shot("A");
  console.log(
    `[REST-FULL-A] toast ${a.appearMs}ms 出现、可见 ${a.visibleMs}ms、` +
      `「${a.text}」 stage-col ${s0.kids}->${s1.kids} hp/mp 不变`
  );

  // ── B 次数用尽：同一承接壳 → toast 透传服务端 reason ─────────────
  const hurt = Math.max(1, Math.floor(Number(svA.max_hp) / 2));
  dbWrite((db) => {
    db.prepare("UPDATE saves SET hp = ?, rest_used = 3 WHERE id = ?").run(hurt, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await reload();

  const svB = await fetchSave(saveId);
  assert(
    svB.rest && svB.rest.available === false,
    `B: rest_used=3 时 save.rest.available=${svB.rest && svB.rest.available}`
  );
  assert((await catcherCount()) === 1, `B: .rest-tap-catcher count=${await catcherCount()}（预期 1）`);

  const b = await clickCatcherAndTimeToast();
  if (!/次|用完/.test(b.text)) {
    defect("B", `次数用尽点「休息」toast 文本「${b.text}」不含次数/用完口径`);
  }
  assert(b.appearMs <= 200, `B: .sys-toast ${b.appearMs}ms 才出现（>200ms）`);
  assert(/次|用完/.test(b.text), `B: .sys-toast 不含次数/用完：「${b.text}」`);
  await shot("B");
  console.log(`[REST-FULL-B] toast ${b.appearMs}ms 出现、可见 ${b.visibleMs}ms、「${b.text}」`);

  // ── C 反向可用态：承接壳不渲染，真点击照旧回血 ───────────────────
  dbWrite((db) => {
    db.prepare("UPDATE saves SET hp = ?, rest_used = 0, encounter_cd = 9 WHERE id = ?").run(hurt, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await reload();

  const cc = await catcherCount();
  assert(cc === 0, `C: 可休息态 .rest-tap-catcher 仍渲染 count=${cc}（应整层不渲染）`);

  const c0 = await stageState();
  const respP = page.waitForResponse(
    (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
    { timeout: 8000 }
  );
  await REST_BTN.click();
  await respP.then((r) => r.finished().catch(() => {}));
  await waitIdle();

  const c1 = await stageState();
  const svC = await fetchSave(saveId);
  const toastOn = await TOAST.count();
  const toastText = toastOn ? ((await TOAST.innerText()) || "").trim() : "";
  assert(
    c1.kids > c0.kids || c1.text !== c0.text,
    `C: 可休息态真点击后 .stage-col 无日志增量 kids ${c0.kids}->${c1.kids}（被承接层拦截？）`
  );
  assert(svC.hp > hurt, `C: 休息未真实回血 hp ${hurt}->${svC.hp}`);
  assert(
    !/无需休息|已用完/.test(toastText),
    `C: 可休息态出现拒绝类 toast「${toastText}」`
  );
  await shot("C");
  console.log(
    `[REST-FULL-C] catcher=0 stage-col ${c0.kids}->${c1.kids} hp ${hurt}->${svC.hp}` +
      `${toastText ? ` toast=「${toastText}」` : " toast=无"}`
  );
});
