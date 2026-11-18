#!/usr/bin/env node
// deny-feedback.mjs (F231): must_choose 未决时「前进」的拒绝必须立刻
// 可见、且不得走 AI 慢路径——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落 ch1_law（must_choose 场景，oracle 取自 chapters.json）：
//     a) 点「探索前进」后 300ms 内页面出现可见拒绝元素
//        （.sys-toast 或 .deny-hint：height>0 且文本非空）——页面内
//        MutationObserver 记首个可见时刻，不靠轮询猜；文案须说清
//        「先选一个」而不是复述三个选项名；
//     b) 拒绝响应耗时 < 800ms（点击 → /api/*action 回包落地的墙钟）；
//     c) 连点 3 次 .stage-col 子节点数增量 ≤ 1（F226 拒绝去重在新
//        路径下仍成立）；
//     d) HP/MP/XP/金币全程零变化（界面读数 + 服务端存档双口径）；
//     e) 390 视口下无横向溢出（scrollWidth==clientWidth）且拒绝
//        元素完整落在视口内。
//
//   旧码红证：旧前端首次拒绝只回写两条日志行，.sys-toast 只在重复
//   拒绝的回包到达后才亮——(a) 的观察窗内没有任何可见拒绝元素，
//   waitForFunction 超时 → FAIL。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

