#!/usr/bin/env node
// F221 验收断言：自由输入叙事回复不再补命令行说明书；must_choose 拒绝
// 不再用 1) 2) 3) 编号复述选项。
//
//   1) 新存档连发 3 条自然语言长句（≥10 字、无数字、无指令信号词）：
//      - 正文不含「眼下可以做」「输入「帮助」」「查看完整指令表」——
//        F176 的「首句给一次指令表尾巴」被 F221 整段废除；
//      - 每条「说「X」」锚点 ≥2（/说「[^」]+」/ 计数，F146 契约不破）；
//      - 每条最后一句不以「【系统】」开头、不含 /\d)/ 编号——回包必须
//        以叙事句（unknownSceneLine）收尾，系统话术不得压尾；
//      - 正文非空、不含「系统未识别该指令」（自然语言不得被打回指令报错）。
//   2) 正向锁：发「帮助」仍返回含「前进」「帮助」的完整指令表。
//   3) must_choose：新档 DB 落点第 1 章首个 must_choose 场景（oracle 独立
//      读 chapters.json），连点「前进」2 次——正文不得命中 /\d)/，
//      仍 refused===true、HP/MP/场景零变动。
//
//   旧码红证：旧码尾巴恒挂「眼下可以做：…输入「帮助」查看完整指令表。」
//   压在最末（(1) 禁语 FAIL + 末句叙事 FAIL），must_choose 拒绝正文
//   「1) … 2) … 3) …」命中 /\d)/（(3) FAIL）。
//
// 用法（API_BASE 由 E2E_BASE_URL 推导，默认线上 https://openfolio.uk/game）：
//   PORT=3067 DB_PATH=/tmp/sl-f221.db node server/index.js &
//   E2E_BASE_URL=http://127.0.0.1:3067/game DB_PATH=/tmp/sl-f221.db \
//     node scripts/assert/free-input-prose.mjs
process.env.API_BASE =
  process.env.API_BASE ||
  `${(process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "")}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { assert, ok, makeSave, post, act, fetchSaveView } = await import("./_http.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

// 独立 oracle：第 1 章首个 must_choose 场景（与 must-choose-copy.mjs 同法）。
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
assert(MC && Array.isArray(MC.choices) && MC.choices.length >= 2, "oracle: ch1 must_choose scene missing");

function toMustChoose(id) {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(MC.id, id);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  } finally {
    db.close();
  }
}

const SENTENCES = [
  "我蹲下来，用手背碰了碰石板上那摊血。",
  "我把掌心贴在石壁上，感受那些刻痕的深浅。",
  "我屏住呼吸，听门后有没有脚步声。",
];

const BANNED = ["眼下可以做", "输入「帮助」", "查看完整指令表"];
const ENUM_RE = /\d\)/;
const ANCHOR_RE = /说「[^」]+」/g;

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

// --- (1) 存档 A：3 句自然语言长句 ---
const idA = await makeSave("f221-prose");
for (let i = 0; i < SENTENCES.length; i++) {
  const { reply } = await actRaw(idA, SENTENCES[i]);
  const text = (reply && reply.content) || "";
  check(text.trim() !== "", `存档A 第${i + 1}句回包正文为空`);
  check(!text.includes("系统未识别该指令"), `存档A 第${i + 1}句被打回指令报错：${text}`);
  for (const b of BANNED) {
    check(!text.includes(b), `存档A 第${i + 1}句仍含禁语「${b}」：${text}`);
  }
  const verbs = text.match(ANCHOR_RE) || [];
  check(
    verbs.length >= 2,
    `存档A 第${i + 1}句「说「X」」锚点 <2（F146 回归）：${JSON.stringify(verbs)} ← ${text}`
  );
  const last = (text.trim().split("\n").filter((l) => l.trim() !== "").pop() || "").trim();
  check(!last.startsWith("【系统】"), `存档A 第${i + 1}句末句仍是系统话术：${last}`);
  check(!ENUM_RE.test(last), `存档A 第${i + 1}句末句含编号清单：${last}`);
}

// --- (2) 正向锁：帮助指令仍给完整指令表 ---
const { reply: helpReply } = await actRaw(idA, "帮助");
const helpText = (helpReply && helpReply.content) || "";
check(helpText.includes("前进") && helpText.includes("帮助"), `「帮助」回包缺指令表：${helpText}`);

// --- (3) must_choose：拒绝正文不得再带编号复述 ---
const idB = await makeSave("f221-prose-mc");
toMustChoose(idB);
const pre = (await fetchSaveView(idB)).save;
assert(
  pre.scene === MC.id && !pre.combat,
  `setup broken: scene=${pre.scene} combat=${JSON.stringify(pre.combat)}`
);
for (let i = 0; i < 2; i++) {
  const r = await act(idB, "前进");
  const text = String((r.reply && r.reply.content) || "");
  check(r.refused === true, `must_choose push#${i + 1} 未拒绝：${JSON.stringify(r.refused)}`);
  check(!ENUM_RE.test(text), `must_choose push#${i + 1} 仍含编号复述：${text}`);
  check(
    r.save.scene === MC.id && r.save.hp === pre.hp && r.save.mp === pre.mp,
    `must_choose push#${i + 1} 拒绝不是零消耗：scene ${r.save.scene} hp ${pre.hp}->${r.save.hp} mp ${pre.mp}->${r.save.mp}`
  );
}

assert(fails === 0, `${fails} 项断言失败`);
ok("free-input-prose: PASS");
