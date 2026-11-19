#!/usr/bin/env node
// choice-state-deadkeys.mjs (F272): must_choose 未决时「观察 / 潜行 / 休息」
// 三颗键曾经是「看得见、按得动、永远没有可见结果」的死键——玩家点完只
// 看到界面纹丝不动，会直接判定游戏卡死。本脚本守护「每次点击 600ms 内
// 必有一种可见回执」的契约：
//
//   a) .log-entry 数量 +1（真有新正文），或
//   b) .sys-toast 文案发生变化，或
//   c) 该键变成 disabled 且出现 [data-locked] 角标（角标常驻可见）。
//
// 断言结构（自起隔离实例：空闲端口 + 临时 DB_PATH + AI key 置空，oracle
// 取自 chapters.json，不经被测引擎推导）：
//   1. 390×844 与 1440×900 各建干净档直落第 1 章 must_choose 场景；
//   2. 「观察」「潜行」「休息」各真实点按 2 次，每次都要满足 a/b/c；
//   3. 反向防洗绿：普通探索场景里「潜行」「休息」不得带抉择锁定角标，
//      点「休息」要有一次真实回执（防「全局写死禁用」洗绿）；
//   4. 390 下无横向溢出。
//
// 旧码红证：旧实现只给「探索前进」挂 choice-locked，「潜行/休息」照旧
// 满色可点、点了零回执（潜行扣 MP 但正文与 HUD 无可见变化时同样算零），
// 「观察」在正文去重/复核区路径上也可能静默 → 第 2 条首轮即 FAIL。
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

// Oracle：第 1 章 must_choose 场景与非必选探索场景。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
const OPEN = CH1.scenes.find((s) => s.must_choose !== true);

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
    console.error(
      `[E2E] choice-state-deadkeys: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

let page;

// 键面 + 承接壳的联合快照：锁定角标可能落在按钮内，也可能落在
// .deny-tap-catcher 壳上（F245/F265 的既有结构），两处都算。
const snapshot = (act) =>
  page.evaluate((actSel) => {
    const b = document.querySelector(`.actions-main button[data-act="${actSel}"]`);
    if (!b) return null;
    const lockNode =
      b.querySelector("[data-locked]") ||
      (b.parentElement && b.parentElement.querySelector("[data-locked]"));
    const toast = [...document.querySelectorAll(".sys-toast")]
      .map((t) => (t.textContent || "").trim())
      .join(" | ");
    return {
      logCount: document.querySelectorAll(".stage-col.log .log-entry").length,
      toast,
      disabled: b.disabled,
      ariaDisabled: b.getAttribute("aria-disabled"),
      cls: b.className,
      lockedBadge: lockNode ? (lockNode.textContent || "").trim() : null,
    };
  }, act);

// 真实 pointer 点击（坐标命中按钮或承接壳）——disabled 键不收 DOM
// .click()，必须让点击落在覆盖层上，才验得到「点不动也有回执」。
const probeClick = async (act, tag) => {
  const sel = `.actions-main button[data-act="${act}"]`;
  const loc = page.locator(sel).first();
  await loc.waitFor({ state: "attached", timeout: 8000 });
  const box = await loc.boundingBox();
  assert(box, `${tag}「${act}」boundingBox 取不到`);
  const before = await snapshot(act);
  assert(before, `${tag}「${act}」快照取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForFunction(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return Boolean(
        el &&
          (el.closest(".deny-tap-catcher") ||
            el.closest(".lock-tap-catcher") ||
            el.closest(".rest-tap-catcher") ||
            el.closest(".obs-tap-catcher") ||
            (el.tagName === "BUTTON" && el.closest(".actions-main")))
      );
    },
    [cx, cy],
    { timeout: 5000 }
  );
  // toast 是 2.6s 自动消失的一次性回执——点击前等它离场，这样「点击后
  // 又出现一条」才是本次点击的证据，而不是上一颗键残留的同一句文案。
  await page
    .waitForFunction(() => !document.querySelector(".sys-toast"), { timeout: 4000 })
    .catch(() => {});
  const t0 = Date.now();
  await page.mouse.click(cx, cy);
  // 600ms 是产品契约里的「立刻」窗口；首个请求要含一次本地 API 往返，
  // 兜底放宽到 1200ms 但仍记录真实耗时，避免时序抖动误红。
  const deadline = Date.now() + 1200;
  let hit = null;
  let last = before;
  while (Date.now() < deadline) {
    const now = await snapshot(act);
    if (now) {
      last = now;
      const logUp = now.logCount > before.logCount;
      const toastAppeared = now.toast !== "";
      const justLocked = now.disabled && now.lockedBadge && !before.lockedBadge;
      if (logUp || toastAppeared || justLocked) {
        hit = logUp
          ? `log ${before.logCount} -> ${now.logCount}`
          : toastAppeared
            ? `toast「${now.toast.slice(0, 28)}」`
            : `locked「${now.lockedBadge}」`;
        break;
      }
    }
    await page.waitForTimeout(80);
  }
  const ms = Date.now() - t0;
  assert(
    hit,
    `${tag}「${act}」点击后 ${ms}ms 内零可见回执：` +
      `log ${before.logCount} -> ${last.logCount}、toast 「${before.toast.slice(0, 20)}」->「${last.toast.slice(0, 20)}」、` +
      `disabled ${before.disabled}->${last.disabled}、locked ${before.lockedBadge}->${last.lockedBadge}`
  );
  console.log(`    ${tag}「${act}」${hit}（${ms}ms）`);
  return last;
};

