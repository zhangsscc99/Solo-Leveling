#!/usr/bin/env node
// must-choose-feedback.mjs (F317): must_choose 抉择锁定期，「探索前进 /
// 潜行 / 休息」三个 disabled 主键的每一次真实 pointer 点击都必须有
// 【可见且可区分】的回执——
//
//   第110轮线上真实走查（390×844 干净档）：must_choose 态三键
//   disabled=true、文案带「需先选择」，玩家点击零回执——无 toast、
//   无日志、无焦点转移、无抖动；2.4s×3 连点后整屏完全静止
//   （clickLabel 返回 {clicked:false}，logCount 13→13，toasts:[]）。
//   F307 只承接了「探索前进」单键，同屏的「潜行」「休息」没覆盖。
//   （intuitive-game-design Q5「三层反馈缺 Post 层」+ Q2 Affordance gap）
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空），DB 直落第 1 章
//   must_choose 场景，真实 pointer 点击（page.mouse.click 坐标命中，非 DOM
//   .click()——disabled 键不收 .click()，必须打在 .deny-tap-catcher 壳上）：
//     a) 对「探索前进 / 潜行 / 休息」三个 disabled 主键各真实点击一次，
//        500ms 内每次都有可见反馈：.sys-toast 可见且非空，或
//        #act-lock-reason 可见且文本发生变化，或焦点落到
//        .btn-group-choice .btn 且该组挂 .attn 高亮（三者至少其一）；
//     b) 三次点击间反馈签名（文案 + data-receipt-seq + aria-live 快照）
//        不完全相同——同文案零像素重挂载不算回执；
//     c) 点击前后 .stage-col.log / .stage-col 行数不变（不许往正文塞
//        伪造回执行）；
//     d) 390 下 documentElement.scrollWidth === clientWidth；
//     e) 键盘同口径：Tab/聚焦承接壳后 Enter、快捷键 1 死键都要点亮回执；
//     f) 反向洗绿：非 must_choose 档三键可点、无 .deny-tap-catcher 包住、
//        真实点击「前进」正文增量 >0、无拒绝 toast。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f317-"));
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
      `[E2E] must-choose-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

let page;

// 回执快照：瞬时层（toast / #act-lock-reason / 选项组高亮 / aria-live 通道
// seq）+ 正文行数。反馈签名为这些字段的拼接——同文案零像素重挂载时
// data-receipt-seq 仍逐击自增，签名必变。
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
    const group = document.querySelector(".btn-group-choice");
    const active = document.activeElement;
    return {
      lockReasonVisible: vis(lr),
      lockReasonText: (lr?.textContent || "").trim(),
      toastVisible: toasts.some(vis),
      toastText: toasts.map((t) => (t.textContent || "").trim()).join("|"),
      toastSeq: toasts.map((t) => t.getAttribute("data-receipt-seq") || "").join("|"),
      choiceAttn: !!(group && group.classList.contains("attn")),
      focusOnChoice: !!(active && active.closest && active.closest(".btn-group-choice")),
      liveSig: [...document.querySelectorAll('[role="status"],[aria-live],[data-receipt-seq]')]
        .map(
          (n) =>
            `${n.className}|${(n.textContent || "").trim()}|${n.getAttribute("data-receipt-seq") || ""}`
        )
        .join(";;"),
      stageRows: document.querySelector(".stage-col")?.children.length ?? -1,
      logRows: document.querySelector(".stage-col.log")?.children.length ?? -1,
    };
  });

const feedbackSig = (s) =>
  `${s.toastText}#${s.toastSeq}#${s.lockReasonText}#attn:${s.choiceAttn}#focus:${s.focusOnChoice}#${s.liveSig}`;

const hasVisibleFeedback = (s, beforeText) =>
  (s.toastVisible && s.toastText.length > 0) ||
  (s.lockReasonVisible && s.lockReasonText !== beforeText) ||
  (s.focusOnChoice && s.choiceAttn);

