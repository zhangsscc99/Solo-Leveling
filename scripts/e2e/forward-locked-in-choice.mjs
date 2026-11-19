#!/usr/bin/env node
// forward-locked-in-choice.mjs (F247): must_choose 未决时「前进」必须
// 置灰为不可点，不再是「看得见、按得动、永远无效」的死选项——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落第 1 章 must_choose 场景（oracle 取自 chapters.json，不经被测
//   引擎推导）：
//     a) 390 视口：页面上所有 innerText 含「前进」的按钮，逐个断言
//        disabled 或 aria-disabled==="true"，且计算样式 opacity<=0.5；
//        至少存在 1 个（防「一个都没渲染」空过）；
//     b) 1440 视口重复 a)——响应式两档同口径；
//     c) 该按钮 title 非空且含「选择/抉择」指路字样，不是「快捷键 N」
//        这种无信息文案；
//     d) 反向：另起一个非 must_choose 的普通探索新档，断言同槽位按钮
//        disabled===false 且 opacity>0.5，点一次正文增量>0——防「全局
//        写死禁用」洗绿；
//     e) 390 下 document.documentElement.scrollWidth===clientWidth。
//
//   旧码红证：旧实现只按 busy||restBlocked 置 disabled，must_choose
//   里「探索前进」disabled===false、opacity=1、cta-primary 满色高亮
//   仍在 → a) 首条断言即 FAIL。
//
//   F265 增量（本文件在 F247 断言之上扩展，不放宽任何旧断言）：
//   disabled 只是「不能点」，视觉 signifier 仍不够——与同排可点键同高
//   同形、仅略暗，点了零回执。新增三条（390/1440 两视口同口径）：
//     f) 锁定标记：键内存在 [data-locked] 角标且文案含「选择」，或
//        该键 offsetHeight ≤ 同排可点键最高值 - 8；
//     g) 质感差：与同排可点键 opacity 差 ≥0.25，或 filter 含 grayscale；
//     h) 真实 pointer 点击（page.mouse.click 坐标命中）出可见拒绝反馈：
//        .sys-toast 文案含「选择/抉择」或 .log 子行 +1。
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

// Oracle：第 1 章 must_choose 场景与非必选探索场景，不经被测引擎。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f247-"));
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
      `[E2E] forward-locked-in-choice: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

// 页面上所有含「前进」字样的按钮逐个体检——口径天然覆盖将来新增的
// 正文入口（本仓库现阶段只有行动组一颗，不为对齐文案新造入口）。
const forwardBtns = () =>
  page.$$eval("button", (btns) =>
    btns
      .filter((b) => /前进/.test(b.innerText || ""))
      .map((b) => {
        const cs = getComputedStyle(b);
        // 同排可点键：同一 .btn-group 内未禁用的按钮——锁定态要与它们
        // 拉开质感/体量差，测量口径就地取邻居而不是全局按钮。
        const sibs = b.closest(".btn-group")
          ? [...b.closest(".btn-group").querySelectorAll("button:not(:disabled)")]
          : [];
        // [data-locked] 角标可在键面内，也可落在承接壳（.lock-tap-
        // catcher）上——两处都算「该键的锁定标记」。
        const lockNode =
          b.querySelector("[data-locked]") ||
          (b.parentElement && b.parentElement.querySelector("[data-locked]"));
        return {
          text: (b.innerText || "").trim().slice(0, 24),
          disabled: b.disabled,
          ariaDisabled: b.getAttribute("aria-disabled"),
          opacity: Number(cs.opacity),
          filter: cs.filter,
          height: b.offsetHeight,
          maxClickableHeight: sibs.length
            ? Math.max(...sibs.map((s) => s.offsetHeight))
            : 0,
          maxClickableOpacity: sibs.length
            ? Math.max(...sibs.map((s) => Number(getComputedStyle(s).opacity)))
            : 1,
          lockText: lockNode ? (lockNode.textContent || "").trim() : null,
          title: b.getAttribute("title") || "",
        };
      })
  );

let page; // forwardBtns 在 run 回调外也要用

const checkLocked = async (tag) => {
  const btns = await forwardBtns();
  assert(btns.length >= 1, `${tag}: 页面上没有任何含「前进」的按钮`);
  for (const b of btns) {
    assert(
      b.disabled === true || b.ariaDisabled === "true",
      `${tag}: 「${b.text}」未置灰 disabled=${b.disabled} aria-disabled=${b.ariaDisabled}`
    );
    assert(
      b.opacity <= 0.5,
      `${tag}: 「${b.text}」opacity=${b.opacity} > 0.5——disabled 但仍满色高亮`
    );
    // F265(f)：锁定标记——[data-locked] 角标文案含「选择」，或键体比
    // 同排可点键矮 ≥8px；两者都不满足即「只是略暗」不够 signifier。
    const hasBadge = b.lockText !== null && /选择/.test(b.lockText);
    const shrunk =
      b.maxClickableHeight > 0 && b.height <= b.maxClickableHeight - 8;
    assert(
      hasBadge || shrunk,
      `${tag}: 「${b.text}」无锁定标记：data-locked=${b.lockText} ` +
        `height=${b.height} vs 同排可点最高=${b.maxClickableHeight}`
    );
    // F265(g)：质感差——与相邻可点键 opacity 差 ≥0.25，或 grayscale。
    const opacityGap = b.maxClickableOpacity - b.opacity;
    assert(
      opacityGap >= 0.25 || /grayscale/.test(b.filter),
      `${tag}: 「${b.text}」与可点键质感差不足：opacity gap=${opacityGap.toFixed(2)} filter=${b.filter}`
    );
  }
  return btns;
};

// F265(h)：真实 pointer 点击（坐标命中，不是 DOM .click()——disabled 键
// 不收 .click()，必须落在承接壳上）要出可见拒绝反馈：.sys-toast 文案含
// 「选择/抉择」，或 .log 子行 +1。
const clickLockedForward = async (tag) => {
  const logRows = () =>
    page.evaluate(
      () => document.querySelector(".stage-col.log")?.children.length ?? -1
    );
  const loc = page.locator("button", { hasText: "前进" }).first();
  const box = await loc.boundingBox();
  assert(box, `${tag}: 「前进」键 boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  // 抽屉侧栏滑出动画期间会短暂盖住底栏左缘——等命中点稳定落在
  // 承接壳/按钮本体上再点击，不做固定 sleep。
  await page.waitForFunction(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return (
        el &&
        (el.closest(".lock-tap-catcher") ||
          (el.tagName === "BUTTON" && /前进/.test(el.innerText || "")))
      );
    },
    [cx, cy],
    { timeout: 5000 }
  );
  const n0 = await logRows();
  await page.mouse.click(cx, cy);
  let toasted = true;
  try {
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll(".sys-toast")].some((t) =>
          /选择|抉择/.test(t.textContent || "")
        ),
      { timeout: 3000 }
    );
  } catch {
    toasted = false;
  }
  if (!toasted) {
    const n1 = await logRows();
    assert(
      n1 === n0 + 1,
      `${tag}: 真实点击锁定「前进」零反馈——无 .sys-toast，.log 行数 ${n0} -> ${n1}`
    );
    console.log(`    ${tag} 点击反馈：.log ${n0} -> ${n1}`);
  } else {
    console.log(`    ${tag} 点击反馈：.sys-toast 指路文案`);
  }
};

