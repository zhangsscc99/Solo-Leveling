#!/usr/bin/env node
// observe-in-choice-lock.mjs (F293): 抉择态「环顾四周」不得是纯负收益死选项——
//
//   第 96 轮实测：ch1_law（must_choose）里「探索前进」被 P204 必选门锁死，
//   「潜行/休息」同锁（F272），唯一可点的「环顾四周」连点 6 次——HP/MP
//   不动，[data-noise] aria-valuenow 0→1→2→3：第 4 次起观察不再产出
//   信息（observeOverCap 自认「看尽」），却每次推进 encounter_clock，
//   只攒遇敌风险。违反 game-balance-analyst「Dead option」与
//   core-loop-designer「No decision point」。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空，骨架照抄
//   observe-mustchoose-prose.mjs / prose-hygiene.mjs），新档由 DB 直落
//   第 1 章 must_choose 场景（oracle 取自 chapters.json，不经被测引擎）：
//     0) 前置：「探索前进」键 disabled——防脚本没落到抉择态；
//     1) 连点「环顾四周」6 次，逐次记录 [data-noise] aria-valuenow 与
//        新增 .log-entry 文本；
//     2) 通过判据（每次点击满足其一）：
//        a) 观察键 disabled===true 且键上 title / 就地提示含「抉择」字样
//           的原因（方案 A：服务端 save.observe 锁键，前端只渲染口径）；
//        b) 点击后 aria-valuenow 不变（零代价零动静）且新增 entry 含
//           「先做抉择」类提示（方案 B：可点但无负收益，正文指路）。
//   旧码红证：键可点且 noise 严格递增（0→1→2→3），判据 b 在第一次
//   复核区点击即 FAIL——[ASSERT] 打印实测 noise 序列，exit=1。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

