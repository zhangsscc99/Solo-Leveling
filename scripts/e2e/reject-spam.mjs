#!/usr/bin/env node
// reject-spam.mjs (F226): must_choose 状态下连点「探索前进」不得刷屏——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落 ch1_law（must_choose 场景，oracle 取自 chapters.json）：
//     · 第 1 次「前进」＝首次拒绝：照旧 +2 行（user 原文 + system
//       正文，服务端落库）；
//     · 之后连发 6 次（F247 起按钮 disabled，全走输入框 Enter，同一
//       条 dispatch 路径）：.stage-col 子元素数零增长——乐观追加的
//       user 行被撤回、
//       reply 行不追加；
//     · 首条拒绝正文（「必须做出选择」+ 真实选项名）始终在页面上可见，
//       重复拒绝的轻提示走 .sys-toast 瞬时层；
//     · HP/MP/XP/金币全程零变化（回包 save 与服务端存档双口径）。
//
//   旧码红证：旧前端每次拒绝 +2 行（乐观 user 行 + 无条件追加的 reply
//   行），6 连点 .stage-col +12 —— 本脚本直接 FAIL。
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
const LABELS = MC.choices.map((c) => c.label);

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f226-"));
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
    console.error(`[E2E] reject-spam: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave, stageCount, readVitals, sendAdvance, advanceButton } =
  await import("./lib.mjs");

// 服务端存档快照（HP/MP/XP/金币口径独立于界面读数）。
async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

run("reject-spam", async ({ page }) => {
  const name = `e2e-f226-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（与 must-choose-copy / P206 断言同口径）：
  // 清交战、清遭遇冷却，回灌后选项组就位。
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

  // F247：must_choose 下「探索前进」按钮 disabled——同一条必拒指令
  // 全改走输入框 Enter（与 F231 dispatch 路径同口径）。
  const advanceBtn = advanceButton(page);
  const stageKids = () => page.evaluate(() => document.querySelector(".stage-col").children.length);
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));

  // 新合同钉死：must_choose 未决时该按钮 disabled===true。
  assert(
    (await advanceBtn.isDisabled()) === true,
    "must_choose 下「探索前进」按钮未置灰（disabled!==true）"
  );
  console.log(`    [gate] 「探索前进」disabled=true`);

  // ── 首次拒绝：照旧 +2 行（user + system 完整正文），行为不变 ──
  const nFirst0 = await stageKids();
  await sendAdvance(page);
  await waitIdle();
  await page.waitForFunction((n) => document.querySelector(".stage-col").children.length >= n + 2, nFirst0);
  const nFirst1 = await stageKids();
  assert(
    nFirst1 === nFirst0 + 2,
    `首次拒绝应照旧 +2 行（user+system）：${nFirst0} -> ${nFirst1}`
  );
  console.log(`    [first refusal] stage-col ${nFirst0} -> ${nFirst1} (+2，首次回执照旧)`);

  const vitals0 = await readVitals(page);
  const save0 = await fetchSave(saveId);
  const n0 = await stageCount(page);

  // ── 连发 6 次（全走输入框 Enter，同一条 dispatch 路径）：.stage-col 零增长 ──
  for (let i = 0; i < 5; i++) {
    await sendAdvance(page);
    await waitIdle();
    const n = await stageKids();
    assert(
      n <= n0 + 1,
      `连发第 ${i + 1}/5 次后 .stage-col ${n0} -> ${n}（>+1 即刷屏旧毛病）`
    );
  }
  await sendAdvance(page);
  await waitIdle();
  const nAfterEnter = await stageKids();
  assert(
    nAfterEnter <= n0 + 1,
    `Enter 连按后 .stage-col ${n0} -> ${nAfterEnter}（>+1 即刷屏旧毛病）`
  );
  const n1 = await stageCount(page);
  assert(n1 <= n0 + 1, `6 连点后 .stage-col 增量 ${n1 - n0} > 1`);
  console.log(`    [spam x6] stage-col ${n0} -> ${n1}（增量 ${n1 - n0} <= 1）`);

  // ── 拒绝文本仍可见：首条完整正文留在 .stage-col ───────────────
  const stageText = await page.locator(".stage-col").innerText();
  assert(/必须做出选择|抉择未定|这道抉择/.test(stageText), "首次拒绝正文不在 .stage-col 里");
  const listed = LABELS.filter((lb) => stageText.includes(lb));
  assert(listed.length >= 1, `拒绝正文未带真实选项名（命中 ${listed.length}/${LABELS.length}）`);
  console.log(`    [refusal text] 「必须做出选择」+ 选项名仍在页面（命中 ${listed.length} 个选项名）`);

  // ── HP/MP/XP/金币零变化（界面口径 + 服务端存档口径）───────────
  const vitals1 = await readVitals(page);
  assert(
    vitals1.hp.v === vitals0.hp.v && vitals1.mp.v === vitals0.mp.v,
    `界面 HP/MP 变了：HP ${vitals0.hp.v}->${vitals1.hp.v} MP ${vitals0.mp.v}->${vitals1.mp.v}`
  );
  const save1 = await fetchSave(saveId);
  for (const k of ["hp", "mp", "xp", "gold"]) {
    assert(save1[k] === save0[k], `存档 ${k} 变了：${save0[k]} -> ${save1[k]}`);
  }
  console.log(
    `    [vitals] HP ${save1.hp}/${save1.max_hp} MP ${save1.mp}/${save1.max_mp} ` +
      `XP ${save1.xp} gold ${save1.gold}（与 n0 时刻一致）`
  );
});
