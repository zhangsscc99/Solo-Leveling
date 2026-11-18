#!/usr/bin/env node
// F213 开场长正文按自然段拆段契约（纯渲染层）：
//
//   服务端把开场三自然段（矿灯下的委托人 / 李珠熙的招呼 / 石殿与合拢
//   的石门）用 \n\n 拼进同一条 narrator 日志下发；旧前端整条塞进一个
//   <p.narration>——390 下一堵 340 字的墙。新契约（只拆渲染不改字）：
//     1) 390×844 新档首屏 .stage p.narration ≥ 5；
//     2) 单段字数最大值 ≤ 200（>200 只在句末标点后续切）；
//     3) 单段渲染高度 ≤ 0.35 × innerHeight；
//     4) 各段 innerText 顺序拼接与 /saves/:id/log 里 narrator 条目的
//        拼接逐字一致（空白归一），且含开场关键原句——无信息丢失；
//     5) 1440×900 段数 ≥ 3 且无横向溢出（scrollWidth == clientWidth）。
//
//   隔离实例：随机端口 + 临时 DB，spawn server/index.js 自起自停；
//   服务端静态托管 client/dist——dist 缺失时先跑 `npm --prefix client
//   run build` 再起。旧码红证：旧版整条日志只渲染 1 个 <p.narration>，
//   段数断言（≥5）与单段字数（≤200）双路必 FAIL。
import { spawn } from "node:child_process";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME = `f213-${Date.now().toString(36)}`;

// 开场正文（ch1_double_gate）原句钉样——拼接全文须逐句全等包含。
const OPENING_LINES = [
  "石门在矿灯下泛着潮湿的灰光。",
  "E 级猎人在这行里，和消耗品没什么分别。",
  "她朝你点了点头，算是这队里唯一的招呼。",
  "身后的石门就在这时合拢了",
  "像一圈石头同时换了个站姿。",
];

const stripWs = (s) => String(s || "").replace(/\s+/g, "");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// dist 是服务端唯一静态源——没有就先构建（与 ci-deploy 同口径）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (b.status !== 0) {
    console.error("[ASSERT] FAIL step=build client/dist 缺失且构建失败");
    process.exit(1);
  }
}

const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f213-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: path.join(tmpDir, "game.db"),
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
let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  process.exit(code);
}
process.on("SIGINT", () => cleanup(2));
process.on("SIGTERM", () => cleanup(2));
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {}
});

const BASE = `http://127.0.0.1:${gamePort}/game`;
const API = `${BASE}/api`;

// 等隔离实例就绪（最多 ~10s）。
{
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    console.error(`[ASSERT] FAIL step=boot 隔离实例未就绪\n${childLog}`);
    cleanup(1);
  }
}

// lib.mjs 在模块加载时固化 BASE_URL——先设环境再动态 import。
process.env.E2E_BASE_URL = BASE;
const { run, createSave, assert } = await import("../e2e/lib.mjs");

// createSave 走 .gate-form 注册流程；存档 id 从 localStorage 取回后
// 直查 /saves/:id/log 拿服务端 narrator 原文做逐字 oracle。
run(
  "prose-paragraphs",
  async ({ page }) => {
    await createSave(page, NAME);
    await page.waitForSelector(".stage p.narration");
    const saveId = await page.evaluate(() =>
      Number(localStorage.getItem("solo_leveling_save_id"))
    );
    assert(saveId > 0, "localStorage 无 save_id");

    const res = await page.evaluate(async ({ id, api }) => {
      const r = await fetch(`${api}/saves/${id}/log`);
      return r.json();
    }, { id: saveId, api: API });
    const narratorText = stripWs(
      (res.log || [])
        .filter((e) => e.role === "narrator")
        .map((e) => e.content)
        .join("")
    );
    assert(narratorText.length > 0, "服务端日志无 narrator 条目");

    // ── 390×844 ────────────────────────────────────────────────
    const m390 = await page.evaluate(() => {
      const paras = [...document.querySelectorAll(".stage p.narration")];
      return {
        vw: window.innerWidth,
        vh: window.innerHeight,
        count: paras.length,
        texts: paras.map((p) => p.innerText),
        maxLen: Math.max(...paras.map((p) => [...p.innerText].length), 0),
        maxH: Math.max(...paras.map((p) => p.getBoundingClientRect().height), 0),
      };
    });
    assert(
      m390.count >= 5,
      `390x844: .stage p.narration 数量 ${m390.count} < 5`
    );
    assert(
      m390.maxLen <= 200,
      `390x844: 单段字数最大值 ${m390.maxLen} > 200`
    );
    assert(
      m390.maxH <= 0.35 * m390.vh,
      `390x844: 单段高度 ${m390.maxH.toFixed(1)} > 0.35×${m390.vh}`
    );
    console.log(
      `[ASSERT] 390x844: paras=${m390.count} maxLen=${m390.maxLen} ` +
        `maxH=${m390.maxH.toFixed(1)} (limit ${(0.35 * m390.vh).toFixed(1)})`
    );

    // 逐字一致性：拼接全文 ⊇ 服务端 narrator 全文，且逐句含开场原句。
    const joined = stripWs(m390.texts.join(""));
    for (const line of OPENING_LINES) {
      assert(
        joined.includes(stripWs(line)),
        `拼接全文缺开场原句「${line}」`
      );
    }
    assert(
      joined === narratorText,
      `拼接全文 != 服务端 narrator 全文（${joined.length} vs ${narratorText.length}）`
    );

    // ── 1440×900 ───────────────────────────────────────────────
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector(".stage p.narration");
    const m1440 = await page.evaluate(() => ({
      count: document.querySelectorAll(".stage p.narration").length,
      docSw: document.documentElement.scrollWidth,
      docCw: document.documentElement.clientWidth,
      stageSw: document.querySelector(".stage")?.scrollWidth ?? -1,
      stageCw: document.querySelector(".stage")?.clientWidth ?? -1,
    }));
    assert(m1440.count >= 3, `1440x900: p.narration 数量 ${m1440.count} < 3`);
    assert(
      m1440.docSw === m1440.docCw && m1440.stageSw <= m1440.stageCw + 1,
      `1440x900: 横向溢出 doc ${m1440.docSw}/${m1440.docCw} stage ${m1440.stageSw}/${m1440.stageCw}`
    );
    console.log(
      `[ASSERT] 1440x900: paras=${m1440.count} doc ${m1440.docSw}/${m1440.docCw} ` +
        `stage ${m1440.stageSw}/${m1440.stageCw}`
    );
  },
  { viewport: { width: 390, height: 844 } }
);