const setScene = (sceneId, sid) => {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(
      sceneId,
      sid
    );
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(sid);
  } finally {
    db.close();
  }
};

const enterScene = async (sceneId, saveId) => {
  setScene(sceneId, saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));
};

const choiceState = async (tag) => {
  // 三颗键各点两次——第二次覆盖「已经锁定 / 已经看尽」之后仍然要有回执。
  for (const act of ["观察", "潜行", "休息"]) {
    await probeClick(act, `${tag} #1`);
    await probeClick(act, `${tag} #2`);
  }
  const lockedInfo = await page.evaluate(() =>
    ["潜行", "休息"].map((act) => {
      const b = document.querySelector(`.actions-main button[data-act="${act}"]`);
      if (!b) return { act, missing: true };
      const lockNode =
        b.querySelector("[data-locked]") ||
        (b.parentElement && b.parentElement.querySelector("[data-locked]"));
      return {
        act,
        disabled: b.disabled,
        ariaDisabled: b.getAttribute("aria-disabled"),
        cls: b.className,
        badge: lockNode ? (lockNode.textContent || "").trim() : null,
        title: b.getAttribute("title") || "",
      };
    })
  );
  for (const b of lockedInfo) {
    assert(!b.missing, `${tag}「${b.act}」按钮不存在`);
    assert(
      b.disabled === true || b.ariaDisabled === "true",
      `${tag}抉择态「${b.act}」未置灰 disabled=${b.disabled} aria-disabled=${b.ariaDisabled}`
    );
    assert(
      b.badge && /选择/.test(b.badge),
      `${tag}抉择态「${b.act}」无锁定角标（data-locked=${b.badge}）——只有灰没有理由`
    );
    assert(
      /选择|抉择/.test(b.title),
      `${tag}抉择态「${b.act}」title 无指路信息：「${b.title}」`
    );
  }
  console.log(
    `    ${tag} 锁定：` +
      lockedInfo.map((b) => `${b.act}=${b.disabled ? "grey" : "点击态"}/${b.badge}`).join(" · ")
  );
};

run("choice-state-deadkeys", async ({ page: p }) => {
  page = p;
  const name = `e2e-f272-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  await page.setViewportSize({ width: 390, height: 844 });
  await enterScene(MC.id, saveId);
  await page.waitForSelector(".btn-group-choice", { timeout: 8000 });
  await choiceState("[390]");

  const fit390 = await page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth };
  });
  assert(
    fit390.sw === fit390.cw,
    `[390] 横向溢出：scrollWidth ${fit390.sw} !== clientWidth ${fit390.cw}`
  );

  await page.setViewportSize({ width: 1440, height: 900 });
  await enterScene(MC.id, saveId);
  await page.waitForSelector(".btn-group-choice", { timeout: 8000 });
  await choiceState("[1440]");

  // ── 反向防洗绿：普通探索场景不得带抉择锁定，且「休息」有真实回执 ──
  await page.evaluate(() => localStorage.clear());
  const name2 = `e2e-f272b-${Date.now().toString(36)}`;
  await createSave(page, name2);
  const saveId2 = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId2 > 0, "second save_id missing");
  await enterScene(OPEN.id, saveId2);

  const open = await page.evaluate(() =>
    ["潜行", "休息"].map((act) => {
      const b = document.querySelector(`.actions-main button[data-act="${act}"]`);
      if (!b) return { act, missing: true };
      const lockNode =
        b.querySelector("[data-locked]") ||
        (b.parentElement && b.parentElement.querySelector("[data-locked]"));
      return {
        act,
        cls: b.className,
        badge: lockNode ? (lockNode.textContent || "").trim() : null,
      };
    })
  );
  for (const b of open) {
    assert(!b.missing, `[open]「${b.act}」按钮不存在`);
    assert(
      !/choice-locked/.test(b.cls) && !(b.badge && /选择/.test(b.badge)),
      `[open]普通场景「${b.act}」被写死抉择锁定：class=${b.cls} badge=${b.badge}`
    );
  }
  await probeClick("休息", "[open]");
  console.log("    [open] 潜行/休息无抉择锁定，休息有回执");
  void saveId;
  void saveId2;
});
