#!/usr/bin/env node
// F088 遭遇与回合战斗契约（round4 加固口径）：
//   1) 新档连发「攻击」≤10 次必然触发遭遇（保底）：save.combat 非空、
//      敌人 HP>0、reply 含「【遭遇】」；
//   2) 同一场景连续两场战斗（开战→「逃跑」→原地再「攻击」）敌人身份
//      或回合伤害序列不得完全一致——开战盐 seq 保证 RNG 流场场不同；
//   3) 交战中「休息」不产生任何 HP/MP 收益（改判诚实播报，不占回合）；
//   4) 交战中「使用道具」按所选物品结算：魔力药剂真回 MP、播报用物品
//      本名、库存精确扣减 1；点名未持有物品被诚实拒绝、不耗回合；
//   5) 打完一场：回合递增、敌 HP 单调不增且至少一次严格下降、玩家掉
//      血、击杀 kills+1/XP 入账、播报含「击败 X，获得 XP +N · 金币 +M」；
//   6) 击杀冷却：原地连点「攻击」不再开战、不再计 kill——刷怪必须
//      付出移动成本；
//   7) boss 门控：不杀守关 boss 走到主线链尾 → 不发主线奖励且播报
//      显性说明；击杀后落到链尾 → 主线奖励正常入账。
//   期望值只依赖服务端返回的 save.combat / kills / xp / rewards，不调引擎。
import { assert, ok, get, makeSave, act, fetchSaveView, advanceOnce } from "./_http.mjs";

// ── A) 同档验证：遭遇/差异/休息/道具/击杀/冷却 ────────────────────
const id = await makeSave("encounter-combat");
const doAct = (input) => act(id, input);

// 1) ≤10 次「攻击」内必然遇敌
let cur = null;
let sawEngage = false;
for (let i = 1; i <= 10 && !sawEngage; i++) {
  cur = await doAct("攻击");
  if (cur.save.combat) {
    sawEngage = true;
    assert(
      cur.reply.content.includes("【遭遇】"),
      `encounter reply must carry 【遭遇】 marker, got: ${cur.reply.content.slice(0, 120)}`
    );
  } else {
    assert(cur.save.kills === 0, `empty swing must not grant kills (got ${cur.save.kills})`);
  }
}
assert(sawEngage, "no encounter within 10 consecutive 攻击 actions");
const fight1 = { ...cur.save.combat.enemy, seq: cur.save.combat.seq };
assert(fight1.hp > 0 && fight1.max_hp >= fight1.hp, "combat enemy missing or dead on spawn");
assert(cur.save.combat.turn === 1, `fresh combat turn should be 1, got ${cur.save.combat.turn}`);

// 摆 4 回合「防御」留档（不杀伤敌人，保证能逃能再开；指纹 = 每回合敌我
// HP 快照，敌人反击的命中/暴击序列随开战盐变化），随后「逃跑」脱离——
// 不清场景、不触发击杀冷却，原地即可再开下一场。
const playTurns = async (n) => {
  const transcript = [];
  for (let i = 0; i < n && cur.save.combat; i++) {
    cur = await doAct("防御");
    transcript.push(
      cur.save.combat
        ? `${cur.save.combat.enemy.hp}/${cur.save.hp}`
        : `dead:${cur.save.hp}`
    );
  }
  return transcript.join("|");
};
const fleeOut = async () => {
  for (let i = 0; i < 20 && cur.save.combat; i++) cur = await doAct("逃跑");
  assert(!cur.save.combat, "flee never succeeded within 20 attempts");
};

const sceneOfFights = cur.save.scene;
const fights = [{ ...cur.save.combat.enemy, seq: cur.save.combat.seq, transcript: await playTurns(4) }];
await fleeOut();

// 2) 原地再「攻击」连开新场（最多采样 3 场）：seq 必须场场不同，
//    且（敌人身份+HP+回合伤害指纹）不得全部撞车——小怪池只有两只，
//    单场撞身份是合法的，连撞三场全同才是 bug 复现。
for (let r = 0; r < 2 && fights.length < 3; r++) {
  let next = null;
  for (let i = 0; i < 10 && !next; i++) {
    cur = await doAct("攻击");
    if (cur.save.combat) next = { ...cur.save.combat.enemy, seq: cur.save.combat.seq, transcript: "" };
  }
  assert(next, "no follow-up encounter after fleeing");
  assert(cur.save.scene === sceneOfFights, `same-scene check broken: ${sceneOfFights} -> ${cur.save.scene}`);
  next.transcript = await playTurns(4);
  fights.push(next);
  if (cur.save.combat) await fleeOut();
  // 连续两场不同即通过，不必采满三场。
  const prev = fights[fights.length - 2];
  if (
    prev.id !== next.id || prev.max_hp !== next.max_hp || prev.transcript !== next.transcript
  ) {
    break;
  }
}
for (let i = 1; i < fights.length; i++) {
  assert(fights[i].seq !== fights[i - 1].seq, `consecutive fights share encounter seq ${fights[i - 1].seq}`);
}
{
  const identical = fights.every(
    (f) => f.id === fights[0].id && f.max_hp === fights[0].max_hp && f.transcript === fights[0].transcript
  );
  assert(
    !identical,
    `all sampled fights identical in the same scene: ${JSON.stringify(fights.map((f) => [f.id, f.max_hp, f.transcript]))}`
  );
}

