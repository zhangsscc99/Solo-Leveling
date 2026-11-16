#!/usr/bin/env node
// F077 死亡与复活契约 + F103 交战中「前进」致死收束：
//   驱动必须确定性到达一次「交战中点前进（撤离掷逃失败）致死」：
//     · 无交战 → 「前进」真实推进；
//     · 交战中 → 「前进」（撤离掷逃）——且每次动作前经 DB 落点把 HP
//       压到 1（max_hp 不动）：敌人反击最小伤害为 1（F111 伤害下限），
//       掷逃失败回合一旦命中即归零——死亡必然出自「交战中前进」这一
//       动作的撤离掷逃反击，不靠直写 deaths 或调内部函数伪造；
//     · 回包提示「叫阵」（守关者封门）/ advance_mode=challenge_boss /
//       存档指纹连续 2 次不变 → 发「攻击」：服务端指令白名单里没有
//       「叫阵」词条，守关房内「叫阵守关者」按钮的真实入口就是 attack
//       意图（peacefulCombatIntent 的 bossChallenge 分支 forceBoss
//       压过再入冷却直接开战）。裸发「叫阵」会落 unknown 占位空转。
//   死亡回包断言（F103）：「倒下」「回溯」在场；「撤离失败」「仍堵在
//   面前」「寸步未移」一律不得出现；combat===null；复活 HP/MP≈50%。
//   全程任何回复不得出现「HP x→x」「MP x→x」同值消耗文案。
//   期望值只用 save.deaths / save.hp / max_hp 与回复文本，不调引擎。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const Database = require("better-sqlite3");
const db = new Database(dbPath);

const id = await makeSave("death");
const SAME_VALUE = /(HP|MP) (\d+)→\2/;
const FORBIDDEN_DEATH_PROSE = ["撤离失败", "仍堵在面前", "寸步未移"];

const act = async (input) => {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  const leak = body.reply.content.match(SAME_VALUE);
  assert(!leak, `zero-delta consumption prose leaked: ${leak ? leak[0] : ""}`);
  return body;
};

// 动作前把玩家 HP 压到 1（只写 hp 列，max_hp 不变）：掷逃失败回合敌人
// 反击命中即死，同一回合内必然致死。
const pressHp = () => db.prepare("UPDATE saves SET hp = 1 WHERE id = ?").run(id);

// 存档指纹：跨回包比对「上一个动作是否真的改动了世界」，覆盖场景、
// 数值、交战回合与门禁模式——连续不变 = 驱动在空转，须换「攻击」叫阵。
const sigOf = (s) => {
  const c = (s && s.combat) || {};
  const e = c.enemy || {};
  return [
    s.scene, s.chapter, s.hp, s.mp, s.deaths, s.encounter_clock,
    s.encounter_cd, s.advance_mode, c.seq, c.turn, e.hp,
  ].join("|");
};

// 起点快照：复活 HP 以本档的 max_hp 为准（途中升级会涨上限，死亡时重取）。
const { body: s0 } = await get(`/saves/${id}`);
assert(s0 && s0.save, "fresh save fetch failed");

let cur = null;
let died = null;
let prevSig = null;
let stale = 0;
let lastInput = null;
// 无交战「前进」真实推进——守关者封门（回包含「叫阵」/ challenge_boss）
// 或指纹连续 2 次不变时改发「攻击」叫阵；交战中「前进」= 撤离掷逃，
// 动作前压 HP 至 1，失败回合吃反击即阵亡。只有「上一刻尚在交战、本
// 动作是前进、本回包 deaths 增加」才算命中交战中前进致死，体力流尽
// 的非交战死亡不算数，循环继续。
for (let i = 0; i < 400 && !died; i++) {
  const inCombat = Boolean(cur && cur.save && cur.save.combat);
  const prevDeaths = cur ? Number(cur.save.deaths) || 0 : 0;
  let input = "前进";
  if (inCombat) {
    pressHp();
  } else {
    const mustChallenge =
      (cur && cur.reply.content.includes("叫阵")) ||
      (cur && cur.save.advance_mode === "challenge_boss") ||
      stale >= 2;
    // 「攻击」刚发过仍空转（遭遇掷空等）时先回「前进」，两者交替不锁死。
    if (mustChallenge && lastInput !== "攻击") input = "攻击";
  }
  cur = await act(input);
  lastInput = input;
  const sig = sigOf(cur.save);
  stale = sig === prevSig ? stale + 1 : 0;
  prevSig = sig;
  if ((Number(cur.save.deaths) || 0) > prevDeaths && inCombat) died = cur;
}
assert(
  died,
  "400 actions never reached a combat-advance death — 撤离掷逃致死路径未被覆盖（或 hp 仍被夹在 1）"
);
assert(died.save.deaths >= 1, `deaths should increment, got ${died.save.deaths}`);

// F103：撤离掷逃致死的回包只有死亡叙述 + 复活播报——「倒下」「回溯」
// 必须在场，「撤离失败」「仍堵在面前」「寸步未移」一律不得出现，
// 交战态必须已收敛。
const deathReply = died.reply.content;
assert(deathReply.includes("倒下"), `death reply missing 倒下 broadcast: ${deathReply.slice(-200)}`);
assert(deathReply.includes("回溯"), `death reply missing 回溯 broadcast: ${deathReply.slice(-200)}`);
for (const phrase of FORBIDDEN_DEATH_PROSE) {
  assert(!deathReply.includes(phrase), `death reply still carries「${phrase}」: ${deathReply.slice(-300)}`);
}
assert(died.save.combat === null, "stale active combat after death");

// 复活数值：HP ≈ max_hp×50%（服务端 Math.round，允许 ±1），MP 同比例。
const expectedHp = Math.round(died.save.max_hp * 0.5);
assert(
  Math.abs(died.save.hp - expectedHp) <= 1,
  `revived hp ${died.save.hp} != ~50% of max ${died.save.max_hp}`
);
const expectedMp = Math.round(died.save.max_mp * 0.5);
assert(
  Math.abs(died.save.mp - expectedMp) <= 1,
  `revived mp ${died.save.mp} != ~50% of max ${died.save.max_mp}`
);

// 复活后继续行动不得输出零变化消耗文案（已在 act() 里逐条断言过全程）。
cur = await act("前进");
assert(cur.save.hp > 0, "post-revival save has non-positive hp");

ok("OK");
