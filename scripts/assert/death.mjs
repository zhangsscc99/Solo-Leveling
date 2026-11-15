#!/usr/bin/env node
// F077 死亡与复活契约：
//   1) 持续作战（遭遇即开打、打完就前进）直到 HP 归 0 —— HP 必须真能
//      降到 0，不得被夹在 1；
//   2) 归零后进入复活分支：deaths+1、交战态清空、HP 回到 max_hp 的
//      ~50%（±1 取整误差）、MP 同比例、回到本章主线链首场景；
//   3) 日志含「倒下」「回溯」复活文案；
//   4) 全程任何回复不得出现「HP x→x」「MP x→x」同值消耗文案。
//   期望值只用 save.deaths / save.hp / max_hp 与回复文本，不调引擎。
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const id = await makeSave("death");
const SAME_VALUE = /(HP|MP) (\d+)→\2/;

const act = async (input) => {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  const leak = body.reply.content.match(SAME_VALUE);
  assert(!leak, `zero-delta consumption prose leaked: ${leak ? leak[0] : ""}`);
  return body;
};

// 起点快照：复活 HP 以本档的 max_hp 为准（途中升级会涨上限，死亡时重取）。
const { body: s0 } = await get(`/saves/${id}`);
assert(s0 && s0.save, "fresh save fetch failed");

let cur = null;
let died = null;
for (let i = 0; i < 120 && !died; i++) {
  // 交战就打，否则前进——前进途中 HP 也会真掉，两条路都能到 0。
  cur = await act(cur && cur.save.combat ? "攻击" : "前进");
  if (cur.save.deaths > 0) died = cur;
}
assert(died, "120 actions never reached a death — hp is probably still floored at 1");
assert(died.save.deaths >= 1, `deaths should increment, got ${died.save.deaths}`);

// 归零那一击的回复必须带死亡/复活文案，且战斗已收敛。
const deathReply = died.reply.content;
assert(deathReply.includes("倒下"), `death reply missing 倒下 broadcast: ${deathReply.slice(-200)}`);
assert(deathReply.includes("回溯"), `death reply missing 回溯 broadcast: ${deathReply.slice(-200)}`);
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
