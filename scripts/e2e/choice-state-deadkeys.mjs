#!/usr/bin/env node
// choice-state-deadkeys.mjs (F272): must_choose 未决时「观察/潜行/休息」
// 曾是「看得见、按得动、永远零回执」的死键——连点 3 次正文/日志/toast
// 全无变化（截图字节级相同），玩家会认为卡死。
//
// 本断言直落第 1 章 must_choose 场景（oracle 取自 chapters.json，不经被测
// 引擎推导），在 390 与 1440 两个视口各跑一遍：
//   A) [data-act=观察/潜行/休息] 三键均 disabled 且带 [data-locked] 角标；
//   B) 对每键做 2 次真实 pointer 点击（坐标命中，落在承接壳上），每次
//      点击后 600ms 内必须出现可见结果：新 .sys-toast 节点、.log 子行 +1、
//      或 [data-locked] 角标出现——三者皆无即「静默吞键」FAIL；
//   C) 反向：非 must_choose 的普通探索新档，三键 disabled===false，
//      点「观察」一次正文/日志有增量（防「全局写死禁用」洗绿）。
//
// 旧码红证：旧实现只在 restBlocked/obsBlocked 时禁用，must_choose 里
// 「潜行」disabled=false 且无 [data-locked]，A) 首条即 FAIL。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));
import { fileURLToPath } from "node:url";

const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
const OPEN = CH1.scenes.find((s) => s.must_choose !== true);
if (!MC || !OPEN) {
  console.error("[E2E] choice-state-deadkeys: chapters.json 缺少第 1 章 oracle 场景");
  process.exit(1);
}

