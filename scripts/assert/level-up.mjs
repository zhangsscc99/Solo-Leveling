#!/usr/bin/env node
// F082 XP 达标即升级契约：
//   1) 新档正常玩（连发「前进」≤10 步）后 level>=2、free_points>0、
//      xp_to_next 与 levels.json 里当前等级行的 xpToNext 完全一致；
//      XP 来源必须是真实结算（每日任务 / 主线奖励 / 击杀），不是凭空加值。
//   2) 一次大额奖励必须跨级：ch3 主线奖励 xp=320（quests.json 独立读出），
//      入账那一次 action 前后 level 至少 +2，且出现 ≥2 条「【升级】」播报。
//   期望值全部由 levels.json / quests.json 原始数据推导，不调引擎函数。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEVELS = require(path.join(ROOT, "server", "data", "levels.json"));
const QUESTS = require(path.join(ROOT, "server", "data", "quests.json"));

const xpToNextOf = (lv) => {
  const row = LEVELS.find((r) => r.level === lv);
  return row ? row.xpToNext : null;
};
const mainXp = (ch) => (QUESTS.main_rewards && QUESTS.main_rewards[ch] ? QUESTS.main_rewards[ch].xp : null);

const id = await makeSave("level-up");

const act = async (input) => {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  return body;
};

// ── 1) ≤10 步自然升到 Lv.2 ──────────────────────────────────────
let cur = null;
let steps = 0;
for (let i = 0; i < 10 && !(cur && cur.save.level >= 2); i++) {
  steps++;
  cur = await act("前进");
}
assert(cur.save.level >= 2, `level ${cur.save.level} after ${steps} actions — daily xp < 70 path broken`);
assert(cur.save.free_points > 0, `level-up must grant free_points, got ${cur.save.free_points}`);
assert(
  cur.save.xp_to_next === xpToNextOf(cur.save.level),
  `xp_to_next ${cur.save.xp_to_next} != levels.json ${xpToNextOf(cur.save.level)} for Lv.${cur.save.level}`
);
assert(
  cur.save.xp >= 0 && cur.save.xp < cur.save.xp_to_next,
  `xp ${cur.save.xp} out of [0, xp_to_next=${cur.save.xp_to_next})`
);

// ── 2) 大额主线奖励跨级：推到 ch3 链尾（ch3 奖励 xp>=320）─────────
// 途中遇敌一律「前进」强行撤离（引擎收敛交战态），死亡会回溯到本章
// 起点但场景链继续可数——循环上限给足，直到第三次主线奖励入账。
assert(mainXp("ch3") >= 300, `oracle: ch3 main reward ${mainXp("ch3")} expected >= 300 xp`);
let levelJumps = 0;
let chGrants = 0;
let guard = 0;
while (guard++ < 200 && chGrants < 3) {
  const before = cur.save.level;
  cur = await act("前进");
  if (/【主线】第\d+章主线达成/.test(cur.reply.content)) {
    chGrants++;
    const jump = cur.save.level - before;
    if (jump >= 2) {
      levelJumps = jump;
      const ups = (cur.reply.content.match(/【升级】/g) || []).length;
      assert(ups >= 2, `multi-level reward should emit >=2 【升级】 lines, got ${ups}`);
      break;
    }
  }
}
assert(levelJumps >= 2, `no single reward crossed multiple levels (best jump ${levelJumps})`);
assert(
  cur.save.xp_to_next === xpToNextOf(cur.save.level),
  `post-jump xp_to_next ${cur.save.xp_to_next} != levels.json ${xpToNextOf(cur.save.level)}`
);

ok("OK");