run("forward-locked-in-choice", async ({ page: p }) => {
  page = p;
  const name = `e2e-f247-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景：清交战、清遭遇冷却，回灌后选项组就位。
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
  setScene(MC.id, saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  // ── (a) 390 视口：所有「前进」按钮置灰且 opacity<=0.5 ──────────
  await page.setViewportSize({ width: 390, height: 844 });
  const btns390 = await checkLocked("[390]");
  for (const b of btns390)
    console.log(
      `    [390] 「${b.text}」disabled=${b.disabled} aria=${b.ariaDisabled} opacity=${b.opacity}`
    );
  await clickLockedForward("[390]");

  // ── (e) 390 下无横向溢出 ──────────────────────────────────────
  const fit390 = await page.evaluate(() => {
    const de = document.documentElement;
    return { sw: de.scrollWidth, cw: de.clientWidth };
  });
  assert(
    fit390.sw === fit390.cw,
    `[390] 横向溢出：scrollWidth ${fit390.sw} !== clientWidth ${fit390.cw}`
  );

  // ── (b) 1440 视口同口径 ───────────────────────────────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  const btns1440 = await checkLocked("[1440]");
  for (const b of btns1440)
    console.log(
      `    [1440] 「${b.text}」disabled=${b.disabled} aria=${b.ariaDisabled} opacity=${b.opacity}`
    );
  await clickLockedForward("[1440]");

  // ── (c) title 给可执行理由，不是「快捷键 N」无信息文案 ─────────
  for (const b of btns1440) {
    assert(b.title.length > 0, `[title] 「${b.text}」title 为空`);
    assert(
      /选择|抉择/.test(b.title),
      `[title] 「${b.text}」title 无指路信息：「${b.title}」`
    );
  }
  console.log(`    [title] 「${btns1440[0].title}」`);

  // ── (d) 反向：非 must_choose 新档同槽位可点且能推进 ────────────
  // 建档闸口会被 localStorage 里的旧档跳过——先清掉再走新档流程。
  await page.evaluate(() => localStorage.clear());
  const name2 = `e2e-f247b-${Date.now().toString(36)}`;
  await createSave(page, name2);
  const saveId2 = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId2 > 0, "second save_id missing");
  setScene(OPEN.id, saveId2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  const open = await forwardBtns();
  assert(open.length >= 1, "[open] 普通探索场景没有「前进」按钮");
  for (const b of open) {
    assert(
      b.disabled === false,
      `[open] 「${b.text}」被写死禁用 disabled=${b.disabled}`
    );
    assert(
      b.opacity > 0.5,
      `[open] 「${b.text}」opacity=${b.opacity} <= 0.5——非锁定态也发暗`
    );
  }
  const stageKids = () =>
    page.evaluate(() => document.querySelector(".stage-col").children.length);
  const n0 = await stageKids();
  const respP = page.waitForResponse(
    (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
    { timeout: 15000 }
  );
  await page.locator("button", { hasText: "前进" }).first().click();
  await respP;
  await page.waitForFunction(() => !document.querySelector(".pending"));
  const n1 = await stageKids();
  assert(n1 > n0, `[open] 点击「前进」正文无增量 ${n0} -> ${n1}`);
  console.log(`    [open] disabled=false opacity=${open[0].opacity} 正文 ${n0} -> ${n1}`);
});
