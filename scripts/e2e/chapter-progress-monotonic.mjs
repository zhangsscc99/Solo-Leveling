#!/usr/bin/env node
// chapter-progress-monotonic.mjs (F246): 抉择/支线落点不得把章节进度
// 打成 0/N——
//
//   第 51 轮走查实测：ch1_law（must_choose）选「退到石柱后…」前顶栏
//   是 2/7，落到支线场景 ch1_watch 后立刻变 0/7，刷新依旧（HP/MP/XP/
//   金币均正确续档，非渲染抖动）。根因：chapter_steps 由站位在主线
//   链上的下标推导，支线场景不在链上 → idx=-1 → 0/N。修法：支线站
//   位按「继续前进会踩到的第一个主线链节点」反推（progressStepsOf，
//   纯数据 BFS，不读高水位）——已完成的里程碑不丢，未到的节点不记。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档真实
//   「前进」落到 ch1 首个 must_choose 场景（oracle 直读 chapters.json，
//   不经被测引擎）：
//     a) 抉择前 chapter_steps == n0（链上下标+1，ch1_law → 2）；
//     b) POST /action 发「选择 <支线选项>」落到支线场景后：
//        chapter_steps >= n0 且 chapter_progress != "0/N"，且恰等于
//        oracle 反推值（既不丢里程碑也不虚增）；GET /saves/:id（刷新
//        口径）与 GET /chapters?save_id（地图口径）分子完全一致；
//     c) 支线场景的「选择 <回主线选项>」落到下一主线节点后，
//        chapter_steps == 该节点链上下标 + 1（ch1_worship → 3）；
//     d) 死亡回溯仍是唯一允许分子下降的路径：DB 置 hp=0 后任一动作
//        触发 settleDeath，断言落点=主线链首、chapter_steps == 1、
//        progress == "1/N"（回落但不归零）；
//     e) 全程 chapter_progress 分子 < 链尾值的场景不得显示为 N/N。
//
//   旧码红证（main@c79b1cb 未修复码上实测，exit=1）：
//     [ASSERT] (b) 支线站位 chapter_steps 未守住抉择前进度：
//       scene=ch1_watch steps=0（n0=2, expected=2）
//   即旧码把支线落点打成 0/7；修复后 (a)–(e) 全过、连跑 2 次 PASS。
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

// ── Oracle（直读 chapters.json，独立复刻主线链与支线反推规则）─────────
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const SCENES = CH1.scenes;
const BY_ID = new Map(SCENES.map((s) => [s.id, s]));

// 主线链：scenes[0] 出发只沿 next_scene（缺失时首个指向本章未到访场景
// 的 choices[].next），与 engine/chapters.js#chapterPath 同一规则独立
// 实现——被测引擎坏了 oracle 不跟着坏。
function mainChain() {
  const path = [];
  const seen = new Set();
  let cur = SCENES[0] || null;
  while (cur && !seen.has(cur.id)) {
    path.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && BY_ID.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => c && typeof c.next === "string" && BY_ID.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? BY_ID.get(nxt) : null;
  }
  return path;
}
const CHAIN = mainChain();
const CHAIN_IDX = new Map(CHAIN.map((id, i) => [id, i]));
const TOTAL = CHAIN.length;
const HEAD = CHAIN[0];

// 支线反推 oracle：链上 = 下标+1；不在链上 = 出边（next_scene 优先、
// choices[].next 其次）BFS 找到的第一个链上节点的下标；都找不到 = 0。
// 与被测函数同一语义独立实现，专抓「反推错方向/虚增到链尾」。
function expectedSteps(sceneId) {
  if (CHAIN_IDX.has(sceneId)) return CHAIN_IDX.get(sceneId) + 1;
  const seen = new Set([sceneId]);
  const queue = [sceneId];
  while (queue.length) {
    const cur = BY_ID.get(queue.shift());
    if (!cur) continue;
    const outs = [];
    if (typeof cur.next_scene === "string" && cur.next_scene) outs.push(cur.next_scene);
    for (const c of cur.choices || []) {
      if (c && typeof c.next === "string" && c.next) outs.push(c.next);
    }
    for (const t of outs) {
      if (seen.has(t)) continue;
      seen.add(t);
      if (CHAIN_IDX.has(t)) return CHAIN_IDX.get(t);
      if (BY_ID.has(t)) queue.push(t);
    }
  }
  return 0;
}

