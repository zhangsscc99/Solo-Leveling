#!/usr/bin/env node
// F170 叙事降级与 /action 同行为契约（F175 修订：AI 网关线上已启用，
// 「本环境恰好没 key」不再成立——降级路径由断言脚本自己制造）：
//
//   Part A · 隔离无 key 实例（本脚本内 spawn 自起自停，不依赖外部 shell）：
//     空闲端口（net listen(0) 取号即关）+ spawn(process.execPath,
//     server/index.js, { PORT, DB_PATH=<tmp>/game.db, OPENCODE_GO_* /
//     AI_ALIYUN_* 置空 })，轮询 /api/health ≤15s，进程退出时按 pid
//     SIGKILL（绝不 pkill -f，也绝不碰 data/game.db）。
//     key 置空串而非 delete：server/load-env.js 不覆盖已定义的环境键，
//     空串同时挡住仓库根 .env 注回；gateway 的 readEnv 把空串当未配置。
//     · 散文长句 /ai-action vs /action：正文逐字相同、含「碎片」与否认
//       词（没有/不存在）、不含通用观察模板「重新审视」、intent 一致——
//       F170 真契约在「降级确实可发生」的环境下仍然成立；
//     · 指令形态「遭遇哥布林」→ /ai-action 必须 degraded:true 且正文回显
//       原句。F174 之后散文恒走快路径（degraded 保持 falsy——快路径不是
//       降级），能打网关、能退化的只剩指令形态，degraded:true 的正向
//       证据由它产出。
//   Part B · 目标环境（API_BASE，默认 127.0.0.1:3020/game/api；线上
//     openfolio.uk 同构）降级不敏感契约：同一句散文两个入口的正文逐字
//     相同、均不含「重新审视」；若 /ai-action 回包带 degraded:true 则
//     额外断言正文含否认词（兼容仍会降级的环境）。
import { assert, ok, API } from "./_http.mjs";
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INPUT = "我蹲下身，捡起地上一枚发烫的碎片";
const COMMAND_INPUT = "遭遇哥布林"; // 指令形态：echoRequired→true，打 AI 网关
const DENY_RE = /没有|不存在/;

async function postTo(base, pathname, body, ms = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function newSave(base, tag) {
  const { status, body } = await postTo(base, "/saves", { player_name: tag });
  assert(status === 201 && body && body.save && body.save.id,
    `create save failed (HTTP ${status})`);
  return body.save.id;
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

// 同一句散文在两个入口的回包契约：正文逐字相同、是具象否认（点名物 +
// 否认词）、不含 observe 通用模板、intent 一致。
function assertParity(a, b, where) {
  const textA = a && a.reply && a.reply.content;
  const textB = b && b.reply && b.reply.content;
  assert(typeof textA === "string" && typeof textB === "string",
    `${where}: 回包缺 reply.content`);
  assert(textA === textB,
    `${where}: /ai-action 与 /action 正文不逐字相同：` +
      `ai=${JSON.stringify(textA).slice(0, 90)} action=${JSON.stringify(textB).slice(0, 90)}`);
  assert(textA.includes("碎片"), `${where}: 正文不含点名物「碎片」：${textA.slice(-160)}`);
  assert(DENY_RE.test(textA), `${where}: 正文缺否认词（没有/不存在）：${textA.slice(-160)}`);
  assert(!textA.includes("重新审视"), `${where}: 仍回 observe 通用模板：${textA.slice(-160)}`);
  assert(a.intent === b.intent,
    `${where}: 两入口 intent 不一致：ai-action=${a.intent} action=${b.intent}`);
  return textA;
}

// ── Part A：隔离无 key 实例 ─────────────────────────────────────────
const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f170-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: path.join(tmpDir, "game.db"),
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

const ISO = `http://127.0.0.1:${gamePort}/game/api`;
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ISO}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  assert(up, `隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
}

const rand = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
try {
  const idA = await newSave(ISO, `F170a-${rand}`.slice(0, 20));
  const idB = await newSave(ISO, `F170b-${rand}`.slice(0, 20));
  const { status, body: a } = await postTo(ISO, "/ai-action", { save_id: idA, input: INPUT });
  assert(status === 200, `隔离实例 /ai-action failed (HTTP ${status})`);
  const { body: b } = await postTo(ISO, "/action", { save_id: idB, input: INPUT });
  const textIso = assertParity(a, b, "隔离无key实例");
  console.log(`    [iso] ai-action : ${textIso.split("\n")[0].slice(0, 90)}`);

  // degraded:true 正向证据：指令形态打网关 → no-key → 降级回落规则解析。
  const { status: ds, body: d } = await postTo(ISO, "/ai-action", {
    save_id: idA,
    input: COMMAND_INPUT,
  });
  const textD = d && d.reply && d.reply.content;
  assert(ds === 200 && d && d.degraded === true,
    `隔离无 key 实例指令未降级 degraded!==true：${JSON.stringify(d).slice(0, 200)}`);
  assert(typeof textD === "string" && textD.includes(COMMAND_INPUT),
    `隔离实例降级回包未回显原句「${COMMAND_INPUT}」：${String(textD).slice(0, 160)}`);
  console.log(`    [iso] ai-action(degraded:true): ${textD.split("\n")[0].slice(0, 90)}`);
} finally {
  try {
    child.kill("SIGKILL");
  } catch {}
}

// ── Part B：目标环境（默认本机 3020，线上同构）降级不敏感契约 ────────
const idC = await newSave(API, `F170c-${rand}`.slice(0, 20));
const idD = await newSave(API, `F170d-${rand}`.slice(0, 20));
const { status: s2, body: a2 } = await postTo(API, "/ai-action", { save_id: idC, input: INPUT });
assert(s2 === 200, `目标环境 /ai-action failed (HTTP ${s2})`);
const { body: b2 } = await postTo(API, "/action", { save_id: idD, input: INPUT });
const text2 = assertParity(a2, b2, "目标环境");
if (a2.degraded === true) {
  assert(DENY_RE.test(text2), `degraded 回包缺否认词（没有/不存在）：${text2.slice(-160)}`);
  console.log(`    [env] /ai-action degraded:true，正文含否认词 ✓`);
} else {
  console.log(`    [env] /ai-action degraded=${JSON.stringify(a2.degraded)}（散文快路径，非降级）`);
}
console.log(`    [env] ai-action : ${text2.split("\n")[0].slice(0, 90)}`);

ok("ai-degraded-parity: 隔离实例 degraded:true 证据 + /ai-action 与 /action 正文逐字一致");
