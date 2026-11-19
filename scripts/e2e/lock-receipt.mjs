#!/usr/bin/env node
// lock-receipt.mjs (F307): must_choose 抉择锁定期，点击已禁用的「探索前进」
// 每一次都必须有【可感知且可区分】的回执——
//
//   第105轮线上真实走查（390×844）：must_choose 态「探索前进」disabled=true，
//   连点第 2、3 次 → 日志 0 增长、无 .sys-toast、aria-live 文本零变化、无抖动，
//   截图逐字节相同——回执在 DOM 层触发了，但在屏幕上是「等幂」的：同一文案
//   的 toast 重挂载零像素差、data-denied 460ms 窗内恒为 "1" 抖动不重播、
//   #act-lock-reason 是常显文案不算回执。玩家只能判定「游戏把点击吞了」。
//   （intuitive-game-design Q5 Immediate 层缺失 + game-detail-bar §9c）
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空），DB 直落第 1 章
//   must_choose 场景，真实 pointer 点击（page.mouse.click 坐标命中，非 DOM
//   .click()——disabled 键不收 .click()，必须打在 .deny-tap-catcher 壳上）：
//     a) 每次点击 300ms 内出现可见回执节点：#act-lock-reason 可见且非空、
//        或 .sys-toast 可见、或其一文本发生变化；
//     b) aria-live 通道逐击有增量：任一 [role="status"]/[aria-live] 节点
//        的 data-receipt-seq 递增，或其文本与点击前不同（同一文案重挂载、
//        屏幕零变化不算回执——「已提示 ×N」/seq 都算可区分增量）；
//     c) 3 次点击后 .stage-col.log 子行零增长（不许往正文塞系统行伪造回执）；
//     d) 键盘同口径：Tab/聚焦壳后 Enter、快捷键 1 都要点亮同一回执；
//     e) 反向洗绿：非 must_choose 档真实点击「前进」正文增量 >0、无拒绝
//        文案，且可点态 .deny-tap-catcher 不包住「前进」键；
//     f) 390 下 scrollWidth===clientWidth，回执不得撑出横向滚动。
//
//   旧码红证：旧实现连点同键时 toast 文案逐字相同、壳上无 seq——
//   b) 在第 2 击即 FAIL（aria-live 通道零增量）。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f307-"));
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
      `[E2E] lock-receipt: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

let page;

// ── 快照 ─────────────────────────────────────────────────────────
// liveSig：aria-live 通道逐击增量签名——[role="status"]/[aria-live]/
// [data-receipt-seq] 节点的 textContent+seq 拼接。回执「等幂」（同文
// 案重挂载、零 seq）时连点签名不变，与第105轮「aria-live 文本零变化」
// 同口径。
const liveSig = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="status"],[aria-live],[data-receipt-seq]')]
      .map(
        (n) =>
          `${n.className}|${(n.textContent || "").trim()}|${n.getAttribute("data-receipt-seq") || ""}`
      )
      .join(";;")
  );

const snap = () =>
  page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        Number(cs.opacity) > 0.05
      );
    };
    const lr = document.getElementById("act-lock-reason");
    const toasts = [...document.querySelectorAll(".sys-toast")];
    return {
      lockReasonVisible: vis(lr),
      lockReasonText: (lr?.textContent || "").trim(),
      toastVisible: toasts.some(vis),
      toastText: toasts.map((t) => (t.textContent || "").trim()).join("|"),
      toastSeq: toasts.map((t) => t.getAttribute("data-receipt-seq") || "").join("|"),
      logRows: document.querySelector(".stage-col.log")?.children.length ?? -1,
    };
  });

// a)+b) 合并判定：300ms 窗口内轮询——可见回执节点 AND aria 通道有增量；
// expectShake 时另断言壳上 getAnimations() 非空（deny-shake 逐击重播——
// 300ms 轮询窗 < 320ms 抖动时长，采样必落在动画进行中）。
const receiptWithin300 = async (beforeLive, beforeSnap, expectShake = false) => {
  try {
    await page.waitForFunction(
      ({ prev, wantShake }) => {
        const vis = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            cs.display !== "none" &&
            cs.visibility !== "hidden" &&
            Number(cs.opacity) > 0.05
          );
        };
        const lr = document.getElementById("act-lock-reason");
        const toasts = [...document.querySelectorAll(".sys-toast")];
        // a) 可见回执节点
        const visibleReceipt =
          (vis(lr) && (lr.textContent || "").trim().length > 0) ||
          toasts.some(vis);
        if (!visibleReceipt) return false;
        // b) aria-live 通道逐击增量（seq 递增 或 文本变化）
        const sig = [
          ...document.querySelectorAll('[role="status"],[aria-live],[data-receipt-seq]'),
        ]
          .map(
            (n) =>
              `${n.className}|${(n.textContent || "").trim()}|${n.getAttribute("data-receipt-seq") || ""}`
          )
          .join(";;");
        if (sig === prev) return false;
        if (wantShake) {
          const shell = document.querySelector(
            '.deny-tap-catcher[data-denied="1"]'
          );
          return !!shell && shell.getAnimations().length > 0;
        }
        return true;
      },
      { prev: beforeLive, wantShake: expectShake },
      { timeout: 300, polling: 20 }
    );
    return true;
  } catch {
    return false;
  }
};

// 「探索前进」键中心坐标——命中点必须落在承接壳/键本体上（抽屉滑出
// 动画期间会短暂盖住底栏左缘），拿到稳定命中再点。
const forwardPoint = async (tag) => {
  const loc = page.locator("button", { hasText: "前进" }).first();
  const box = await loc.boundingBox();
  assert(box, `${tag}: 「前进」键 boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForFunction(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return (
        el &&
        (el.closest(".deny-tap-catcher") ||
          el.closest(".lock-tap-catcher") ||
          (el.tagName === "BUTTON" && /前进/.test(el.innerText || "")))
      );
    },
    [cx, cy],
    { timeout: 5000 }
  );
  return { cx, cy };
};

