#!/usr/bin/env node
// prose-hygiene.mjs (F273): 线索旗标的内部 id 不得进玩家可见正文——
//
//   第 57 轮走查（390×844）实测：点一次「观察」后正文出现
//   「【线索·read_the_law】已记下。」——snake_case 变量名直接进小说，
//   属 narrative-systems-designer 的 Info Dump 反例（玩家读不懂、也
//   不需要读）。服务端 choiceEffects() 用「【线索·<flag>】」同时落旗标
//   账本（flagSeen / requires.flag 都扫这条串），因此修法在前端渲染层
//   做展示映射：日志原文不动，玩家看到的是中文可读线索名。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 全部置空），新档由
//   DB 直落第 1 章 must_choose 场景（oracle 取自 chapters.json，与
//   dwell-guidance.mjs 同口径），然后：
//     a) 点一次「环顾四周」；
//     b) 点 options 里 effects.flag = read_the_law 的那个真选项；
//     c) 再做 3 次动作（凑满 ≥5 次动作），取 .log 的 innerText 断言：
//        ① 命中 /\b[a-z]+_[a-z_]+\b/ 的次数 = 0（现码为 1+ → 红证）；
//        ② 每个「【线索…】」片段内不含 ASCII 字母（展示名是中文）；
//        ③ innerText 里确实出现过「【线索」——防止脚本根本没走到线索
//           分支而假 PASS。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f273-"));
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
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
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
      `[E2E] prose-hygiene: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    cleanup();
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const ACTION_RESP = (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname);
const FLAG_ID_RE = /\b[a-z]+_[a-z_]+\b/g;
const CLUE_RE = /【线索[^】]*】/g;

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

run("prose-hygiene", async ({ page }) => {
  const name = `e2e-f273-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（dwell-guidance.mjs 同口径）。
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
  const doAction = async (btn) => {
    const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
    await btn.click();
    const resp = await respP;
    const body = await resp.json().catch(() => null);
    assert(body && body.reply, `动作回包缺 reply（HTTP ${resp.status()}）`);
    await waitIdle();
    return body.reply.content || "";
  };

  // ── (a) 一次「环顾四周」 ─────────────────────────────────────────
  const observeBtn = page.locator(".actions-main .btn", { hasText: "环顾四周" }).first();
  assert((await observeBtn.count()) > 0, "找不到「环顾四周」行动键");
  await doAction(observeBtn);
  let actions = 1;

  // ── (b) 点带 effects.flag 的那个真选项（read_the_law） ───────────
  const flagChoice = (MC.choices || []).find(
    (c) => c && c.effects && typeof c.effects.flag === "string" && c.effects.flag
  );
  assert(flagChoice && typeof flagChoice.label === "string", "oracle 场景里找不到带 effects.flag 的选项");
  const flagId = flagChoice.effects.flag;
  const choiceBtn = page.locator(".btn-group-choice .btn", { hasText: flagChoice.label }).first();
  assert(
    (await choiceBtn.count()) > 0,
    `选项键未渲染：「${flagChoice.label}」（当前 scene=${MC.id}）`
  );
  const choiceReply = await doAction(choiceBtn);
  actions += 1;

  // ── (c) 再补 3 次动作凑满 ≥5 次 ──────────────────────────────────
  // 「环顾四周」在该场景可能被「看尽」锁定（F257），锁了就改点「休息」，
  // 目的是把更多正文压进 .log，不是验证观察本身。
  for (let i = 0; i < 3; i++) {
    const cands = ["环顾四周", "休息", "潜行"];
    let clicked = false;
    for (const label of cands) {
      const btn = page.locator(".actions-main .btn", { hasText: label }).first();
      if ((await btn.count()) > 0 && !(await btn.isDisabled())) {
        await doAction(btn);
        actions += 1;
        clicked = true;
        break;
      }
    }
    if (!clicked) break;
  }
  assert(actions >= 4, `本轮实际动作次数 ${actions} < 4，脚本未走到足够多的正文`);

  const save = await fetchSave(saveId);
  const logText = await page.locator(".log").innerText();
  assert(logText.trim().length > 100, `.log innerText 过短（${logText.length} 字），页面可能未渲染正文`);

  // ③ 线索分支确实走到（防假 PASS）
  const clues = logText.match(CLUE_RE) || [];
  assert(
    clues.length > 0,
    `本轮 .log 里没有任何「【线索…】」片段（flag=${flagId}，scene=${save.scene}），无法验证展示名`
  );

  // ① snake_case 变量名零命中
  const leaked = logText.match(FLAG_ID_RE) || [];
  assert(
    leaked.length === 0,
    `.log 正文仍泄漏内部变量名 ${JSON.stringify([...new Set(leaked)])}（命中 ${leaked.length} 次）\n` +
      `  片段：${clues.join(" / ")}`
  );

  // ② 每个「【线索…】」片段内不含 ASCII 字母
  const asciiClues = clues.filter((c) => /[A-Za-z]/.test(c));
  assert(
    asciiClues.length === 0,
    `「【线索…】」展示名仍是内部 id：${JSON.stringify(asciiClues)}`
  );

  console.log(
    `    [hygiene] actions=${actions} scene=${save.scene} clues=${clues.join(" / ")} — 无 snake_case、展示名全中文`
  );
});
