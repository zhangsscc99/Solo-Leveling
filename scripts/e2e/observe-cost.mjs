#!/usr/bin/env node
// observe-cost.mjs (F225): 「观察」的代价必须如实、可见——
//
//   第 47 轮走查实测：新档连点 6 次「观察」，HP 恒 100/MP 恒 20，第 5
//   次正文却写「收获不会再多一分，体力却一直往下耗」——文案承诺掉血
//   而机制什么都没扣（narrative-systems-designer Dissonant）。修法不
//   是改成扣 HP/MP（那会推翻 P207/F216 的「前 3 次免费观察」契约），
//   而是把文案改口成真实代价：每次复核区观察把 encounter_clock 推进
//   一格 + 「动静 N/4」可见计数。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档天然落
//   ch1_double_gate，同场景连发 6 次「观察」，逐次记录回包正文与
//   save 的 hp/mp/scene/encounter_clock：
//     a) 第 1–3 次：hp/mp/scene 与起始完全相等（免费观察契约不动）；
//     b) 第 4–6 次：encounter_clock 相对上一次严格 +1；正文含
//        「动静 N/M」且 N 严格递增（可见的量化代价）；
//     c) 6 条回包全部不得命中虚假承诺：/体力[^。；]{0,10}(耗|减|掉|流)/
//        与 /耗[^。；]{0,8}体力/；
//     d) 第 4–6 次每条正文含 /前进|休息|潜行/ 之一（可执行指引）；
//     e) 每条回包正文非空；第 1–3 次以「<场景叙述名>」——开头
//        （F092/F178 契约）。
//
//   旧码红证：把 OBSERVE_OVER_LINES[1] 改回旧句「收获不会再多一分，
//   体力却一直往下耗——说「休息」喘口气，比死盯墙角划算。」后实测，
//   第 5 次观察（推进前 clock=1 → 池 index 1）被 (c) 拦下，exit=1：
//     [ASSERT] (c) 第5次观察正文仍在承诺虚假代价
//       （/体力[^。；]{0,10}(耗|减|掉|流)/）: 「D 级委托·石门之下」——
//       收获不会再多一分，体力却一直往下耗——说「休息」喘口气，…
//   改回新句「逗留的动静却在一格一格往上走」后复跑 (a)–(e) 全过，
//   连跑 2 次 PASS、exit=0。
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

// Oracle：新档落点场景与叙述名直读数据，不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const SCENE = CHAPTERS.chapters[0].scenes.find((s) => s.id === "ch1_double_gate");
const NARR_NAME = SCENE && (SCENE.narr_name || SCENE.title);

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f225-"));
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
    console.error(`[E2E] observe-cost: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// API_BASE 须在 _http.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.API_BASE = API;
const { assert, ok, makeSave, act, fetchSaveView } = await import("../assert/_http.mjs");

const OBSERVES = 6;
const METER_RE = /动静\s*(\d+)\s*\/\s*(\d+)/;
const LIE_RES = [/体力[^。；]{0,10}(耗|减|掉|流)/, /耗[^。；]{0,8}体力/];
const ACTION_RE = /前进|休息|潜行/;

assert(NARR_NAME, "oracle: ch1_double_gate narr_name/title missing in chapters.json");

const id = await makeSave("f225-obs-cost");
const sv0 = await fetchSaveView(id);
assert(
  sv0.save && sv0.save.scene === "ch1_double_gate" && !sv0.save.combat,
  `setup: 新档应落 ch1_double_gate 且无交战: ${JSON.stringify({ scene: sv0.save && sv0.save.scene })}`
);
const s0 = sv0.save;

const replies = [];
for (let i = 1; i <= OBSERVES; i++) {
  const r = await act(id, "观察");
  assert(r.refused !== true, `第${i}次观察被门禁拒绝（非交战态不得拒绝）: ${r.reply.content.slice(0, 80)}`);
  replies.push({ i, text: String(r.reply.content || ""), save: r.save });
  console.log(
    `    OBS${i} clock=${r.save.encounter_clock} hp=${r.save.hp} mp=${r.save.mp} · ` +
      r.reply.content.replace(/\s+/g, "").slice(0, 90)
  );
}

const free = replies.slice(0, 3); // 第 1–3 次：免费区
const over = replies.slice(3); //    第 4–6 次：复核区

// ── (a) 第 1–3 次 hp/mp/scene 与起始完全相等 ────────────────────
for (const r of free) {
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `(a) 第${r.i}次免费观察动了数值/场景：` +
      `${s0.hp}/${s0.mp}/${s0.scene} -> ${r.save.hp}/${r.save.mp}/${r.save.scene}`
  );
}
console.log(`[OK] (a) 前 3 次观察免费：hp/mp/scene 恒 ${s0.hp}/${s0.mp}/${s0.scene}`);

// ── (b) 第 4–6 次 encounter_clock 严格 +1 且「动静 N/M」N 递增 ──
{
  let prevClock = replies[2].save.encounter_clock;
  let prevN = null;
  for (const r of over) {
    const c = Number(r.save.encounter_clock);
    assert(
      c === Number(prevClock) + 1,
      `(b) 第${r.i}次 encounter_clock 未严格 +1：${prevClock} -> ${r.save.encounter_clock}`
    );
    prevClock = c;
    const m = r.text.match(METER_RE);
    assert(m, `(b) 第${r.i}次正文缺「动静 N/M」可见计数: ${r.text.slice(0, 80)}`);
    const n = Number(m[1]);
    if (prevN !== null) {
      assert(n > prevN, `(b) 第${r.i}次动静计数未严格递增：${prevN} -> ${n}`);
    }
    prevN = n;
  }
  console.log(
    `[OK] (b) 复核区代价可见：clock ${replies[2].save.encounter_clock}` +
      `→${over.map((r) => r.save.encounter_clock).join("→")}，动静 N 严格递增`
  );
}

// ── (c) 6 条回包零虚假承诺（不得宣称耗体力/掉血） ───────────────
for (const r of replies) {
  for (const re of LIE_RES) {
    assert(
      !re.test(r.text),
      `(c) 第${r.i}次观察正文仍在承诺虚假代价（${re}）: ${r.text.slice(0, 90)}`
    );
  }
}
console.log("[OK] (c) 6 条回包均无「体力…耗/耗…体力」式虚假承诺");

// ── (d) 第 4–6 次每条含可执行指引 ──────────────────────────────
for (const r of over) {
  assert(ACTION_RE.test(r.text), `(d) 第${r.i}次正文无可执行指引（前进/休息/潜行）: ${r.text.slice(0, 80)}`);
}
console.log("[OK] (d) 复核区每条正文都给出可执行指引（前进/休息/潜行）");

// ── (e) 正文非空；前 3 次以「<场景叙述名>」——开头 ──────────────
for (const r of replies) {
  assert(r.text.trim().length > 0, `(e) 第${r.i}次回包正文为空`);
}
for (const r of free) {
  assert(
    r.text.startsWith(`「${NARR_NAME}」——`),
    `(e) 第${r.i}次观察未以「${NARR_NAME}」——开头: ${r.text.slice(0, 60)}`
  );
}
console.log(`[OK] (e) 6 条正文皆非空，前 3 次均以「${NARR_NAME}」——开头（F092/F178）`);

ok(`observe-cost OK：免费区零副作用，复核区代价=动静 ${over
  .map((r) => r.text.match(METER_RE)[1])
  .join("→")}/${over[0].text.match(METER_RE)[2]} 且文案如实`);