// 3) 交战中「休息」：不得到 HP/MP，播报诚实且不耗回合。
{
  if (!cur.save.combat) {
    for (let i = 0; i < 10 && !cur.save.combat; i++) cur = await doAct("攻击");
  }
  assert(cur.save.combat, "setup: lost combat before rest check");
  const { hp, mp } = cur.save;
  const turnBefore = cur.save.combat.turn;
  const r = await doAct("休息");
  assert(
    r.reply.content.includes("【战斗】") && r.reply.content.includes("无法休息"),
    `combat rest must be explicitly blocked, got: ${r.reply.content.slice(0, 140)}`
  );
  assert(r.save.hp === hp && r.save.mp === mp, `combat rest granted recovery: ${hp}/${mp} -> ${r.save.hp}/${r.save.mp}`);
  assert(
    !r.save.combat || r.save.combat.turn === turnBefore,
    "blocked rest must not consume a combat turn"
  );
}

// 4) 交战中「使用道具」：点名魔力药剂——MP 真回、播报本名、库存减 1；
//    点名未持有的生命圣水——诚实拒绝、回合不动。
{
  if (!cur.save.combat) {
    for (let i = 0; i < 10 && !cur.save.combat; i++) cur = await doAct("攻击");
    assert(cur.save.combat, "setup: no combat for item checks");
  }
  // 先烧一截 MP，保证药剂「真有帮助」。
  if (cur.save.mp >= 12) cur = await doAct("释放技能 猛虎猛击");
  if (!cur.save.combat) {
    for (let i = 0; i < 10 && !cur.save.combat; i++) cur = await doAct("攻击");
  }
  assert(cur.save.combat, "setup: lost combat before potion check");
  const invBefore = (await fetchSaveView(id)).inventory.find((r) => r.item_id === "mana_potion");
  assert(invBefore && invBefore.qty >= 1, "setup: no mana_potion in starter kit");
  const mpBefore = cur.save.mp;
  cur = await doAct("使用道具 魔力药剂");
  const r = cur;
  assert(
    r.reply.content.includes("魔力药剂"),
    `item reply must name 魔力药剂, got: ${r.reply.content.slice(0, 160)}`
  );
  assert(
    !r.reply.content.includes("治疗药水"),
    `reply names a different item: ${r.reply.content.slice(0, 160)}`
  );
  assert(
    r.save.mp === Math.min(cur.save.max_mp, mpBefore + 30),
    `mana potion must restore 30 MP: ${mpBefore} -> ${r.save.mp} (max ${cur.save.max_mp})`
  );
  const invAfter = (await fetchSaveView(id)).inventory.find((r) => r.item_id === "mana_potion");
  assert(
    (invAfter ? invAfter.qty : 0) === invBefore.qty - 1,
    `mana_potion qty ${invBefore.qty} -> ${invAfter ? invAfter.qty : 0}`
  );

  // 未持有物品：诚实拒绝，不占回合、不动数值。
  if (cur.save.combat) {
    const t = cur.save.combat.turn;
    cur = await doAct("使用道具 生命圣水");
    assert(
      cur.reply.content.includes("生命圣水") && /没有|无法/.test(cur.reply.content),
      `unknown item must be refused honestly, got: ${cur.reply.content.slice(0, 140)}`
    );
    if (cur.save.combat) {
      assert(cur.save.combat.turn === t, `refused item consumed a turn: ${t} -> ${cur.save.combat.turn}`);
    }
  }
}