// Oracle：第 1 章首个 must_choose 场景与真实选项 label，不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建——本断言验的正是本 worktree 的客户端。
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
      console.error("[E2E] observe-in-choice-lock: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f293-"));
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
      `[E2E] observe-in-choice-lock: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    cleanup();
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const ACTION_RESP = (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname);
const ENTRY_SEL = ".stage-col .log-entry";
// 「先做抉择」类提示：正文/就地小字里明确让玩家先做完选择再看——
// 覆盖「必须做出选择——说…」（免费区指路）、「仍须在…中选定」（不点
// 名变体）与「抉择未定——先做抉择…」（复核区零代价提示）等措辞。
const PROMPT_RE = /先做抉择|先做选择|必须做出选择|做出选择|选定|抉择/;
const CLICKS = 6;

assert(MC && MC.id, "oracle: ch1 must_choose scene missing in chapters.json");

run("observe-in-choice-lock", async ({ page }) => {
  const name = `e2e-f293-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（dwell-guidance.mjs / observe-mustchoose-prose.mjs
  // 同口径）：清交战、清遭遇保底账，回灌后选项组就位。
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

  // ── 0) 前置断言：「探索前进」在抉择态必为 disabled ──────────────
  //    （P204/F247 必选门——它锁着才证明真落到了 must_choose 场景）。
  const adv = await page.evaluate(() => {
    const b = document.querySelector('.actions-main button[data-act="前进"]');
    return b
      ? {
          disabled: b.disabled,
          ariaDisabled: b.getAttribute("aria-disabled"),
          text: (b.innerText || "").trim().slice(0, 20),
        }
      : null;
  });
  assert(adv, '前置：找不到「探索前进」键（button[data-act="前进"]）——抉择态未就位？');
  assert(
    adv.disabled === true || adv.ariaDisabled === "true",
    `前置：「探索前进」未置灰 disabled=${adv.disabled} aria-disabled=${adv.ariaDisabled}——` +
      `脚本没落进 must_choose 抉择态（scene 应为 ${MC.id}）`
  );
  console.log(`    [OK] 0 前置：「${adv.text}」disabled（抉择态就位）`);

  const observeBtn = page.locator('.actions-main button[data-act="观察"]');
  assert((await observeBtn.count()) > 0, '找不到「环顾四周」键（button[data-act="观察"]）');

  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const noiseNow = () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-noise]");
      return el ? el.getAttribute("aria-valuenow") : null;
    });
  const entryCount = () => page.locator(ENTRY_SEL).count();
  const newEntries = async (from) =>
    page.$$eval(ENTRY_SEL, (els, n) => els.slice(n).map((e) => e.innerText || ""), from);
  // 锁键时的「抉择」字样出处：键面 title、键面可见文本、就地提示
  // （.observe-hint / [data-observe-hint]，服务端 save.observe 口径透传）。
  const lockReason = () =>
    page.evaluate(() => {
      const b = document.querySelector('.actions-main button[data-act="观察"]');
      if (!b) return "";
      const bits = [
        b.getAttribute("title") || "",
        (b.innerText || "").trim(),
        ...[...document.querySelectorAll(".observe-hint, [data-observe-hint]")].map(
          (n) => n.textContent || ""
        ),
      ];
      return bits.join(" | ");
    });

  // ── 1) 连点 6 次，逐次取证 ────────────────────────────────────
  const records = [];
  for (let i = 0; i < CLICKS; i++) {
    await waitIdle();
    const before = await entryCount();
    const noiseBefore = await noiseNow();
    const disabled = await observeBtn.isDisabled();
    if (disabled) {
      const reason = await lockReason();
      records.push({ i: i + 1, disabled: true, reason, noiseBefore, noiseAfter: noiseBefore });
      console.log(
        `    CLK${i + 1} 键已锁 · noise=${noiseBefore} · 原因「${reason.slice(0, 50)}」`
      );
      continue;
    }
    const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
    await observeBtn.click();
    const resp = await respP;
    const body = await resp.json().catch(() => null);
    assert(
      body && body.reply,
      `观察第 ${i + 1} 次回包缺 reply（HTTP ${resp.status()}）`
    );
    await waitIdle();
    await page.waitForFunction(
      (n) => document.querySelectorAll(".stage-col .log-entry").length > n,
      before
    );
    const added = (await newEntries(before)).map((t) => t.trim()).filter(Boolean);
    const noiseAfter = await noiseNow();
    records.push({
      i: i + 1,
      disabled: false,
      noiseBefore,
      noiseAfter,
      added,
      refused: body.refused === true,
    });
    console.log(
      `    CLK${i + 1} noise ${noiseBefore}->${noiseAfter} refused=${body.refused === true} · ` +
        (added.join(" ").replace(/\s+/g, "").slice(0, 70) || "（无新增段）")
    );
  }

  const noiseSeq = records.map((r) => `${r.noiseBefore}->${r.noiseAfter}`).join(", ");

  // ── 2) 每次点击满足判据 a 或 b ────────────────────────────────
  //    a) 键已锁且锁因含「抉择」；b) 可点但 noise 不变且新增 entry
  //    含「先做抉择」类提示。旧码：键可点、noise 0→1→2→3 → FAIL。
  for (const r of records) {
    if (r.disabled) {
      assert(
        /抉择|选择/.test(r.reason),
        `[ASSERT] 第${r.i}次观察键已锁但锁因无「抉择」字样：「${r.reason.slice(0, 80)}」` +
          `（noise 序列：${noiseSeq}）`
      );
      continue;
    }
    assert(
      r.noiseAfter === r.noiseBefore,
      `[ASSERT] 第${r.i}次可点观察推进了动静账：aria-valuenow ${r.noiseBefore}->${r.noiseAfter}` +
        `（抉择态零产出动作不得攒遇敌风险；noise 序列：${noiseSeq}）`
    );
    const hinted = (r.added || []).some((t) => PROMPT_RE.test(t));
    assert(
      hinted,
      `[ASSERT] 第${r.i}次观察新增正文无「先做抉择」类提示：` +
        `${JSON.stringify((r.added || []).map((t) => t.slice(0, 60)))}（noise 序列：${noiseSeq}）`
    );
  }

  const locked = records.filter((r) => r.disabled).length;
  const clicked = records.length - locked;
  console.log(
    `    [OK] 抉择态观察非死选项：${locked} 次锁键（原因含「抉择」）、` +
      `${clicked} 次可点零动静且正文指路（noise 序列：${noiseSeq}）`
  );
});