// ch1 首个 must_choose 场景（=ch1_law）与它的支线选项（落点不在链上、
// 且出边能收进主线链——对应走查里的「退到石柱后…」→ ch1_watch）。
const MC = SCENES.find((s) => s.must_choose === true);
const SIDE_CHOICE = (MC.choices || []).find(
  (c) => c && typeof c.next === "string" && c.next && !CHAIN_IDX.has(c.next) && expectedSteps(c.next) > 0
);
const SIDE = SIDE_CHOICE ? BY_ID.get(SIDE_CHOICE.next) : null;
// 支线场景里落点回到主线链的首个选项（=ch1_watch 的 kneel/sneak）。
const BACK_CHOICE = SIDE
  ? (SIDE.choices || []).find((c) => c && CHAIN_IDX.has(c.next))
  : null;

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f246-"));
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
    console.error(`[E2E] chapter-progress-monotonic: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// API_BASE 须在 _http.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.API_BASE = API;
const { assert, ok, makeSave, act, fetchSaveView, get } = await import("../assert/_http.mjs");

assert(MC && MC.id === "ch1_law", `oracle: ch1 首个 must_choose 场景应为 ch1_law: ${MC && MC.id}`);
assert(SIDE && SIDE.id === "ch1_watch", `oracle: 支线选项落点应为 ch1_watch: ${SIDE && SIDE.id}`);
assert(BACK_CHOICE, "oracle: ch1_watch 缺少回到主线链的选项");
const N0 = CHAIN_IDX.get(MC.id) + 1;
const SIDE_STEPS = expectedSteps(SIDE.id);
const NEXT_STEPS = CHAIN_IDX.get(BACK_CHOICE.next) + 1;
assert(N0 === 2, `oracle: ch1_law 步数应为 2: ${N0}`);
assert(SIDE_STEPS === 2, `oracle: ch1_watch 反推步数应为 2: ${SIDE_STEPS}`);
assert(NEXT_STEPS === 3, `oracle: ch1_worship 步数应为 3: ${NEXT_STEPS}`);
console.log(
  `    [oracle] chain=${CHAIN.join("→")} total=${TOTAL} ` +
    `| ${MC.id}=${N0} ${SIDE.id}反推=${SIDE_STEPS} ${BACK_CHOICE.next}=${NEXT_STEPS}`
);

// 存档视图分子断言助手：steps/progress 双字段同查，且永不得为 0/N
// （死亡回溯落链首是 1/N，不是 0/N）。
function assertProgress(save, steps, tag) {
  assert(
    save.chapter_total === TOTAL,
    `${tag}: chapter_total 应为 ${TOTAL}: ${save.chapter_total}`
  );
  assert(
    save.chapter_steps === steps,
    `${tag}: chapter_steps 应为 ${steps}: ${save.chapter_steps}`
  );
  assert(
    save.chapter_progress === `${steps}/${TOTAL}`,
    `${tag}: chapter_progress 应为 ${steps}/${TOTAL}: ${save.chapter_progress}`
  );
}

const id = await makeSave("f246-progress");

// ── (a) 真实推进到 must_choose 场景，记录抉择前分子 n0 ────────────────
const r1 = await act(id, "前进");
assert(
  r1.save.scene === MC.id,
  `(a) 新档「前进」应落 ${MC.id}: ${r1.save.scene}`
);
assertProgress(r1.save, N0, "(a) 抉择前");
console.log(`    [OK] (a) 抉择前 ${r1.save.chapter_progress}（scene=${r1.save.scene}）`);

// ── (b) 发支线选项：分子不得掉、不得虚增，刷新/地图口径一致 ────────────
const r2 = await act(id, `选择 ${SIDE_CHOICE.id}`);
assert(r2.refused !== true, `(b) 支线选项被拒: ${String(r2.reply.content || "").slice(0, 80)}`);
assert(r2.save.scene === SIDE.id, `(b) 应落支线场景 ${SIDE.id}: ${r2.save.scene}`);
assert(
  r2.save.chapter_steps >= N0 && r2.save.chapter_progress !== `0/${TOTAL}`,
  `(b) 支线站位 chapter_steps 未守住抉择前进度：` +
    `scene=${r2.save.scene} steps=${r2.save.chapter_steps}（n0=${N0}, expected=${SIDE_STEPS}）`
);
assert(
  r2.save.chapter_steps === SIDE_STEPS && r2.save.chapter_progress === `${SIDE_STEPS}/${TOTAL}`,
  `(b) 支线站位步数应为反推值 ${SIDE_STEPS}（不得虚增/丢步）: ` +
    `${r2.save.chapter_steps}/${r2.save.chapter_total}`
);
// 刷新口径：/saves/:id 是 UI 唯一事实源，分子必须与回包一致。
{
  const sv = await fetchSaveView(id);
  assert(
    sv.save.chapter_steps === r2.save.chapter_steps &&
      sv.save.chapter_progress === r2.save.chapter_progress,
    `(b) 刷新口径不一致：action ${r2.save.chapter_progress} vs saves ${sv.save.chapter_progress}`
  );
}
// 地图口径：/chapters?save_id 的 progress.current 与顶栏分子一致。
{
  const { status, body } = await get(`/chapters?save_id=${id}`);
  const ch1 = body && Array.isArray(body.chapters) && body.chapters.find((c) => c.index === 1);
  assert(
    status === 200 && ch1 && ch1.progress && ch1.progress.current === r2.save.chapter_steps,
    `(b) 地图口径不一致：progress.current=${ch1 && ch1.progress && ch1.progress.current} ` +
      `vs chapter_steps=${r2.save.chapter_steps}`
  );
}
console.log(
  `    [OK] (b) 支线站位 ${r2.save.chapter_progress}（scene=${r2.save.scene}，刷新/地图同分子）`
);

// ── (c) 支线 → 回主线链：分子随真实落点上升到链上下标+1 ──────────────
// 支线落地可能掷中小怪遭遇（种子因 save_id 而异）——交战态下「选择」
// 会被判成撤离掷逃，先清交战再发选项（与 deny-feedback 同口径）。
{
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  } finally {
    db.close();
  }
}
const r3 = await act(id, `选择 ${BACK_CHOICE.id}`);
assert(r3.refused !== true, `(c) 回主线选项被拒: ${String(r3.reply.content || "").slice(0, 80)}`);
assert(
  r3.save.scene === BACK_CHOICE.next,
  `(c) 应落主线场景 ${BACK_CHOICE.next}: ${r3.save.scene}`
);
assertProgress(r3.save, NEXT_STEPS, "(c) 回到主线");
{
  const sv = await fetchSaveView(id);
  assert(
    sv.save.chapter_steps === NEXT_STEPS,
    `(c) 刷新后分子不一致：${sv.save.chapter_steps} != ${NEXT_STEPS}`
  );
}
console.log(`    [OK] (c) 回到主线 ${r3.save.chapter_progress}（scene=${r3.save.scene}）`);

// ── (d) 死亡回溯：唯一允许分子下降的路径——落链首、分子=1、不归零 ─────
{
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE saves SET hp = 0 WHERE id = ?").run(id);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  } finally {
    db.close();
  }
}
const r4 = await act(id, "观察");
assert(
  r4.save.scene === HEAD,
  `(d) 死亡回溯应落主线链首 ${HEAD}: ${r4.save.scene}`
);
assert(Number(r4.save.deaths) >= 1, `(d) 死亡计数未入账: ${r4.save.deaths}`);
assertProgress(r4.save, 1, "(d) 死亡回溯");
{
  const sv = await fetchSaveView(id);
  assert(
    sv.save.scene === HEAD && sv.save.chapter_steps === 1 && sv.save.chapter_progress === `1/${TOTAL}`,
    `(d) 刷新后回溯落点/分子不一致：scene=${sv.save.scene} progress=${sv.save.chapter_progress}`
  );
}
console.log(
  `    [OK] (d) 死亡回溯 ${NEXT_STEPS}→1（${r4.save.chapter_progress}，scene=${r4.save.scene}，未归零）`
);

ok(
  `chapter-progress-monotonic OK：抉择 ${N0}/${TOTAL} → 支线 ${SIDE_STEPS}/${TOTAL}（守住非 0）` +
    ` → 主线 ${NEXT_STEPS}/${TOTAL} → 死亡回溯 1/${TOTAL}，刷新与地图口径一致`
);