const DEAD_ACTS = ["观察", "潜行", "休息"];

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f272-"));
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
delete env.E2E_BASE;
delete env.E2E_API;
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => (childLog += d));
child.stderr.on("data", (d) => (childLog += d));
const cleanup = () => {
  try {
    child.kill("SIGKILL");
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
};
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
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
    console.error(
      `[E2E] choice-state-deadkeys: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const STORAGE_KEY = "solo_leveling_save_id";

// 三键的 DOM 体检：disabled / aria-disabled / 锁定角标（键面内或承接壳上）。
const deadKeyState = (page) =>
  page.evaluate((acts) => {
    const out = [];
    for (const act of acts) {
      const btn = document.querySelector(`[data-act="${act}"]`);
      if (!btn) {
        out.push({ act, missing: true });
        continue;
      }
      const lockNode =
        btn.querySelector("[data-locked]") ||
        (btn.parentElement && btn.parentElement.querySelector("[data-locked]"));
      out.push({
        act,
        missing: false,
        disabled: btn.disabled === true,
        ariaDisabled: btn.getAttribute("aria-disabled"),
        lockText: lockNode ? (lockNode.textContent || "").trim() : null,
        title: btn.getAttribute("title") || "",
      });
    }
    return out;
  }, DEAD_ACTS);

// 可见反馈探针：装一次 MutationObserver，统计新增 .sys-toast 节点与
// .stage-col.log 子行增量（承接壳点击会重建带新 key 的 toast 节点）。
const armProbe = (page) =>
  page.evaluate(() => {
    const log = document.querySelector(".stage-col.log");
    window.__f272 = { toasts: 0, logBase: log ? log.children.length : -1 };
    const seen = new WeakSet();
    const obs = new MutationObserver((muts) => {
      for (const m of muts)
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          const hits = n.matches?.(".sys-toast") ? [n] : [...n.querySelectorAll(".sys-toast")];
          for (const h of hits) {
            if (seen.has(h)) continue;
            seen.add(h);
            window.__f272.toasts += 1;
          }
        }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    window.__f272Obs = obs;
  });

const readProbe = (page) =>
  page.evaluate(() => {
    const log = document.querySelector(".stage-col.log");
    const t = document.querySelector(".sys-toast");
    return {
      toasts: window.__f272 ? window.__f272.toasts : 0,
      logRows: log ? log.children.length : -1,
      logBase: window.__f272 ? window.__f272.logBase : -1,
      toastText: t ? (t.textContent || "").trim() : null,
    };
  });

const setScene = (sceneId, sid) => {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(sceneId, sid);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(sid);
  } finally {
    db.close();
  }
};

// 真实 pointer 点击落在承接壳上（disabled 键不收 DOM .click()）。
const clickDeadKey = async (page, act, tag) => {
  const btn = page.locator(`[data-act="${act}"]`).first();
  const box = await btn.boundingBox();
  assert(box, `${tag}: 「${act}」键 boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForFunction(
    ([x, y, a]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      return (
        Boolean(el.closest(".lock-tap-catcher")) ||
        Boolean(el.closest(`[data-act="${a}"]`))
      );
    },
    [cx, cy, act],
    { timeout: 5000 }
  );
  const before = await readProbe(page);
  await page.mouse.click(cx, cy);
  // 600ms 内必须出现可见结果（轮询 50ms，避免固定 sleep 掩盖慢回执）。
  const deadline = Date.now() + 600;
  let after = before;
  while (Date.now() < deadline) {
    after = await readProbe(page);
    if (
      after.toasts > before.toasts ||
      (after.logRows > before.logRows && after.logRows > 0) ||
      (after.toastText && /选择|抉择/.test(after.toastText))
    )
      break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const gotToast = after.toasts > before.toasts;
  const gotRow = after.logRows > before.logRows && after.logRows > 0;
  const gotBanner = Boolean(after.toastText && /选择|抉择/.test(after.toastText));
  assert(
    gotToast || gotRow || gotBanner,
    `${tag}: 点击「${act}」600ms 内零可见回执（toast ${before.toasts}->${after.toasts}，` +
      `.log ${before.logRows}->${after.logRows}）——静默吞键`
  );
  return { gotToast, gotRow, gotBanner };
};

const checkLocked = async (page, tag) => {
  const states = await deadKeyState(page);
  for (const s of states) {
    assert(!s.missing, `${tag}: 页面上找不到 [data-act="${s.act}"] 键`);
    assert(s.disabled, `${tag}: 「${s.act}」在抉择未决时仍可点（disabled=false）`);
    assert(s.ariaDisabled === "true", `${tag}: 「${s.act}」aria-disabled=${s.ariaDisabled} 非 true`);
    assert(
      s.lockText !== null && /选择/.test(s.lockText),
      `${tag}: 「${s.act}」无锁定角标（data-locked=${JSON.stringify(s.lockText)}）`
    );
    assert(
      /选择|抉择/.test(s.title),
      `${tag}: 「${s.act}」title 无指路信息：「${s.title}」`
    );
  }
  return states;
};

run("choice-state-deadkeys", async ({ page }) => {
  const name = `e2e-f272-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate((k) => Number(localStorage.getItem(k)), STORAGE_KEY);
  assert(saveId > 0, "save_id missing in localStorage");

  setScene(MC.id, saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await armProbe(page);

  // ── 390 视口：A) 锁定态  B) 每次真实点击都有回执 ─────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  const s390 = await checkLocked(page, "[390]");
  for (const s of s390)
    console.log(`    [390] 「${s.act}」disabled=${s.disabled} locked=${s.lockText}`);
  for (const act of DEAD_ACTS) {
    for (let i = 1; i <= 2; i += 1) {
      const r = await clickDeadKey(page, act, `[390] #${i}`);
      console.log(
        `    [390] 「${act}」第 ${i} 次点击回执：toast=${r.gotToast} log=${r.gotRow} banner=${r.gotBanner}`
      );
      await page.waitForTimeout(120);
    }
  }

  // ── 1440 视口：同口径 ────────────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  const s1440 = await checkLocked(page, "[1440]");
  for (const s of s1440)
    console.log(`    [1440] 「${s.act}」disabled=${s.disabled} locked=${s.lockText}`);
  await clickDeadKey(page, "观察", "[1440] #1");
  await clickDeadKey(page, "休息", "[1440] #1");

  // ── C) 反向：普通探索新档三键照旧可点，点「观察」有增量 ──────────
  await page.evaluate(() => localStorage.clear());
  const name2 = `e2e-f272b-${Date.now().toString(36)}`;
  await createSave(page, name2);
  const saveId2 = await page.evaluate((k) => Number(localStorage.getItem(k)), STORAGE_KEY);
  assert(saveId2 > 0, "second save_id missing");
  setScene(OPEN.id, saveId2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await armProbe(page);

  const openStates = await deadKeyState(page);
  for (const s of openStates) {
    assert(!s.missing, `[open] 找不到 [data-act="${s.act}"] 键`);
    // 抉择门只属于 must_choose：普通探索场景三键都不得带「需先选择」角标。
    assert(
      s.lockText === null,
      `[open] 「${s.act}」仍带抉择锁定角标（${s.lockText}）——抉择门泄漏到普通场景`
    );
    assert(
      !/选择|抉择/.test(s.title),
      `[open] 「${s.act}」title 仍是抉择指路：「${s.title}」`
    );
    // 「休息」另有服务端配额口径（满状态/次数用尽），只在有理由时可禁用；
    // 「观察」「潜行」不得被写死禁用——防「全局禁用」洗绿。
    if (s.act === "观察" || s.act === "潜行")
      assert(
        s.disabled === false,
        `[open] 「${s.act}」被写死禁用（普通探索场景 disabled=true）`
      );
    if (s.disabled)
      assert(
        s.title.length > 0,
        `[open] 「${s.act}」被禁用但 title 为空——无理由的死键`
      );
  }
  const before = await readProbe(page);
  await page.locator('[data-act="观察"]').first().click();
  let after = before;
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    after = await readProbe(page);
    if (after.logRows > before.logRows || after.toastText) break;
    if (!(await page.evaluate(() => !!document.querySelector(".pending")))) {
      after = await readProbe(page);
      if (after.logRows > before.logRows) break;
    }
    await page.waitForTimeout(120);
  }
  await page.waitForFunction(() => !document.querySelector(".pending"), { timeout: 20000 });
  after = await readProbe(page);
  assert(
    after.logRows > before.logRows,
    `[open] 普通场景点「观察」正文/日志无增量（${before.logRows} -> ${after.logRows}）`
  );
  console.log(`    [open] 三键可点，观察后 .log ${before.logRows} -> ${after.logRows}`);
});