// Oracle：第 1 章首个 must_choose 场景，不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f231-"));
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
    console.error(`[E2E] deny-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave, readVitals } = await import("./lib.mjs");

// 服务端存档快照（HP/MP/XP/金币口径独立于界面读数）。
async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

run("deny-feedback", async ({ page }) => {
  const name = `e2e-f231-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（与 reject-spam.mjs 同口径）：清交战、清遭遇
  // 冷却，回灌后选项组就位。
  {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(MC.id, saveId);
      db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
    } finally {
      db.close();
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  const advanceBtn = page.locator(".actions-main .btn", { hasText: "探索前进" }).first();
  const stageKids = () => page.evaluate(() => document.querySelector(".stage-col").children.length);
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const DENY_SEL = ".sys-toast, .deny-hint";

  const vitals0 = await readVitals(page);
  const save0 = await fetchSave(saveId);

  // ── (a) 首次点击「探索前进」：300ms 内出现可见拒绝元素 ─────────
  // MutationObserver 记 .sys-toast/.deny-hint 首个可见时刻——React 插入
  // 节点即触发，不吃 playwright 轮询粒度。计时起点用捕获期 click 监听器
  // 记下的真实 DOM 点击时刻：playwright click() 的 actionability/稳定性
  // 检查是测试框架开销，不计入前端响应。
  await page.evaluate((sel) => {
    window.__denySeenAt = null;
    window.__clickAt = null;
    window.__respAt = null;
    window.__denyT0 = performance.now();
    document.addEventListener(
      "click",
      (e) => {
        const b = e.target.closest(".btn");
        if (b && /探索前进/.test(b.textContent || "")) window.__clickAt = performance.now();
      },
      true
    );
    // fetch 回包到达时刻：与 __denySeenAt 同表（performance.now），
    // 用于判定「拒绝元素先于回包出现」——不依赖 playwright 往返时序。
    const origFetch = window.fetch;
    window.fetch = (...args) => {
      const url = String(args[0] && args[0].url ? args[0].url : args[0]);
      const p = origFetch(...args);
      if (/\/api\/(ai-)?action$/.test(url)) {
        p.then(() => {
          window.__respAt = performance.now();
        }).catch(() => {});
      }
      return p;
    };
    const obs = new MutationObserver(() => {
      const el = document.querySelector(sel);
      if (el && el.getBoundingClientRect().height > 0 && (el.textContent || "").trim()) {
        window.__denySeenAt = performance.now();
        obs.disconnect();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }, DENY_SEL);

  // ── (b) 同一次点击的拒绝回包耗时（点击 → 回包落地的墙钟）──────
  const respPromise = page.waitForResponse(
    (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
    { timeout: 8000 }
  );
  const clickT0 = Date.now();
  await advanceBtn.click();
  const resp = await respPromise;
  await resp.finished().catch(() => {});
  const responseMs = Date.now() - clickT0;

  let denyMs = null;
  try {
    await page.waitForFunction(() => window.__denySeenAt !== null, null, { timeout: 1500 });
    denyMs = await page.evaluate(
      () => window.__denySeenAt - (window.__clickAt ?? window.__denyT0)
    );
  } catch {
    denyMs = null;
  }
  assert(
    denyMs !== null,
    `点击「探索前进」后 1.5s 内未出现可见拒绝元素（${DENY_SEL}）——静默拒绝旧毛病`
  );
  assert(denyMs < 300, `拒绝元素出现耗时 ${denyMs.toFixed(0)}ms ≥ 300ms`);
  // 拒绝元素须在回包落地之前就已可见——否则提示仍在等服务器往返
  // （线上 ~1.1s），300ms 预算在隔离实例的快回包上形同虚设。两个时间
  // 戳同出 performance.now()，次序不受 playwright 往返影响。
  const denyBeforeResp = await page.evaluate(
    () =>
      window.__denySeenAt !== null &&
      window.__respAt !== null &&
      window.__denySeenAt <= window.__respAt
  );
  assert(
    denyBeforeResp,
    "拒绝元素未先于回包出现——提示仍在等服务器往返（慢路径）"
  );
  const toastText = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || "").trim() : "";
  }, DENY_SEL);
  assert(toastText.length > 0, "拒绝元素文本为空");
  assert(
    /先选一个|做出选择|抉择未定/.test(toastText),
    `拒绝文案没有说清「先选一个」：「${toastText}」`
  );
  console.log(`    [deny visible] ${denyMs.toFixed(0)}ms (<300) text=「${toastText}」`);

  assert(
    responseMs < 800,
    `拒绝响应耗时 ${responseMs}ms ≥ 800ms（拒绝路径仍走慢路径）`
  );
  console.log(`    [response] ${responseMs}ms (<800)`);
  await waitIdle();

  // ── (c) 连点 3 次：.stage-col 子节点数增量 ≤ 1 ─────────────────
  const n0 = await stageKids();
  for (let i = 0; i < 3; i++) {
    await advanceBtn.click();
    await waitIdle();
    const n = await stageKids();
    assert(
      n - n0 <= 1,
      `连点第 ${i + 1}/3 次后 .stage-col ${n0} -> ${n}（>+1 即刷屏旧毛病）`
    );
  }
  const n1 = await stageKids();
  console.log(`    [spam x3] stage-col ${n0} -> ${n1}（增量 ${n1 - n0} <= 1）`);

  // ── 1440 下拒绝提示不得盖住右侧档案栏（toast 尚在 2.6s 显示期内）─
  const cover = await page.evaluate((sel) => {
    const t = document.querySelector(sel);
    const side = document.querySelector("aside");
    if (!t || !side) return { overlap: false };
    const a = t.getBoundingClientRect();
    const b = side.getBoundingClientRect();
    return {
      overlap: a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom,
    };
  }, DENY_SEL);
  assert(!cover.overlap, "1440 下拒绝提示盖住右侧档案栏");

  // ── (d) HP/MP/XP/金币零变化（界面口径 + 服务端存档口径）──────────
  const vitals1 = await readVitals(page);
  assert(
    vitals1.hp.v === vitals0.hp.v && vitals1.mp.v === vitals0.mp.v,
    `界面 HP/MP 变了：HP ${vitals0.hp.v}->${vitals1.hp.v} MP ${vitals0.mp.v}->${vitals1.mp.v}`
  );
  const save1 = await fetchSave(saveId);
  for (const k of ["hp", "mp", "xp", "gold"]) {
    assert(save1[k] === save0[k], `存档 ${k} 变了：${save0[k]} -> ${save1[k]}`);
  }
  console.log(
    `    [vitals] HP ${save1.hp}/${save1.max_hp} MP ${save1.mp}/${save1.max_mp} ` +
      `XP ${save1.xp} gold ${save1.gold}（全程零变化）`
  );

  // ── (e) 390 视口：无横向溢出，拒绝元素完整落在视口内 ────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await advanceBtn.click();
  const fit = await page.evaluate((sel) => {
    const de = document.documentElement;
    const el = document.querySelector(sel);
    const r = el ? el.getBoundingClientRect() : null;
    return {
      docW: de.scrollWidth,
      docCW: de.clientWidth,
      bodyW: document.body ? document.body.scrollWidth : 0,
      vw: window.innerWidth,
      toast: r ? { left: r.left, right: r.right, width: r.width } : null,
    };
  }, DENY_SEL);
  assert(
    fit.docW <= fit.docCW && fit.bodyW <= fit.docCW,
    `390 视口横向溢出：documentElement ${fit.docW}>${fit.docCW} 或 body ${fit.bodyW}>${fit.docCW}`
  );
  assert(fit.toast && fit.toast.width > 0, "390 下拒绝元素不可见");
  assert(
    fit.toast.left >= -0.5 && fit.toast.right <= fit.vw + 0.5,
    `390 下拒绝元素越出视口：${JSON.stringify(fit.toast)} vw=${fit.vw}`
  );
  await waitIdle();
  console.log(`    [390] scrollWidth==clientWidth，拒绝元素完整在视口内`);
});