// 500ms 窗口内轮询等待可见反馈成立；返回成立时的快照，超时返回 null。
const receiptWithin500 = async (beforeSnap) => {
  try {
    await page.waitForFunction(
      ({ prevText }) => {
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
        const group = document.querySelector(".btn-group-choice");
        const active = document.activeElement;
        const toastOk = toasts.some(vis) && toasts.some((t) => (t.textContent || "").trim().length > 0);
        const reasonOk =
          vis(lr) && (lr.textContent || "").trim() !== prevText;
        const focusOk =
          !!(active && active.closest && active.closest(".btn-group-choice")) &&
          !!(group && group.classList.contains("attn"));
        return toastOk || reasonOk || focusOk;
      },
      { prevText: beforeSnap.lockReasonText },
      { timeout: 500, polling: 20 }
    );
    return await snap();
  } catch {
    return null;
  }
};

// 键中心坐标——命中点必须落在承接壳上（抽屉滑出动画期间会短暂盖住底栏
// 左缘），拿到稳定命中再点。
const keyPoint = async (act, tag) => {
  const loc = page.locator(`[data-act="${act}"]`).first();
  const box = await loc.boundingBox();
  assert(box, `${tag}: 「${act}」键 boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForFunction(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest(".deny-tap-catcher"));
    },
    [cx, cy],
    { timeout: 5000 }
  );
  return { cx, cy };
};

run("must-choose-feedback", async ({ page: p }) => {
  page = p;
  const name = `e2e-f317-${Date.now().toString(36)}`;
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

  // 前置：锁定态成立——三键 disabled + 各自包承接壳 + 常显原因在屏。
  const LOCKED = ["前进", "潜行", "休息"];
  for (const act of LOCKED) {
    const info = await page
      .locator(`[data-act="${act}"]`)
      .first()
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return {
          disabled: el.disabled === true,
          inShell: !!el.closest(".deny-tap-catcher"),
          hitInShell: !!(hit && hit.closest(".deny-tap-catcher")),
          hitTag: hit ? `${hit.tagName}.${hit.className}` : "null",
          h: r.height,
        };
      });
    assert(info.disabled, `must_choose 态「${act}」未 disabled`);
    assert(
      info.inShell && info.hitInShell,
      `「${act}」中心命中点不在承接壳上（inShell=${info.inShell} hit=${info.hitTag}）——点击会被 disabled 键吞掉`
    );
    assert(info.h >= 44, `「${act}」触控高度 ${info.h}px < 44（F301 尺寸规范）`);
  }
  const pre = await snap();
  assert(
    pre.lockReasonVisible && pre.lockReasonText.length > 0,
    `must_choose 态 #act-lock-reason 不可见/为空 text=「${pre.lockReasonText}」`
  );
  console.log(
    `    [390] 锁定成立：三键 disabled+壳 #act-lock-reason=「${pre.lockReasonText.slice(0, 24)}…」`
  );

  // ── a)+b)+c)：对三个 disabled 主键各真实点击一次 ──────────────
  const rows0 = await snap();
  const sigs = [];
  for (const act of LOCKED) {
    const { cx, cy } = await keyPoint(act, "[390]");
    const before = await snap();
    await page.mouse.click(cx, cy);
    const after = await receiptWithin500(before);
    assert(
      after,
      `「${act}」点击 500ms 内零可见回执（无 toast / #act-lock-reason 未变 / 选项组未点亮）`
    );
    sigs.push(feedbackSig(after));
    console.log(
      `    [390] 「${act}」回执 ok：toast=「${after.toastText.slice(0, 40)}」 seq=${after.toastSeq} attn=${after.choiceAttn} 日志=${after.logRows}`
    );
    // 间隔一段让 deny-shake/toast 周期错开，避免签名被同帧快照混在一起。
    await page.waitForTimeout(350);
  }
  assert(
    new Set(sigs).size === LOCKED.length,
    `三次点击回执签名完全相同——同文案零像素重挂载不算可区分回执（sigs=${sigs.length} unique=${new Set(sigs).size}）`
  );

  // c) 正文零增长——回执必须走瞬时层，不许污染叙事日志
  const rows1 = await snap();
  assert(
    rows1.logRows === rows0.logRows && rows1.stageRows === rows0.stageRows,
    `三次拒绝点击改了正文行数 log ${rows0.logRows}->${rows1.logRows} stage ${rows0.stageRows}->${rows1.stageRows}（回执不许落正文）`
  );

  // d) 390 无横向溢出
  const fit = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(fit.sw === fit.cw, `[390] 横向溢出 ${fit.sw} > ${fit.cw}`);

  // ── e) 键盘通道同口径 ──────────────────────────────────────────
  // Tab 聚焦「潜行」承接壳后 Enter——壳 role=button tabIndex=0，
  // Enter/Space 与 pointer 同一条 denyAction 路径。
  const shellLoc = page
    .locator(".deny-tap-catcher", { has: page.locator('[data-act="潜行"]') })
    .first();
  assert((await shellLoc.count()) > 0, "找不到包住「潜行」键的承接壳");
  await shellLoc.focus();
  {
    const before = await snap();
    await page.keyboard.press("Enter");
    const after = await receiptWithin500(before);
    assert(after, "键盘 Enter 点亮「潜行」拒绝回执失败——壳上回执只接了鼠标一条路");
    console.log(`    [kbd] Enter → ${after.toastText.slice(0, 40)}`);
  }
  // 快捷键 1：must_choose 下与按钮同口径就地弹指路提示，不静默发必拒请求。
  {
    const before = await snap();
    await page.keyboard.press("1");
    const after = await receiptWithin500(before);
    assert(after, "快捷键 1 点亮拒绝回执失败");
    console.log(`    [kbd] 快捷键 1 → ${after.toastText.slice(0, 40)}`);
  }

  // ── f) 反向洗绿：非 must_choose 档，三键可点且「前进」真推进 ──────
  await page.evaluate(() => localStorage.clear());
  const name2 = `e2e-f317b-${Date.now().toString(36)}`;
  await createSave(page, name2);
  const saveId2 = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId2 > 0, "second save_id missing");
  setScene(OPEN.id, saveId2);
  // 满状态时「休息」按 F086 配额口径合法禁用（restBlocked 走
  // rest-tap-catcher，与本次的抉择锁无关）——洗绿要验的是「三键可点」，
  // 先掉一格血让休息恢复可点。
  {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE saves SET hp = max(1, max_hp - 10) WHERE id = ?").run(saveId2);
    } finally {
      db.close();
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  for (const act of LOCKED) {
    const st = await page
      .locator(`[data-act="${act}"]`)
      .first()
      .evaluate((el) => ({
        disabled: el.disabled,
        inShell: !!el.closest(".deny-tap-catcher"),
      }));
    assert(st.disabled === false, `[open] 「${act}」被写死禁用`);
    assert(
      st.inShell === false,
      `[open] 可点态「${act}」仍被 .deny-tap-catcher 包住——拒绝壳越界接管正常键`
    );
  }
  const stageKids = () =>
    page.evaluate(() => document.querySelector(".stage-col").children.length);
  const n0 = await stageKids();
  const respP = page.waitForResponse(
    (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
    { timeout: 15000 }
  );
  const fwdLoc = page.locator('[data-act="前进"]').first();
  const fbox = await fwdLoc.boundingBox();
  assert(fbox, "[open] 「前进」键 boundingBox 取不到");
  await page.mouse.click(fbox.x + fbox.width / 2, fbox.y + fbox.height / 2);
  await respP;
  await page.waitForFunction(() => !document.querySelector(".pending"));
  const n1 = await stageKids();
  assert(n1 > n0, `[open] 真实点击「前进」正文无增量 ${n0} -> ${n1}`);
  const openSnap = await snap();
  assert(
    !/抉择未定|先选一个|先做出选择/.test(openSnap.toastText),
    `[open] 正常推进出现拒绝文案「${openSnap.toastText}」——回执误伤可点态`
  );
  console.log(`    [open] 三键可点无壳 正文 ${n0} -> ${n1} 无拒绝文案`);

  console.log(
    "    [pass] F317：must_choose 三 disabled 主键逐击可见且可区分回执（鼠标/Enter/快捷键1）+ 零日志污染 + 可点态不越界"
  );
});
