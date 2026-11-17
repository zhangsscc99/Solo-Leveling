#!/usr/bin/env node
// F174 散文快路径回归断言（完全自包含：自起隔离实例 + 假上游，不打线上）：
//
//   ① 起一个只 accept、永不响应的 TCP 假上游（net.createServer(sock => {})），
//      挂在 OPENCODE_GO_BASE_URL 上——网关的真实 fetch 打过去必然挂起，
//      指令形态输入因此吃满网关超时；散文快路径则根本不该发出 HTTP。
//   ② 起隔离实例：PORT=<随机> DB_PATH=<tmp>/game.db OPENCODE_GO_API_KEY=k
//      OPENCODE_GO_BASE_URL=http://127.0.0.1:<假上游>/v1 node server/index.js
//   ③ 断言（逐条打印 PASS/FAIL 与实测耗时，任一失败 exit 1）：
//      a. 线上事故原句「我蹲下身，捡起石阶缝里一枚发烫的碎片」→ /ai-action
//         <2000ms 返回、degraded falsy、正文是具象否认（含否认词与玩家
//         点名物，非 observe 模板）、不含「补给」「俱已满格」，且与
//         /action 对同一句输入的正文逐字相同、intent 口径一致；
//      b. F162 碎片否认句「我蹲下身，捡起地上一枚发烫的碎片」→ 同口径
//         快路径，正文逐字含「碎片」与否认词——线上被 qwen 答成补给
//         播报的正文形态在此保留；
//      c. 指令形态「遭遇哥布林」→ 假上游永不响应，网关 6s 超时后
//         degraded===true 回落规则解析：5–9s 内返回且正文回显原句。
//
//   注：事故原句里「石阶缝里」的玩家点名物经 free-action 消解为场景词表
//   实体「石阶」（LOC 前缀表只有「石阶上」没有「石阶缝里」），正文为
//   「可这里没有你说的石阶」——点名对象否认的契约不变，「碎片」字面
//   断言由 (b) 的地上变体逐字覆盖。
//
//   清理：按 pid SIGKILL 自起的实例、销毁假上游挂着的 socket 并 close。
//   绝不 pkill -f server/index.js，也不读 data/game.db。
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROSE_INPUT = "我蹲下身，捡起石阶缝里一枚发烫的碎片"; // 线上事故原句
const SHARD_INPUT = "我蹲下身，捡起地上一枚发烫的碎片"; // F162 点名「碎片」否认句
const COMMAND_INPUT = "遭遇哥布林"; // 指令形态：echoRequired===true

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

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

// ── 假上游：accept 之后永远不写字节 ─────────────────────────────────
const sinkSockets = new Set();
const fakeUpstream = net.createServer((sock) => {
  sinkSockets.add(sock);
  sock.on("close", () => sinkSockets.delete(sock));
  sock.on("error", () => {});
});
await new Promise((resolve, reject) => {
  fakeUpstream.once("error", reject);
  fakeUpstream.listen(0, "127.0.0.1", resolve);
});
const fakePort = fakeUpstream.address().port;

// ── 隔离实例：随机端口 + 临时 DB + 指到假上游的 AI 供应商 ────────────
const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f174-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: path.join(tmpDir, "game.db"),
  OPENCODE_GO_API_KEY: "k",
  OPENCODE_GO_BASE_URL: `http://127.0.0.1:${fakePort}/v1`,
};
delete env.NODE_CHANNEL_FD;
delete env.NODE_CHANNEL_SERIALIZATION_MODE;
delete env.AI_ALIYUN_API_KEY;
delete env.AI_ALIYUN_BASE_URL;
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => {
  childLog += d;
});
child.stderr.on("data", (d) => {
  childLog += d;
});

