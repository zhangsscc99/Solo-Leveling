#!/usr/bin/env node
// F176 验收断言：自由输入兜底回包不再每句复读指令表；正文不出现机制术语。
//
//   1) 新存档连发 4 句自然语言长句（≥10 字、无数字、无信号词）：
//      - 含「眼下可以做」的回包 ≤1；含「输入「帮助」」的回包 ≤1；
//      - 4 条正文不得匹配 /遇敌率|机制|公式/；
//      - 4 条都必须是具象否认或场景叙述（非「系统未识别该指令」、非空）。
//   2) 正向锁：发「帮助」必须仍返回完整指令表（含「前进」与「帮助」）。
//   3) 隔离性：另建新存档，第一句必须能拿到指令表（计数按存档，非全局）。
//   4) 全部 /action HTTP 状态必须为 200。
//
// 用法（API_BASE 由 E2E_BASE_URL 推导，默认线上 https://openfolio.uk/game）：
//   PORT=3062 DB_PATH=/tmp/sl-f176.db node server/index.js &
//   E2E_BASE_URL=http://127.0.0.1:3062/game DB_PATH=/tmp/sl-f176.db \
//     node scripts/assert/free-tail-jargon.mjs
process.env.API_BASE =
  process.env.API_BASE ||
  `${(process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "")}/api`;

const { assert, ok, makeSave, post } = await import("./_http.mjs");

const SENTENCES = [
  "我把手按在石碑上，试着辨认第三条刻痕",
  "我贴近壁画，想看清那些褪色的轮廓",
  "我蹲下来摸了摸地面，看灰里有没有脚印",
  "我侧过耳朵贴着墙，听后面有没有动静",
];

const JARGON_RE = /遇敌率|机制|公式/;
let fails = 0;
const check = (cond, msg) => {
  if (!cond) {
    fails++;
    console.error(`[FAIL] ${msg}`);
  }
};

async function actRaw(id, input) {
  const { status, body } = await post("/action", { save_id: id, input });
  check(status === 200, `action「${input}」HTTP ${status}（期望 200）`);
  return body || {};
}

// --- 存档 A：4 句自然语言 ---
const idA = await makeSave("ftj");
let tailCount = 0;
let helpRefCount = 0;
for (let i = 0; i < SENTENCES.length; i++) {
  const { reply } = await actRaw(idA, SENTENCES[i]);
  const text = (reply && reply.content) || "";
  check(text.trim() !== "", `存档A 第${i + 1}句回包正文为空`);
  check(!text.includes("系统未识别该指令"), `存档A 第${i + 1}句回了「系统未识别该指令」：${text}`);
  check(!JARGON_RE.test(text), `存档A 第${i + 1}句正文出现机制术语：${text}`);
  if (text.includes("眼下可以做")) tailCount++;
  if (text.includes("输入「帮助」")) helpRefCount++;
}
check(tailCount <= 1, `存档A 4 句里「眼下可以做」出现 ${tailCount} 次（>1）`);
check(helpRefCount <= 1, `存档A 4 句里「输入「帮助」」出现 ${helpRefCount} 次（>1）`);

// --- 正向锁：帮助指令仍给完整指令表 ---
const { reply: helpReply } = await actRaw(idA, "帮助");
const helpText = (helpReply && helpReply.content) || "";
check(helpText.includes("前进") && helpText.includes("帮助"), `「帮助」回包缺指令表：${helpText}`);

// --- 隔离性：新存档第一句仍能拿到指令表 ---
const idB = await makeSave("ftj");
const { reply: b1 } = await actRaw(idB, "我把手按在石碑上，试着辨认第三条刻痕");
const b1Text = (b1 && b1.content) || "";
check(
  b1Text.includes("眼下可以做") && b1Text.includes("输入「帮助」"),
  `存档B 第一句没拿到指令表尾巴：${b1Text}`
);

assert(fails === 0, `${fails} 项断言失败`);
ok("free-tail-jargon: PASS");
