#!/usr/bin/env node
// observe-mustchoose-prose.mjs (F244): must_choose 场景的观察正文不得
// 把整段选项清单逐字拼进每一行——
//
//   第 51 轮走查实测：ch1_law 连点「环顾四周」6 次，第 3–6 次行尾逐字
//   重复「必须做出选择——说「按石碑所写，低头敬拜」、「退到石柱后…」
//   或「趁乱往石门方向逃」」，第 4 次同一行内这串选项名出现 2 次（正文
//   句尾一遍 + 尾注一遍）。违反 game-detail-bar §5「Content that never
//   repeats」与 narrative-systems-designer 的 Info Dump 反模式。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落第 1 章 must_choose 场景（oracle 取自 chapters.json，与
//   dwell-guidance.mjs / disabled-denied-feedback.mjs 同口径），连点
//   「环顾四周」6 次，逐次取新增 .log-entry 的 innerText 断言：
//     ① 单行内「必须做出选择」出现次数 ≤1；
//     ② 单行内每个真实选项名（「按石碑所写」整串等）出现次数 ≤1；
//     ③ 单行括号嵌套层数 ≤1（「（」「）」配对深度峰值 ≤1）；
//     ④ 6 次新增正文去重后的描述句 ≥4 句——不许靠删字把内容删空。
//
//   旧码红证：旧码第 3–6 次段尾逐字复读整串选项名，第 4 次单行内出现
//   2 次——断言②在第一次复核区正文即 FAIL。
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

// Oracle：第 1 章首个 must_choose 场景与它的真实选项 label，不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
const LABELS = (MC && Array.isArray(MC.choices) ? MC.choices : [])
  .map((c) => (c && typeof c.label === "string" ? c.label : ""))
  .filter(Boolean);

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f244-"));
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
      `[E2E] observe-mustchoose-prose: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const ACTION_RESP = (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname);
const ENTRY_SEL = ".stage-col .log-entry";

const count = (s, sub) => (sub ? s.split(sub).length - 1 : 0);

// 同一行（单个 .log-entry innerText 的每个物理行）里全角/半角括号的
// 配对深度峰值。
function maxParenDepth(text) {
  let peak = 0;
  for (const line of String(text).split("\n")) {
    let depth = 0;
    for (const ch of line) {
      if (ch === "（" || ch === "(") depth += 1;
      if (ch === "）" || ch === ")") depth = Math.max(0, depth - 1);
      if (depth > peak) peak = depth;
    }
  }
  return peak;
}

// 「描述句」口径：剥掉整段括注尾注后按句切，取非空句。括注是指路/计数
// 的系统腔，剥掉后剩下的才是正文本身的景物/状态描述。
function descriptionSentences(text) {
  return String(text)
    .replace(/（[^（）]*）/g, "")
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4);
}

assert(MC && LABELS.length >= 2, "oracle: ch1 must_choose scene/choices missing");

run("observe-mustchoose-prose", async ({ page }) => {
  const name = `e2e-f244-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（dwell-guidance.mjs 同口径）：清交战、清遭遇
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

  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const observeBtn = page.locator(".actions-main .btn", { hasText: "环顾四周" }).first();
  assert((await observeBtn.count()) > 0, "找不到「环顾四周」行动键");

  const entryCount = () => page.locator(ENTRY_SEL).count();
  const newEntries = async (from) =>
    page.$$eval(ENTRY_SEL, (els, n) => els.slice(n).map((e) => e.innerText || ""), from);

  const lines = [];
  for (let i = 0; i < 6; i++) {
    // F314：免费细看用尽后「环顾四周」整键置灰（disabled + 承接壳，
    // 点击只弹 .sys-toast、零新增 .log-entry）——驱动路径跳过禁用键，
    // 只对仍产出正文的点击取证，断言口径不变。
    if (await observeBtn.isDisabled().catch(() => false)) {
      console.log(`    OBS${i + 1} 键已锁（细看已尽）——跳过，已取 ${lines.length} 份正文`);
      break;
    }
    const before = await entryCount();
    const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
    await observeBtn.click();
    const resp = await respP;
    const body = await resp.json().catch(() => null);
    assert(
      body && body.reply && body.refused !== true,
      `观察第 ${i + 1} 次被拒或回包缺 reply（HTTP ${resp.status()}）`
    );
    await waitIdle();
    await page.waitForFunction((n) => document.querySelectorAll(".stage-col .log-entry").length > n, before);
    const added = (await newEntries(before)).map((t) => t.trim()).filter(Boolean);
    assert(added.length > 0, `观察第 ${i + 1} 次 .log-entry 无新增`);
    lines.push(added.join("\n"));
    console.log(
      `    OBS${i + 1} +${added.length}段 · ` + lines[i].replace(/\s+/g, "").slice(0, 80)
    );
  }

  // ── ① 单行内「必须做出选择」≤1 次 ─────────────────────────────
  lines.forEach((text, i) => {
    for (const row of text.split("\n")) {
      const n = count(row, "必须做出选择");
      assert(
        n <= 1,
        `① 第 ${i + 1} 次观察单行内「必须做出选择」出现 ${n} 次：「${row.slice(0, 140)}」`
      );
    }
  });
  console.log("    [OK] ① 6 次新增正文单行内「必须做出选择」均 ≤1 次");

  // ── ② 单行内每个真实选项名 ≤1 次 ──────────────────────────────
  lines.forEach((text, i) => {
    for (const row of text.split("\n")) {
      for (const lb of LABELS) {
        const n = count(row, lb);
        assert(
          n <= 1,
          `② 第 ${i + 1} 次观察单行内选项名「${lb.slice(0, 12)}…」出现 ${n} 次：「${row.slice(0, 140)}」`
        );
      }
    }
  });
  console.log(`    [OK] ② 6 次新增正文单行内 ${LABELS.length} 个选项名均 ≤1 次`);

  // ── ③ 单行括号嵌套层数 ≤1 ──────────────────────────────────────
  lines.forEach((text, i) => {
    const depth = maxParenDepth(text);
    assert(
      depth <= 1,
      `③ 第 ${i + 1} 次观察括号嵌套深度 ${depth} >1：「${text.slice(0, 140)}」`
    );
  });
  console.log("    [OK] ③ 6 次新增正文括号嵌套深度均 ≤1");

  // ── ④ 6 次去重后的描述句 ≥4 句 ────────────────────────────────
  const dedup = new Set();
  lines.forEach((text) => descriptionSentences(text).forEach((s) => dedup.add(s)));
  assert(
    dedup.size >= 4,
    `④ 6 次观察去重后描述句仅 ${dedup.size} 句（应 ≥4）：\n` +
      [...dedup].map((s) => `  · ${s.slice(0, 60)}`).join("\n")
  );
  console.log(`    [OK] ④ 去重后描述句 ${dedup.size} 句 ≥4（正文未删空）`);
});