const API = `http://127.0.0.1:${gamePort}/game/api`;
let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  for (const s of sinkSockets) {
    try {
      s.destroy();
    } catch {}
  }
  try {
    fakeUpstream.close();
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

async function api(pathname, body, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${API}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// 等实例就绪（15s 上限）
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
    console.error(`[F174] 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    cleanup(1);
  }
}

// 新建存档（名字带时间戳，≤20 字）；B 档用于 /action 逐字对比
const tag = `f174-${Date.now().toString(36)}`;
async function newSave(name) {
  const r = await api("/saves", { player_name: name.slice(0, 20) });
  if (!(r.status === 201 && r.body && r.body.save && r.body.save.id)) {
    console.error(`[F174] 建存档失败 HTTP ${r.status}：${JSON.stringify(r.body)}`);
    cleanup(1);
  }
  return r.body.save.id;
}
const idA = await newSave(tag);
const idB = await newSave(`${tag}-b`);

try {
  // ── (a) 线上事故原句：散文必须走快路径，正文与 /action 逐字一致 ────
  const a = await api("/ai-action", { save_id: idA, input: PROSE_INPUT });
  const textA = a.body && a.body.reply && a.body.reply.content;
  report(
    `(a) 散文回包 HTTP 200 + 正文存在`,
    a.status === 200 && typeof textA === "string" && textA.length > 0,
    `HTTP ${a.status}`
  );
  report(`(a) 散文回包 <2000ms（不打 AI 网关）`, a.ms < 2000, `${a.ms}ms`);
  report(
    `(a) 散文回包 degraded 为 falsy`,
    Boolean(a.body) && !a.body.degraded,
    `degraded=${JSON.stringify(a.body && a.body.degraded)}`
  );
  report(
    `(a) 散文回包是具象否认（否认词 + 点名物，非 observe 模板）`,
    typeof textA === "string" &&
      /没有|不存在/.test(textA) &&
      /石阶|碎片/.test(textA) &&
      !textA.includes("重新审视"),
    typeof textA === "string" ? textA.split("\n")[0].slice(0, 80) : "无正文"
  );
  report(
    `(a) 散文回包不含「补给」与「俱已满格」`,
    typeof textA === "string" && !textA.includes("补给") && !textA.includes("俱已满格")
  );

  const b = await api("/action", { save_id: idB, input: PROSE_INPUT });
  const textB = b.body && b.body.reply && b.body.reply.content;
  report(
    `(a) /ai-action 与 /action 对同一句散文正文逐字相同、intent 一致`,
    typeof textA === "string" &&
      typeof textB === "string" &&
      textA === textB &&
      a.body.intent === b.body.intent,
    textA === textB
      ? `intent=${a.body && a.body.intent}`
      : `ai=${JSON.stringify(textA).slice(0, 80)} action=${JSON.stringify(textB).slice(0, 80)}`
  );

  // ── (b) F162 碎片否认句：点名对象字面进正文 ────────────────────────
  const c = await api("/ai-action", { save_id: idA, input: SHARD_INPUT });
  const textC = c.body && c.body.reply && c.body.reply.content;
  report(
    `(b) 碎片否认句回包 HTTP 200 + 正文存在`,
    c.status === 200 && typeof textC === "string" && textC.length > 0,
    `HTTP ${c.status}`
  );
  report(`(b) 碎片否认句回包 <2000ms`, c.ms < 2000, `${c.ms}ms`);
  report(
    `(b) 碎片否认句 degraded falsy、正文含「碎片」+ 否认词、无补给播报`,
    Boolean(c.body) &&
      !c.body.degraded &&
      typeof textC === "string" &&
      textC.includes("碎片") &&
      /没有|不存在/.test(textC) &&
      !textC.includes("补给") &&
      !textC.includes("俱已满格"),
    typeof textC === "string" ? textC.split("\n")[0].slice(0, 80) : "无正文"
  );

  // ── (c) 指令形态仍走 AI：假上游挂起 → 6s 超时降级回落规则 ──────────
  const d = await api("/ai-action", { save_id: idA, input: COMMAND_INPUT }, 30000);
  const textD = d.body && d.body.reply && d.body.reply.content;
  report(
    `(c) 指令「遭遇哥布林」5–9s 内返回（网关 6s 超时降级）`,
    d.ms >= 5000 && d.ms <= 9000,
    `${d.ms}ms`
  );
  report(
    `(c) 指令「遭遇哥布林」degraded === true 且正文回显原句`,
    Boolean(d.body) &&
      d.body.degraded === true &&
      typeof textD === "string" &&
      textD.includes("遭遇哥布林"),
    typeof textD === "string"
      ? textD.split("\n")[0].slice(0, 80)
      : JSON.stringify(d.body).slice(0, 120)
  );
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(
    failed.length
      ? `[F174] ${failed.length}/${results.length} 条断言失败`
      : `[F174] 全部 ${results.length} 条断言通过`
  );
  cleanup(failed.length ? 1 : 0);
}
