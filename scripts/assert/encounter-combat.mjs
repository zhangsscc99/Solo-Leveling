#!/usr/bin/env node
// F088 遭遇与回合战斗契约：
//   1) 新档从第 1 章起点连发「攻击」≤10 次必然触发遭遇（引擎自带保底，
//      不许靠运气）：save.combat 非空、敌人 HP>0、reply 含「【遭遇】」。
//   2) 连续「攻击」走完整场战斗：回合数单调递增、敌人 HP 单调不增且
//      至少一次严格下降、玩家 HP 至少一次真扣血；击杀后 kills+1、XP
//      上涨且播报含「击败 X，获得 XP +N · 金币 +M」。
//   3) 敌人死后 save.combat 收敛为 null；此时再「攻击」不得产生击杀
//      （要么提示无目标，要么掷出下一场遭遇——两者都不许加 kills）。
//   期望值只依赖服务端返回的 save.combat / kills / xp，不调引擎函数。
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const id = await makeSave("encounter-combat");

const act = async (input) => {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  return body;
};

// ── 1) ≤10 次「攻击」内必然遇敌 ──────────────────────────────────
let cur = null;
let sawEngage = false;
for (let i = 1; i <= 10 && !sawEngage; i++) {
  cur = await act("攻击");
  if (cur.save.combat) {
    sawEngage = true;
    assert(
      cur.reply.content.includes("【遭遇】"),
      `encounter reply must carry 【遭遇】 marker, got: ${cur.reply.content.slice(0, 120)}`
    );
    assert(i <= 10, `encounter landed on action ${i} — over the 10-action budget`);
  } else {
    assert(
      cur.reply.content.includes("没有可攻击的目标"),
      `empty-swing reply must honestly say no target, got: ${cur.reply.content.slice(0, 120)}`
    );
    assert(cur.save.kills === 0, `empty swing must not grant kills (got ${cur.save.kills})`);
  }
}
assert(sawEngage, "no encounter within 10 consecutive 攻击 actions");
assert(cur.save.combat.enemy && cur.save.combat.enemy.hp > 0, "combat enemy missing or dead on spawn");
assert(cur.save.combat.enemy.max_hp >= cur.save.combat.enemy.hp, "enemy hp exceeds max_hp on spawn");
assert(cur.save.combat.turn === 1, `fresh combat turn should be 1, got ${cur.save.combat.turn}`);

// ── 2) 打完一场战斗：回合递增、敌 HP 单调、击杀入账 ────────────────
const killsBefore = cur.save.kills;
const xpBefore = cur.save.xp;
let prevTurn = cur.save.combat.turn;
let prevEnemyHp = cur.save.combat.enemy.hp;
let prevPlayerHp = cur.save.hp;
let enemyHpStrictlyDropped = false;
let playerTookDamage = false;
let killReply = null;
let turns = 0;

for (let i = 0; i < 60; i++) {
  cur = await act("攻击");
  if (!cur.save.combat) {
    killReply = cur.reply.content;
    break;
  }
  turns++;
  assert(
    cur.reply.content.includes(`第${prevTurn}回合`) || cur.reply.content.includes(`第 ${prevTurn} 回合`),
    `turn ${i}: reply missing 回合播报, got: ${cur.reply.content.slice(0, 140)}`
  );
  assert(cur.save.combat.turn === prevTurn + 1, `turn counter ${prevTurn} -> ${cur.save.combat.turn}`);
  assert(
    cur.save.combat.enemy.hp <= prevEnemyHp,
    `enemy hp went UP ${prevEnemyHp} -> ${cur.save.combat.enemy.hp}`
  );
  if (cur.save.combat.enemy.hp < prevEnemyHp) enemyHpStrictlyDropped = true;
  if (cur.save.hp < prevPlayerHp) playerTookDamage = true;
  assert(cur.save.hp > 0, `player died mid-fight — combat should have converged to death branch`);
  prevTurn = cur.save.combat.turn;
  prevEnemyHp = cur.save.combat.enemy.hp;
  prevPlayerHp = cur.save.hp;
}
assert(killReply !== null, "combat never converged within 60 attack turns");
assert(turns >= 1, "combat ended with zero resolved turns");
assert(enemyHpStrictlyDropped, "enemy hp never actually decreased");
assert(playerTookDamage, "player never took real damage from enemy counterattack");
assert(cur.save.kills === killsBefore + 1, `kills ${killsBefore} -> ${cur.save.kills}`);
assert(cur.save.xp > xpBefore, `xp ${xpBefore} -> ${cur.save.xp} (no kill xp)`);
assert(/击败 .+，获得 XP \+\d+ · 金币 \+\d+/.test(killReply), `missing kill broadcast: ${killReply.slice(-160)}`);

// ── 3) 战后收敛：combat=null；空挥不加击杀 ───────────────────────
{
  const { status, body } = await get(`/saves/${id}`);
  assert(status === 200 && body.save.combat === null, "stale active combat after kill");
}
const before = cur.save.kills;
cur = await act("攻击");
assert(cur.save.kills === before, `empty swing granted a kill: ${before} -> ${cur.save.kills}`);
if (!cur.save.combat) {
  assert(
    cur.reply.content.includes("没有可攻击的目标"),
    `no-enemy attack should say no target, got: ${cur.reply.content.slice(0, 140)}`
  );
} else {
  // 掷中遭遇表开新战也合法——同样不许白送击杀。
  assert(cur.reply.content.includes("【遭遇】"), "unexpected combat open without 【遭遇】 broadcast");
}

ok("OK");
