#!/usr/bin/env node
// observe-cost-disclosed.mjs (F274): 「观察」的代价必须事前披露——
//
//   第 57 轮桌面实测：干净档第一次点「环顾四周」→ HP 100→97、MP
//   20→18，并直接进入遭遇战——而按钮文案只有「环顾四周」+ 快捷键
//   角标，既没有消耗角标、也没有「可能遇敌」提示。无预警的精确操
//   作玩家会判定「不公平」（intuitive-game-design Q5 缺 Pre 层；
//   game-balance-analyst 要求披露 value-per-cost）。
//
//   服务端真实机制（observeStatus / observeOverCap 同一本账）：
//     · 本场景前 OBSERVE_TOTAL 次细看 patch:null——不扣 HP/MP；
//     · 第 OBSERVE_TOTAL+1 次起每次 encounter_clock +1（动静 N/4）；
//     · 可掷怪场景攒满 PITY_LIMIT 的那次观察直接开战（非概率）。
//   披露字段（cost/free_left/noise/may_encounter/hint/badge）全部由
//   observeStatus 随 save.observe 下发，前端只渲染。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，骨架照抄
//   observe-cost.mjs；浏览器走 lib.mjs launch()，新档由 createSave
//   落地），干净档进第一章，在任何一次「观察」点击之前断言：
//     A) button[data-act="观察"] 的 title（或键面可见文本 / 键面
//        [data-observe-cost] 角标）命中 /可能遇敌|遇敌/ 或 /HP|MP/，
//        且键面存在可见代价角标（移动端无 hover，不能只挂 title）；
//     B) .log 最新子节点是 [data-observe-hint] 系统提示节点，innerText
//        命中同一披露，且不是 .log-entry 旁白排版；
//     C) 披露文案数字与机制一致：DOM 提示逐字等于 API 下发的
//        save.observe.hint；「还剩 N 次免费」的 N === free_left；
//        「动静 x/M」的 x===noise.cur、M===noise.max——全部取自同一
//        实例的 /saves/:id 回包，不写死魔数；
//     D) 点一次「观察」后披露随机制刷新：API free_left 递减 1 且
//        DOM 提示同步换文（防写死文案）。
//
//   旧码（save.observe 只有 available/reason、键面无角标、.log 无
//   提示节点）应在 A/B 即 FAIL；新码 PASS。内部一律 waitForFunction
//   有界等待，不 sleep 赌时序；临时 DB 独立，不依赖既有存档。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链（rest-feedback 兜底链向主仓）→ 摘掉再构建——本断言验
// 的正是本 worktree 的客户端代码，外部 bundle 里没有 data-observe-hint。
{
  const dist = path.join(ROOT, "client", "dist");
  let foreign = false;
  try {
    foreign = fs.lstatSync(dist).isSymbolicLink();
  } catch {}
  if (foreign) fs.rmSync(dist, { force: true });
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_CHANNEL_FD;
    delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
    const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: buildEnv,
    });
    if (b.status !== 0) {
      console.error("[E2E] observe-cost-disclosed: client/dist 缺失且 npm --prefix client run build 失败");
      process.exit(1);
    }
  }
}

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f274-"));
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