// 5) 打完这场：回合递增、敌 HP 单调、击杀入账（原口径保留）。
{
  if (!cur.save.combat) {
    for (let i = 0; i < 10 && !cur.save.combat; i++) cur = await doAct("攻击");
    assert(cur.save.combat, "setup: no combat for kill check");
  }
  const killsBefore = cur.save.kills;
  const xpBefore = cur.save.xp;
  let prevTurn = cur.save.combat.turn;
  let prevEnemyHp = cur.save.combat.enemy.hp;
  let prevPlayerHp = cur.save.hp;
  let enemyDropped = false;
  let playerHurt = false;
  let killReply = null;
  let turns = 0;
  let defends = 0;
  let noPotions = false;
  for (let i = 0; i < 60; i++) {
    const inCombat = Boolean(cur.save.combat);
    const wantItem = inCombat && !noPotions && cur.save.hp > 0 && cur.save.hp < Math.max(35, cur.save.max_hp * 0.3);
    // 玩家练强后可能首刀秒杀：先至多「防御」三回合——必结算一回合且
    // 敌人必反击（防御不杀伤敌人），把「回合递增/受击」两条断言钉实。
    const wantDefend = inCombat && !wantItem && !playerHurt && defends < 3;
    cur = await doAct(wantItem ? "使用道具" : wantDefend ? "防御" : "攻击");
    if (wantItem && /没有可用|派不上用场/.test(cur.reply.content)) {
      noPotions = true;
      continue; // 拒用不耗回合，下一轮再攻击，回合数断言不串位
    }
    if (wantDefend) defends++;
    if (!cur.save.combat) {
      killReply = cur.reply.content;
      if (/击败/.test(killReply)) enemyDropped = true; // 击杀本身即敌 HP 被打穿的证据
      break;
    }
    turns++;
    assert(cur.save.combat.turn === prevTurn + 1, `turn counter ${prevTurn} -> ${cur.save.combat.turn}`);
    assert(cur.save.combat.enemy.hp <= prevEnemyHp, `enemy hp went UP ${prevEnemyHp} -> ${cur.save.combat.enemy.hp}`);
    if (cur.save.combat.enemy.hp < prevEnemyHp) enemyDropped = true;
    if (cur.save.hp < prevPlayerHp) playerHurt = true;
    assert(cur.save.hp > 0, "player died mid-fight — combat should have converged to death branch");
    prevTurn = cur.save.combat.turn;
    prevEnemyHp = cur.save.combat.enemy.hp;
    prevPlayerHp = cur.save.hp;
  }
  assert(killReply !== null, "combat never converged within 60 attack turns");
  assert(turns >= 1, "combat ended with zero resolved turns");
  assert(enemyDropped, "enemy hp never actually decreased");
  assert(playerHurt, "player never took real damage from enemy counterattack");
  assert(cur.save.kills === killsBefore + 1, `kills ${killsBefore} -> ${cur.save.kills}`);
  assert(cur.save.xp > xpBefore, `xp ${xpBefore} -> ${cur.save.xp} (no kill xp)`);
  assert(/击败 .+，获得 XP \+\d+ · 金币 \+\d+/.test(killReply), `missing kill broadcast: ${killReply.slice(-160)}`);
}

// 6) 击杀冷却：原地连点「攻击」不得再开战、不得再计 kill。
{
  const { body } = await get(`/saves/${id}`);
  assert(body.save.combat === null, "stale active combat after kill");
  const killsAfter = body.save.kills;
  for (let i = 0; i < 6; i++) {
    cur = await doAct("攻击");
    assert(cur.save.combat === null, `attack #${i} spawned an encounter during kill cooldown`);
    assert(cur.save.kills === killsAfter, `cooldown attack granted a kill: ${killsAfter} -> ${cur.save.kills}`);
  }
}

// ── B) boss 门控：不杀守关 boss 到链尾不发主线奖励 ────────────────
{
  const sid = await makeSave("boss-gate-flee");
  let cur2 = null;
  // 小怪一律掷逃、boss 也掷逃——一路推进到 ch1 链尾 ch1_surface。
  for (let i = 0; i < 80; i++) {
    cur2 = await advanceOnce(sid, { fight: "none" });
    if (cur2.save.scene === "ch1_surface") break;
  }
  assert(cur2 && cur2.save.scene === "ch1_surface", `never reached ch1 tail, stuck at ${cur2 && cur2.save.scene}`);
  const s2 = (await fetchSaveView(sid)).save;
  const claimed = Array.isArray(s2.rewards) ? s2.rewards : [];
  assert(
    !claimed.includes("ch1"),
    `main reward granted without boss kill: rewards=${JSON.stringify(claimed)}`
  );
  assert(
    cur2.reply.content.includes("守关者") || cur2.reply.content.includes("未结算"),
    `tail landing missing boss-gate hint: ${cur2.reply.content.slice(-160)}`
  );
}

// ── C) boss 门控正向：击杀守关 boss 后落链尾 → 主线奖励入账 ──────
{
  const sid = await makeSave("boss-gate-kill");
  let cur3 = null;
  let rewarded = false;
  for (let i = 0; i < 120 && !rewarded; i++) {
    cur3 = await advanceOnce(sid, { fight: "all", restAt: 0.5 });
    const s3 = cur3.save;
    if (s3.scene === "ch1_surface" && /第1章主线达成/.test(cur3.reply.content)) rewarded = true;
  }
  assert(rewarded, `boss killed path never granted ch1 main reward (stuck at ${cur3 && cur3.save.scene})`);
  const claimed = Array.isArray(cur3.save.rewards) ? cur3.save.rewards : [];
  assert(claimed.includes("ch1"), `rewards missing ch1 after boss kill + tail landing: ${JSON.stringify(claimed)}`);
}

ok("OK");
