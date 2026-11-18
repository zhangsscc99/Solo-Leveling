#!/usr/bin/env node
// dwell-guidance.mjs (F240): must_choose 场景里观察/复核区的指路句不得
// 再把玩家推向必被 P204 门拒绝的「前进」——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落 ch1_law（must_choose 场景，oracle 取自 chapters.json，与
//   deny-feedback.mjs / reject-spam.mjs 同口径）：
//     a) 连点「环顾四周」6 次，逐次取 /action 回包的 reply.content——
//        断言每次新增正文的指路句都不含「前进/探索前进」；
//     b) 这 6 次新增正文里至少一次点名当前场景真实可点的选项 label
//        （期望集合取 view.next_choices[].label，命中任一即过）；
//     c) 随后发「前进」仍 refused（正文含「必须做出选择」等拒绝
//        文案）且 HP/MP 零变化——门禁不被文案改动顺手打开（F247 起
//        按钮 disabled，改经输入框 Enter 发出）。
//
//   旧码红证：观察第 1/2/3 次收束句「或说「前进」」「说「前进」动
//   身」、第 4–6 次复核区正文与风险尾注「说「前进」或「潜行」马上
//   动身」——(a) 在第一次观察即 FAIL。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f240-"));
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
    console.error(`[E2E] dwell-guidance: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave, sendAdvance, advanceButton } = await import("./lib.mjs");

// 服务端存档快照（must_choose / next_choices / HP / MP 口径独立于界面）。
async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

const ACTION_RESP = (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname);

run("dwell-guidance", async ({ page }) => {
  const name = `e2e-f240-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 must_choose 场景（与 deny-feedback.mjs 同口径）：清交战、清遭
  // 遇冷却，回灌后选项组就位。
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

  const view0 = await fetchSave(saveId);
  assert(
    view0.must_choose === true,
    `落点不是 must_choose 场景（scene=${view0.scene} must_choose=${view0.must_choose}）`
  );
  const labels = (Array.isArray(view0.next_choices) ? view0.next_choices : [])
    .map((c) => (c && typeof c.label === "string" ? c.label : ""))
    .filter(Boolean);
  assert(labels.length > 0, "must_choose 场景视图未下发任何选项 label");
  console.log(`    [scene] ${view0.scene} must_choose=true choices=${labels.join(" | ")}`);

  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const observeBtn = page.locator(".actions-main .btn", { hasText: "环顾四周" }).first();
  assert((await observeBtn.count()) > 0, "找不到「环顾四周」行动键");

  // ── (a)(b) 连点 6 次观察：指路句不含「前进」，且至少一次点名真实选项 ──
  const replies = [];
  for (let i = 0; i < 6; i++) {
    const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
    await observeBtn.click();
    const resp = await respP;
    const body = await resp.json().catch(() => null);
    assert(
      body && body.reply && typeof body.reply.content === "string",
      `观察第 ${i + 1} 次回包缺 reply.content（HTTP ${resp.status()}）`
    );
    replies.push(body.reply.content);
    await waitIdle();
  }
  replies.forEach((content, i) => {
    assert(
      !/前进/.test(content),
      `观察第 ${i + 1} 次指路句仍指向被拒的「前进」：「${content}」`
    );
  });
  console.log(`    [observe x6] 6 次新增正文均无「前进/探索前进」字样`);

  const named = replies.some((content) => labels.some((label) => content.includes(label)));
  assert(
    named,
    `6 次观察指路均未点名任何真实选项（期望集合：${labels.join(" / ")}）\n` +
      replies.map((c, i) => `  ${i + 1}. ${c}`).join("\n")
  );
  const hitCount = replies.filter((content) =>
    labels.some((label) => content.includes(label))
  ).length;
  console.log(`    [guide] ${hitCount}/6 次指路点名了真实选项 label`);

  // ── (c) 门禁未被打开：发「前进」仍 refused、HP/MP 零消耗 ──────────
  // F247：must_choose 下按钮 disabled——同一条指令改由输入框 Enter 发出。
  assert(
    (await advanceButton(page).isDisabled()) === true,
    "must_choose 下「探索前进」按钮未置灰（disabled!==true）"
  );
  const saveBefore = await fetchSave(saveId);
  const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
  await sendAdvance(page);
  const resp = await respP;
  const body = await resp.json().catch(() => null);
  await waitIdle();
  assert(body && body.refused === true, `must_choose 下「探索前进」未被拒绝（回包无 refused）`);
  assert(
    /必须做出选择|抉择未定|做出选择/.test((body.reply && body.reply.content) || ""),
    `拒绝正文缺失「必须做出选择」类文案：「${(body.reply && body.reply.content) || ""}」`
  );
  const saveAfter = await fetchSave(saveId);
  assert(
    saveAfter.hp === saveBefore.hp && saveAfter.mp === saveBefore.mp,
    `被拒的「前进」仍扣了数值：HP ${saveBefore.hp}->${saveAfter.hp} MP ${saveBefore.mp}->${saveAfter.mp}`
  );
  console.log(
    `    [gate] 「探索前进」仍 refused：「${body.reply.content}」HP/MP ${saveAfter.hp}/${saveAfter.mp} 零变化`
  );
});
