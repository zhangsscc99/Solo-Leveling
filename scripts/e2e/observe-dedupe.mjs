#!/usr/bin/env node
// observe-dedupe.mjs (F241): 同场景连点「观察」不得逐字复读——
//
//   第 49 轮走查实测：新档同一场景连续 6 次「观察」，第 4/5/6 次
//   （复核区）正文除「动静 1/4 → 2/4 → 3/4」的计数外完全相同——
//   observeOverRiskTail 只有两个固定变体，正文池 OBSERVE_OVER_LINES
//   在轮换、唯独风险尾注不轮换。修法：风险尾注按确定性种子（推进后
//   的 encounter_clock = clockNext）在 ≥3 条措辞池里轮换，语义口径
//   不变：「动静 N/4」计数串一字不动；clockNext >= PITY_LIMIT-1 时
//   仍写「已被惊动」（与 roll 的 c+1>=PITY_LIMIT 同一判定）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档天然落
//   ch1_double_gate，同场景连发 6 次「观察」，逐次取回包正文做句级
//   去重统计：
//     1) 每条正文按首个「——」切开，场景名前缀「「D 级委托·石门之下」
//        ——」不计入句级统计（否则每行重复造成假红）；
//     2) 余下正文按 。！？ 切句，去空串、去纯标点残片（如切句后落单
//        的「）」）；
//     3) 比对前把数字归一成 #（动静 1/4 → 2/4 是同一句话在涨计数，
//        计数本就该变、措辞不许变才不算复读；F225 已单独立断言锁
//        「动静 N/4」递增）；
//     a) 任意单句（归一后）在 6 条正文里出现次数 <= 2；
//     b) 去重后不同句子数 >= 6；
//     c) 每条回包正文非空，且第 4–6 次正文含「动静 N/4」计数串。
//   失败打印 [ASSERT] 明细（哪句重复几次）并 exit=1；全过 exit=0。
//   确定性轮换（非随机），连跑 2 次必须同结果。
//
//   旧码红证：不改 server/index.js 直接跑本脚本，(a) 抓住复核区风险
//   尾注复读，exit=1：
//     [ASSERT] (a) 句级复读：「说「前进」动身，或说「潜行」绕开」 在 6
//       条正文里出现 3 次（上限 2）
//     [ASSERT] (a) 句级复读：「（这一带已经看熟」 在 6 条正文里出现 3
//       次（上限 2）
//   （注：只按 。！？ 断句抓不住——尾注内的「——」不切断时，计数差
//    异会把复读藏进整句里；故「——」也作分句界。）
//   修复后连跑 2 次 PASS、exit=0。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f241-"));
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
    console.error(`[E2E] observe-dedupe: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// API_BASE 须在 _http.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.API_BASE = API;
const { assert, ok, makeSave, act } = await import("../assert/_http.mjs");

const OBSERVES = 6;
const METER_RE = /动静\s*\d+\s*\/\s*\d+/;
// 句级切分口径：首个「——」之前是场景名前缀（每行固有重复，剔除）；
// 余下按 。！？ 断句，「——」也算分句界（它是本正文里的子句边界——
// 风险尾注「这一带已经看熟——…——说「前进」…」只靠句终符切会把整
// 段复读藏进计数差异里）。滤掉空串与纯标点/空白残片。
const PURE_PUNCT_RE = /^[\p{P}\p{S}\s。！？，、；：—…·「」『』（）《》]+$/u;
function sentencesOf(text) {
  const idx = String(text).indexOf("——");
  const body = idx >= 0 ? String(text).slice(idx + 2) : String(text);
  return body
    .split(/[。！？]|——/)
    .map((s) => s.replace(/\s+/g, "").replace(/\d+/g, "#"))
    .filter((s) => s.length > 0 && !PURE_PUNCT_RE.test(s));
}

const id = await makeSave("f241-obs-dedupe");
const replies = [];
for (let i = 1; i <= OBSERVES; i++) {
  const r = await act(id, "观察");
  assert(r.refused !== true, `第${i}次观察被门禁拒绝（非交战态不得拒绝）: ${r.reply.content.slice(0, 80)}`);
  replies.push({ i, text: String(r.reply.content || "") });
  console.log(
    `    OBS${i} clock=${r.save.encounter_clock} · ` + r.reply.content.replace(/\s+/g, "").slice(0, 90)
  );
}

// ── (c) 正文非空；第 4–6 次含「动静 N/4」计数串（F225 口径） ─────
for (const r of replies) {
  assert(r.text.trim().length > 0, `(c) 第${r.i}次回包正文为空`);
}
for (const r of replies.slice(3)) {
  assert(METER_RE.test(r.text), `(c) 第${r.i}次正文缺「动静 N/4」可见计数: ${r.text.slice(0, 80)}`);
}
console.log("[OK] (c) 6 条正文皆非空，复核区每条仍带「动静 N/4」计数");

// ── (a) 任意单句（数字归一后）在 6 条正文里出现 <= 2 次 ─────────
const counts = new Map();
for (const r of replies) {
  for (const s of sentencesOf(r.text)) counts.set(s, (counts.get(s) || 0) + 1);
}
let dupFound = false;
for (const [s, n] of counts) {
  if (n > 2) {
    dupFound = true;
    console.error(`[ASSERT] (a) 句级复读：「${s.length > 80 ? s.slice(0, 80) + "…" : s}」 在 ${OBSERVES} 条正文里出现 ${n} 次（上限 2）`);
  }
}
assert(!dupFound, `(a) 存在句级复读（详见上方明细）`);
console.log(`[OK] (a) 无单句出现超过 2 次`);

// ── (b) 去重后不同句子数 >= 6 ──────────────────────────────────
assert(
  counts.size >= 6,
  `(b) 去重后不同句子仅 ${counts.size} 条（要求 >= 6）: ${[...counts.keys()].join(" | ").slice(0, 200)}`
);
console.log(`[OK] (b) 去重后不同句子 ${counts.size} 条（>= 6）`);

ok(`observe-dedupe OK：6 次观察无逐字复读（句子 ${counts.size} 种，单句最多 2 次）`);