run("lock-receipt", async ({ page: p }) => {
  page = p;
  const name = `e2e-f307-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  const setScene = (sceneId, sid) => {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare(
        "UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?"
      ).run(sceneId, sid);
      db.prepare("DELETE FROM combat WHERE save_id = ?").run(sid);
    } finally {
      db.close();
    }
  };
  setScene(MC.id, saveId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  // 前置：锁定态本身成立（disabled + 常显原因在屏）
  const pre = await snap();
  assert(
    pre.lockReasonVisible && pre.lockReasonText.length > 0,
    `must_choose 态 #act-lock-reason 不可见/为空（第102轮落地件回归）text=「${pre.lockReasonText}」`
  );
  const fwd = page.locator('[data-act="前进"]').first();
  assert(
    (await fwd.evaluate((el) => el.disabled === true)) === true,
    "must_choose 态「探索前进」未 disabled"
  );
  // 承接壳在场——真实点击能落在壳上而不是被 disabled 吞掉。
  const shellInfo = await fwd.evaluate((el) => {
    const shell = el.closest(".deny-tap-catcher");
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {
      hasShell: !!shell,
      hitInShell: !!(hit && hit.closest(".deny-tap-catcher")),
      hitTag: hit ? hit.tagName + "." + hit.className : "null",
    };
  });
  assert(
    shellInfo.hasShell && shellInfo.hitInShell,
    `锁定键中心命中点不在承接壳上（hasShell=${shellInfo.hasShell} hit=${shellInfo.hitTag}）——点击会被 disabled 键吞掉`
  );
  console.log(`    [390] 锁定成立：disabled=true #act-lock-reason=「${pre.lockReasonText.slice(0, 24)}…」 壳命中=${shellInfo.hitTag}`);

  // ── a)+b)+c)：真实 pointer 连点 3 次，每次 300ms 内可见回执 + aria 增量
  const { cx, cy } = await forwardPoint("[390]");
  const rows0 = (await snap()).logRows;
  for (let i = 1; i <= 3; i++) {
    const bLive = await liveSig();
    const bSnap = await snap();
    await page.mouse.click(cx, cy);
    const ok = await receiptWithin300(bLive, bSnap, true);
    const aSnap = await snap();
    assert(
      ok,
      `第 ${i} 击 300ms 内零可区分回执（toast=「${aSnap.toastText}」 seq=${aSnap.toastSeq} lockReason=${aSnap.lockReasonVisible}）`
    );
    console.log(
      `    [390] 第 ${i} 击回执 ok：toast=「${aSnap.toastText.slice(0, 46)}」 seq=${aSnap.toastSeq} 日志=${aSnap.logRows}`
    );
    if (i < 3) await page.waitForTimeout(450);
  }
  // c) 正文零增长——回执必须走瞬时层，不许污染叙事日志
  const rows1 = (await snap()).logRows;
  assert(
    rows1 === rows0,
    `3 次拒绝点击改了日志条目 ${rows0} -> ${rows1}（回执不许落正文）`
  );

  // f) 390 无横向溢出
  const fit = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(fit.sw === fit.cw, `[390] 横向溢出 ${fit.sw} > ${fit.cw}`);

  // ── d) 键盘通道同口径 ──────────────────────────────────────────
  // 聚焦「探索前进」的承接壳按 Enter——壳 role=button tabIndex=0，
  // Enter/Space 与 pointer 同一条 denyAction 路径。
  const shellLoc = page.locator(".deny-tap-catcher", { has: page.locator('[data-act="前进"]') }).first();
  assert((await shellLoc.count()) > 0, "找不到包住「前进」键的承接壳");
  await shellLoc.focus();
  {
    const bLive = await liveSig();
    await page.keyboard.press("Enter");
    const ok = await receiptWithin300(bLive, await snap(), true);
    assert(ok, "键盘 Enter 点亮拒绝回执失败——壳上回执只接了鼠标一条路");
    console.log(`    [kbd] Enter → ${(await snap()).toastText.slice(0, 46)}`);
  }
  // 快捷键 1：window keydown 的 ACTION_BUTTONS 派发——must_choose 下与
  // 按钮同口径就地弹指路提示，不静默发必拒请求。
  {
    const bLive = await liveSig();
    await page.keyboard.press("1");
    const ok = await receiptWithin300(bLive, await snap());
    assert(ok, "快捷键 1 点亮拒绝回执失败");
    console.log(`    [kbd] 快捷键 1 → ${(await snap()).toastText.slice(0, 46)}`);
  }

  // ── e) 反向洗绿：非 must_choose 档，「前进」可点且真推进 ─────────
  await page.evaluate(() => localStorage.clear());
  const name2 = `e2e-f307b-${Date.now().toString(36)}`;
  await createSave(page, name2);
  const saveId2 = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId2 > 0, "second save_id missing");
  setScene(OPEN.id, saveId2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  const openBtn = await page
    .locator("button", { hasText: "前进" })
    .first()
    .evaluate((el) => ({
      disabled: el.disabled,
      inShell: !!el.closest(".deny-tap-catcher"),
    }));
  assert(openBtn.disabled === false, `[open] 「前进」被写死禁用`);
  assert(
    openBtn.inShell === false,
    `[open] 可点态「前进」仍被 .deny-tap-catcher 包住——拒绝壳越界接管正常键`
  );
  const stageKids = () =>
    page.evaluate(() => document.querySelector(".stage-col").children.length);
  const n0 = await stageKids();
  const respP = page.waitForResponse(
    (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
    { timeout: 15000 }
  );
  const { cx: ox, cy: oy } = await forwardPoint("[open]");
  await page.mouse.click(ox, oy);
  await respP;
  await page.waitForFunction(() => !document.querySelector(".pending"));
  const n1 = await stageKids();
  assert(n1 > n0, `[open] 真实点击「前进」正文无增量 ${n0} -> ${n1}`);
  const openSnap = await snap();
  assert(
    !/抉择未定|先选一个|先做出选择/.test(openSnap.toastText),
    `[open] 正常推进出现拒绝文案「${openSnap.toastText}」——回执误伤可点态`
  );
  console.log(`    [open] disabled=false 壳=无 正文 ${n0} -> ${n1} 无拒绝文案`);

  console.log("    [pass] F307：锁定键逐击可区分回执（鼠标×3 / Enter / 快捷键1 / aria-live）+ 零日志污染 + 可点态不越界");
});
