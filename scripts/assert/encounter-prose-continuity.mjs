#!/usr/bin/env node
// P202 遭遇战「起势衔接」契约（全是行为断言）：
//
//   线上实测（第 36 轮走查）：第 1 章连点三次「探索前进」，第三次的正文
//   以「……血在石板缝里摊开，视野边缘开始发黑。（体力消耗 HP 97→94 ·
//   MP 18→16）」收束，同一回包紧接着下发「【遭遇】石像守卫 Lv.2 拦住了
//   去路——HP 75/75」——玩家在「已被打断腿等死」的文字里满血开打，
//   两套说法当面打架。
//
//   断言（新档反复「前进」直到触发遭遇，至多 12 次；保底/守关必中保证
//   12 次内必达）：
//     a) 交战前最后一段正文（【遭遇】之前最后一个非空行）不含终局词表
//        （视野边缘开始发黑 / 腿骨断裂 / 血在石板缝里摊开 / 来不及叫 /
//        倒在 / 失去意识），也不是「（体力消耗…）」注脚本身；
//     b) 该收束行必须是遭遇起势句——server/index.js 导出的纯函数
//        encounterRiseLine 按实际敌人展开的全部变体，逐字命中其一
//        （未导出/未实现时本断言必 FAIL——旧码红证所在）；
//     c) 对手一致性：「收束行写巨像/守关者」与「战斗对象是普通小怪
//        （enemy.boss === false）」不得同时成立——写守关者时敌人必须
//        是 boss，敌人是小怪时起势句不得再把守关者说成对手；
//     d) 遭遇真实发生：save.combat 在场、敌人 HP 满/未死。
//
//   旧码红证：旧实现落地正文末尾直接接【遭遇】——收束行是
//   「（体力消耗 HP…）」注脚，命中 (a)/(b) FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 与运行实例指向同一库（import 服务端纯函数用，不落数据）。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// 终局词表：与 server/index.js 的 ENCOUNTER_TERMINAL_MARKS 同源——服务端
// 导出时以导出为准，未导出（旧码）回落本地副本，行为断言照样能跑。
const LOCAL_TERMINAL_MARKS = [
  "视野边缘开始发黑",
  "腿骨断裂",
  "血在石板缝里摊开",
  "来不及叫",
  "倒在",
  "失去意识",
];
process.env.DB_PATH =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const server = require(path.join(ROOT, "server", "index.js"));
const TERMINAL_MARKS =
  Array.isArray(server.ENCOUNTER_TERMINAL_MARKS) && server.ENCOUNTER_TERMINAL_MARKS.length
    ? server.ENCOUNTER_TERMINAL_MARKS
    : LOCAL_TERMINAL_MARKS;
const encounterRiseLine =
  typeof server.encounterRiseLine === "function" ? server.encounterRiseLine : null;

const GUARDIAN_RE = /巨像|守关者/;
// 起势句的最低形态（不依赖导出）：起身/站稳类动作收束，且不是代价注脚。
const RISE_RE = /撑起身|撑起全身|站稳|站直|站了起来|站稳脚跟/;

const id = await makeSave("p202-rise");
let hit = null;
for (let i = 1; i <= 12 && !hit; i++) {
  const r = await act(id, "前进");
  const enemy = r.save && r.save.combat && r.save.combat.enemy;
  if (r.reply.content.includes("【遭遇】") || enemy) {
    hit = { reply: r.reply.content, enemy, press: i };
  }
}
assert(hit, "12 次「前进」内没有触发遭遇（保底机制应保证必达）");
assert(
  hit.enemy && Number(hit.enemy.hp) > 0,
  `(d) 遭遇未真实开战：combat=${JSON.stringify(hit.enemy)}`
);
console.log(
  `    遭遇触发于第 ${hit.press} 次「前进」：${hit.enemy.name} ` +
    `Lv.${hit.enemy.level} boss=${hit.enemy.boss === true}`
);

// ── (a)(b) 交战前最后一段正文：无终局词、是起势句 ─────────────────
const encIdx = hit.reply.indexOf("【遭遇】");
assert(encIdx >= 0, "遭遇回包缺【遭遇】段——契约前置被破坏");
const pre = hit.reply.slice(0, encIdx);
const closing =
  pre
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() || "";
assert(closing, "【遭遇】之前没有任何正文行");
console.log(`    战前收束行：${closing}`);

for (const w of TERMINAL_MARKS) {
  assert(
    !closing.includes(w),
    `(a) 战前收束行含终局词「${w}」——玩家在濒死描写里被拉进战斗：${closing}`
  );
}
assert(
  !/体力消耗|没有消耗|未耗/.test(closing),
  `(a) 战前收束行仍是代价注脚而非正文收束：${closing}`
);
assert(
  RISE_RE.test(closing),
  `(b) 战前收束行不是战斗起势句（无起身/站稳类收束）：${closing}`
);
if (encounterRiseLine) {
  const variants = [0, 1, 2, 3, 4].map((seq) =>
    encounterRiseLine({ ...hit.enemy, seq })
  );
  assert(
    variants.includes(closing),
    `(b) 战前收束行未逐字命中 encounterRiseLine 词池：${closing} ‖ 池: ` +
      JSON.stringify(variants.map((v) => v.slice(0, 24)))
  );
}

// ── (c) 对手一致性：写守关者 ⇒ 敌人必须是 boss ──────────────────
const wroteGuardian = GUARDIAN_RE.test(closing);
const enemyIsMob = hit.enemy.boss === false;
assert(
  !(wroteGuardian && enemyIsMob),
  `(c) 起势句把守关者/巨像写成对手，遭遇对象却是普通小怪 ` +
    `${hit.enemy.name}（非 boss）：${closing}`
);

ok("encounter-prose-continuity OK");