const BASE = `http://127.0.0.1:${port}/game`;
const API = `${BASE}/api`;
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
    console.error(`[E2E] observe-cost-disclosed: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = BASE;
const { assert, run, createSave } = await import("./lib.mjs");

// 披露命中口径：「可能遇敌 / 遇敌」字样或 HP/MP 数值披露——与 FEATURES
// F274 verify 同一口径，满足其一即算「事前披露了代价」。
const DISCLOSE_RE = /可能遇敌|遇敌|HP|MP/;

async function fetchObserveView(saveId) {
  const r = await fetch(`${API}/saves/${saveId}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${saveId} failed (HTTP ${r.status})`);
  return body.save.observe;
}

// .log 最新子节点现场取证（断言 B/C 共用）：最后一个元素子节点必须是
// [data-observe-hint] 系统提示节点而非 .log-entry 旁白段。
const readLogTail = (page) =>
  page.evaluate(() => {
    const log = document.querySelector(".stage-col.log");
    const last = log && log.lastElementChild;
    const hint = log && log.querySelector("[data-observe-hint]");
    return {
      hasLog: Boolean(log),
      lastText: last ? last.textContent || "" : "",
      lastIsHint: last ? last.hasAttribute("data-observe-hint") : false,
      lastClass: last ? String(last.className || "") : "",
      lastIsLogEntry: last ? last.classList.contains("log-entry") : false,
      hintText: hint ? hint.textContent || "" : "",
    };
  });

run("observe-cost-disclosed", async ({ page }) => {
  const name = `ocd${Date.now().toString(36)}`; // ≤20 字，避 409 重名
  await createSave(page, name);
  await page.waitForFunction(() => !document.querySelector(".pending"));
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // ── 前置：披露在「任何一次观察点击之前」已经渲染 ──────────────
  // 键面披露（title 或键面角标）与 .log 末尾提示都必须先存在于 DOM。
  await page.waitForFunction(
    () => {
      const b = document.querySelector('button[data-act="观察"]');
      if (!b) return false;
      const disclosed = (s) => /可能遇敌|遇敌|HP|MP/.test(s || "");
      const badge = b.querySelector("[data-observe-cost]");
      return (
        disclosed(b.getAttribute("title")) ||
        disclosed(badge ? badge.textContent : "") ||
        disclosed(b.textContent)
      );
    },
    null,
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => {
      const log = document.querySelector(".stage-col.log");
      const last = log && log.lastElementChild;
      return (
        last &&
        last.hasAttribute("data-observe-hint") &&
        /可能遇敌|遇敌|HP|MP/.test(last.textContent || "")
      );
    },
    null,
    { timeout: 15000 }
  );

  // ── A 「环顾四周」键面 + title 披露 ──────────────────────────
  const btn = await page.evaluate(() => {
    const b = document.querySelector('button[data-act="观察"]');
    if (!b) return null;
    const badge = b.querySelector("[data-observe-cost]");
    return {
      title: b.getAttribute("title") || "",
      text: b.innerText || "",
      badgeText: badge ? badge.textContent || "" : "",
      badgeVisible: badge ? badge.offsetParent !== null : false,
      state: b.getAttribute("data-observe-state"),
    };
  });
  assert(btn, 'A: 「环顾四周」按钮（button[data-act="观察"]）不存在——选择器失效？');
  assert(
    DISCLOSE_RE.test(btn.title) || DISCLOSE_RE.test(btn.text) || DISCLOSE_RE.test(btn.badgeText),
    `A: 「环顾四周」无任何代价披露——title="${btn.title}" text="${btn.text.replace(/\n/g, "|")}"`
  );
  assert(
    btn.badgeText.trim().length > 0 && btn.badgeVisible,
    `A: 键面无可见代价角标（移动端无 hover，title 等于不存在）badge="${btn.badgeText}"`
  );
  console.log(
    `[OK] (A) title 披露="${btn.title.slice(0, 70)}…" · 键面角标="${btn.badgeText}" state=${btn.state}`
  );

  // ── B 点击前 .log 最新子节点即披露（系统提示节点） ────────────
  const tail = await readLogTail(page);
  assert(tail.hasLog, "B: .stage-col.log 不存在");
  assert(
    tail.lastIsHint,
    `B: .log 最新子节点不是 [data-observe-hint] 系统提示（class="${tail.lastClass}"）——` +
      `披露必须挂在 .log 末尾、在玩家动手前可见: "${tail.lastText.slice(0, 60)}"`
  );
  assert(
    DISCLOSE_RE.test(tail.lastText),
    `B: .log 最新子节点 innerText 无代价披露: "${tail.lastText.slice(0, 80)}"`
  );
  assert(
    !tail.lastIsLogEntry,
    `B: 披露节点不得混入 .log-entry 旁白排版（机制括注进小说正文即 FAIL）: ${tail.lastClass}`
  );
  console.log(`[OK] (B) .log 最新子节点=[data-observe-hint] "${tail.lastText.slice(0, 70)}…"`);

  // ── C 披露数字与机制一致（同一实例 /saves/:id 交叉核对） ──────
  const obs = await fetchObserveView(saveId);
  assert(
    obs && Number.isInteger(obs.free_left) && Number.isInteger(obs.free_total) &&
      obs.noise && Number.isInteger(obs.noise.cur) && Number.isInteger(obs.noise.max) &&
      typeof obs.may_encounter === "boolean" && typeof obs.hint === "string" &&
      "cost" in obs,
    `C: save.observe 披露字段缺失/不全（服务端未下发口径）: ${JSON.stringify(obs)}`
  );
  // DOM 提示与服务端 hint 同源——前端不许另编数字，两处必须逐字一致。
  assert(
    tail.hintText === obs.hint,
    `C: DOM 提示与服务端 hint 脱节（前端疑在自编文案）:\n  DOM="${tail.hintText}"\n  API="${obs.hint}"`
  );
  // 「还剩 N 次免费」的 N 必须等于服务端 free_left（免费额度本账）。
  const mFree = tail.hintText.match(/还剩\s*(\d+)\s*次免费/);
  if (obs.free_left > 0) {
    assert(
      mFree && Number(mFree[1]) === obs.free_left,
      `C: 「还剩 N 次免费」与机制脱节：文案 N=${mFree && mFree[1]}，` +
        `服务端 free_left=${obs.free_left}（free_total=${obs.free_total}）`
    );
  }
  // 「动静 x/M」的 M 必须等于服务端动静上限、x 等于当前计数。
  const mNoise = tail.hintText.match(/动静\s*\+?\d*\s*（?现\s*(\d+)\s*\/\s*(\d+)|动静\s*(\d+)\s*\/\s*(\d+)/);
  const noiseCur = mNoise && Number(mNoise[1] ?? mNoise[3]);
  const noiseMax = mNoise && Number(mNoise[2] ?? mNoise[4]);
  assert(
    mNoise && noiseCur === obs.noise.cur && noiseMax === obs.noise.max,
    `C: 「动静 x/M」与机制脱节：文案=${mNoise ? `${noiseCur}/${noiseMax}` : "缺失"}，` +
      `服务端 noise=${obs.noise.cur}/${obs.noise.max}`
  );
  console.log(
    `[OK] (C) 数字与机制一致：free_left=${obs.free_left}/${obs.free_total} · ` +
      `动静 ${obs.noise.cur}/${obs.noise.max} · may_encounter=${obs.may_encounter} · cost=${JSON.stringify(obs.cost)}`
  );

  // ── D 点一次「观察」后披露随机制刷新（防写死文案） ─────────────
  await page.click('button[data-act="观察"]');
  const wantFree = obs.free_left - 1;
  await page.waitForFunction(
    (want) => {
      const log = document.querySelector(".stage-col.log");
      const last = log && log.lastElementChild;
      return last && last.hasAttribute("data-observe-hint") && (last.textContent || "").includes(`还剩 ${want} 次免费`);
    },
    wantFree,
    { timeout: 15000 }
  );
  const obs2 = await fetchObserveView(saveId);
  const tail2 = await readLogTail(page);
  assert(
    obs2.free_left === wantFree,
    `D: 观察后 free_left 未递减：${obs.free_left} -> ${obs2.free_left}`
  );
  assert(
    tail2.hintText === obs2.hint,
    `D: 观察后 DOM 提示未随服务端刷新:\n  DOM="${tail2.hintText}"\n  API="${obs2.hint}"`
  );
  const btn2 = await page.evaluate(() => {
    const badge = document.querySelector('button[data-act="观察"] [data-observe-cost]');
    return badge ? badge.textContent || "" : "";
  });
  assert(
    btn2 === (obs2.badge || ""),
    `D: 键面角标未随服务端 badge 刷新：dom="${btn2}" api="${obs2.badge}"`
  );
  console.log(`[OK] (D) 观察后披露随机制刷新：free_left ${obs.free_left}→${obs2.free_left} · 角标="${btn2}"`);
});
