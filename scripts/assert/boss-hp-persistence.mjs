#!/usr/bin/env node
// F182 验收断言：守关者血量跨撤离持久化。
//
//   现状缺陷：守关战两回合把「石像守卫」打到残血后「逃跑」成功，combat
//   行被删；再「前进」回房叫阵，敌人又是满血——之前打出的伤害全部作废。
//
//   断言：
//     a) 新档推进到 ch1 守关房（boss 场景落地必开战 / 房内叫阵开战）；
//     b) 首战守关者满血，「攻击」致伤后 enemy.hp < enemy.max_hp；
//     c)「逃跑」成功后交战态收敛，且残血已落档 boss_hp；
//     d) 再「前进」回房并「攻击」叫阵：新战斗 enemy.hp === 撤离前剩余值
//        （逐点相同）且 !== enemy.max_hp —— 红证核心；
//     e) 继续攻击至击杀：boss_hp 对应 key 已清零，守关者记 boss_cleared。
//
//   旧码红证：d) 步 enemy.hp 回到 75/75（满血），断言 FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const HEAL_ITEM_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);

const name = `f182-${Date.now().toString(36)}`; // ≤20 字，随机后缀防撞名
const { status, body } = await post("/saves", { player_name: name });
assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
const id = body.save.id;
console.log(`[a] 建档 ${name} → save_id=${id}`);

// 新手装备先穿上（与 _http.advanceTraverse 同口径）：不改判定本身，只
// 降低驱动被沿途小怪/守关者打死的概率，让断言稳定跑完。
for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
  await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
}

const bossTag = (s) =>
  s.combat && s.combat.enemy
    ? `${s.combat.enemy.boss ? "守关战" : "遭遇战"} ${s.combat.enemy.name} ${s.combat.enemy.hp}/${s.combat.enemy.max_hp} turn=${s.combat.turn}`
    : "无交战";
const locTag = (s) => `scene=${s.scene} ch=${s.chapter} mode=${s.advance_mode} hp=${s.hp}/${s.max_hp}`;

let s = (await fetchSaveView(id)).save;
let deaths0 = Math.max(0, Math.trunc(Number(s.deaths) || 0));
const checkAlive = (stage) =>
  assert(
    Math.trunc(Number(s.deaths) || 0) === deaths0,
    `${stage} 玩家阵亡回溯（deaths ${deaths0}→${s.deaths}）——驱动无法继续：${locTag(s)}`
  );

// a) 连发「前进」直到进入守关房：判据 = advance_mode === "challenge_boss"
//    或回包已挂守关战（boss 场景落地必开战）。途中撞上小怪时「前进」是
//    掷逃（与「逃跑」同一判定），不计入 8 次推进上限。
let engaged = Boolean(s.combat && s.combat.enemy && s.combat.enemy.boss);
let atDoor = s.advance_mode === "challenge_boss";
let moves = 0;
let sends = 0;
while (!engaged && !atDoor) {
  assert(sends < 40, `推进驱动空转 ${sends} 次仍未到守关房（${locTag(s)} ${bossTag(s)}）`);
  const inMobCombat = Boolean(s.combat);
  const r = await act(id, "前进");
  sends++;
  s = r.save;
  checkAlive("[a]");
  engaged = Boolean(s.combat && s.combat.enemy && s.combat.enemy.boss);
  atDoor =
    !engaged &&
    (s.advance_mode === "challenge_boss" || /守关/.test(r.reply.content || ""));
  if (!inMobCombat) {
    moves++;
    console.log(`[a] 前进#${moves} → ${locTag(s)} · ${bossTag(s)}`);
    assert(moves <= 8, `前进 ${moves} 次（>8）仍未抵达守关房：${locTag(s)}`);
  } else {
    console.log(`[a] 交战中前进=掷逃（不算推进）→ ${bossTag(s)} 你 hp=${s.hp}`);
  }
}

// 人到守关房门口但未开战（再入冷却期内重返）：说「攻击」主动叫阵。
if (!engaged) {
  const r = await act(id, "攻击");
  s = r.save;
  console.log(`[a] 叫阵「攻击」→ ${bossTag(s)}`);
  engaged = Boolean(s.combat && s.combat.enemy && s.combat.enemy.boss);
}
assert(engaged, `未能进入守关战：${locTag(s)} · ${bossTag(s)}`);

// b) 首战守关者必须满血——记下满血值后连发「攻击」致伤（允许连空刀，
//    至多补到 5 次出手内见血）。
let e = s.combat.enemy;
const maxHp = e.max_hp;
assert(e.hp === maxHp, `首战守关者 HP ${e.hp}/${maxHp} 不是满血——疑似残留提前生效`);
console.log(`[b] 守关者「${e.name}」满血 ${e.hp}/${e.max_hp} 开战`);
for (let i = 1; i <= 5 && s.combat && s.combat.enemy.hp === maxHp; i++) {
  const r = await act(id, "攻击");
  s = r.save;
  checkAlive("[b]");
  const tail = s.combat ? `enemy=${s.combat.enemy.hp}/${s.combat.enemy.max_hp} turn=${s.combat.turn}` : "交战已收敛";
  console.log(`[b] 攻击#${i} → 你 hp=${s.hp}/${s.max_hp} · ${tail}`);
}
assert(s.combat && s.combat.enemy, "攻击阶段交战态丢失（非撤离非击杀）");
assert(s.combat.enemy.hp < maxHp, `连打后守关者 HP 仍满血 ${s.combat.enemy.hp}/${maxHp}`);
const firstBlood = s.combat.enemy.hp;
console.log(`[b] 守关者已致伤 HP = ${firstBlood}/${maxHp}（< ${maxHp} ✓）`);

// c) 多策略脱战——不赌固定组合的掷逃结果。逃跑掷点是确定性 PRNG
//    （seed = combat:${save.id}:${enemy.seq}:${cbt.turn}）：同一存档同一
//    场次同一回合的掷点永远相同，纯堆「逃跑」在倒霉的 seed 序列上必红。
//    策略：「逃跑」每被拦下一次就插一次攻击/防御把 cbt.turn 推下去换
//    seed（≤10 个战斗回合）；HP<40 先「使用道具」保命；玩家阵亡回溯
//    同样删交战行算脱战；10 回合未脱身用 DB fixture 直删交战行，等价
//    「玩家脱战」前置。期望残留取脱战前 save.boss_hp 的最后一个值。
let expected = firstBlood;
let bossKey = null;
const trackBossHp = () => {
  const map = s.boss_hp && typeof s.boss_hp === "object" ? s.boss_hp : {};
  const keys = Object.keys(map);
  if (keys.length) {
    bossKey = keys[0];
    expected = Math.max(0, Math.trunc(Number(map[bossKey]) || 0));
  }
};
trackBossHp();
let detachVia = null;
let wantFlee = true;
for (let round = 1; round <= 10 && !detachVia; round++) {
  const deathsBefore = Math.trunc(Number(s.deaths) || 0);
  const { inventory } = await fetchSaveView(id);
  const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
  const low = s.hp > 0 && s.hp < 40;
  // 插入动作只为换 seed：守关者已残到一击线内就换「防御」（同样推
  // turn），别把待验证的残血怪失手打死。
  const enemyHp = s.combat && s.combat.enemy ? s.combat.enemy.hp : 0;
  const interleave = enemyHp > 30 ? "攻击" : "防御";
  const input = low && hasHealer ? "使用道具" : wantFlee ? "逃跑" : interleave;
  const r = await act(id, input);
  s = r.save;
  trackBossHp();
  if (!s.combat) {
    detachVia = Math.trunc(Number(s.deaths) || 0) > deathsBefore ? "death" : "flee";
  } else if (input === "逃跑") {
    wantFlee = false; // 被拦下：插一回合攻击/防御换 turn → 换 seed
  } else if (input === interleave) {
    wantFlee = true;
  }
  console.log(
    `[c] 回合${round}「${input}」→ ${s.combat ? bossTag(s) : "交战已收敛"} · 你 hp=${s.hp}/${s.max_hp} · boss_hp=${JSON.stringify(s.boss_hp)}`
  );
}
if (!detachVia) {
  const Database = require("better-sqlite3");
  const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
  const db = new Database(dbPath);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  db.close();
  s = (await fetchSaveView(id)).save;
  assert(!s.combat, `db-fixture 删交战行后 combat 仍在：${bossTag(s)}`);
  detachVia = "db-fixture";
}
if (detachVia === "death") {
  // 阵亡回溯是合法脱战：deaths 基线同步后照常走 (d) 重返流程。
  console.log(`[c] detach via death（deaths→${s.deaths}，回溯 ${locTag(s)}）`);
  deaths0 = Math.max(0, Math.trunc(Number(s.deaths) || 0));
} else {
  console.log(`[c] detach via ${detachVia} · ${locTag(s)}`);
}
console.log(`[c] 期望残留 boss_hp=${JSON.stringify(s.boss_hp)} → expected=${expected}`);

// d) 回守关房叫阵：db-fixture 人还在房内（advance_mode=challenge_boss）
//    直接「攻击」开怪；撤离撤回上一场景 / 阵亡回溯章首则「前进」走回去
//    （途中小怪交战里「前进」=掷逃，不计入推进数；残血先补给再动）。
let back =
  (s.combat && s.combat.enemy && s.combat.enemy.boss === true) ||
  s.advance_mode === "challenge_boss";
let dSends = 0;
let dMoves = 0;
while (!back) {
  assert(dSends < 30, `重返守关房驱动空转 ${dSends} 次：${locTag(s)} · ${bossTag(s)}`);
  if (!s.combat && s.hp > 0 && s.hp < s.max_hp * 0.4) {
    const { inventory } = await fetchSaveView(id);
    const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
    if (s.rest && s.rest.available === true) {
      const r = await act(id, "休息");
      s = r.save;
      continue;
    }
    if (heal) {
      const { status } = await post(`/saves/${id}/item`, { item_id: heal.item_id, op: "use" });
      if (status === 200) {
        s = (await fetchSaveView(id)).save;
        continue;
      }
    }
  }
  const inMobCombat = Boolean(s.combat);
  const r = await act(id, "前进");
  dSends++;
  s = r.save;
  checkAlive("[d]");
  back =
    (s.combat && s.combat.enemy && s.combat.enemy.boss === true) ||
    s.advance_mode === "challenge_boss" ||
    /守关/.test(r.reply.content || "");
  if (!inMobCombat) {
    dMoves++;
    console.log(`[d] 前进#${dMoves} → ${locTag(s)} · ${bossTag(s)}`);
    assert(dMoves <= 12, `撤离后前进 ${dMoves} 次仍未回守关房：${locTag(s)}`);
  } else {
    console.log(`[d] 交战中前进=掷逃（不算推进）→ ${bossTag(s)} 你 hp=${s.hp}`);
  }
}
if (!(s.combat && s.combat.enemy && s.combat.enemy.boss)) {
  const r = await act(id, "攻击");
  s = r.save;
  checkAlive("[d]");
  console.log(`[d] 房内叫阵「攻击」→ ${bossTag(s)}`);
}
assert(
  s.combat && s.combat.enemy && s.combat.enemy.boss === true,
  `回房叫阵没有开出守关战：${locTag(s)} · ${bossTag(s)}`
);
e = s.combat.enemy;
console.log(`[d] 再叫阵守关者 HP = ${e.hp}/${e.max_hp}（脱战方式=${detachVia} · 期望残留 ${expected}）`);
assert(
  e.hp === expected,
  `守关者血量未跨撤离持久化：detach=${detachVia} 期望残留 ${expected}，再叫阵却是 ${e.hp}/${e.max_hp}（旧码会回满 ${maxHp}）`
);
assert(e.hp !== e.max_hp, `守关者 HP ${e.hp}/${e.max_hp} 回满了——消耗战作废（detach=${detachVia}）`);

// e) 继续攻击至击杀（≤20 回合；残血且包里有治疗药时「使用道具」保命），
//    杀后 boss_hp 对应 key 必须清零，且记 boss_cleared。
let killed = false;
for (let i = 1; i <= 20 && !killed; i++) {
  const low = s.hp > 0 && s.hp <= Math.max(25, s.max_hp * 0.35);
  const { inventory } = await fetchSaveView(id);
  const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
  const input = low && hasHealer ? "使用道具" : "攻击";
  const r = await act(id, input);
  s = r.save;
  checkAlive("[e]");
  killed = !s.combat;
  const tail = s.combat ? `enemy=${s.combat.enemy.hp}/${s.combat.enemy.max_hp}` : "交战收敛";
  console.log(`[e] ${input}#${i} → 你 hp=${s.hp}/${s.max_hp} · ${tail}`);
}
assert(killed, `20 回合内未击杀守关者（${bossTag(s)} 你 hp=${s.hp}）`);
assert(
  !(s.boss_hp && Math.trunc(Number(s.boss_hp[bossKey]) || 0) > 0),
  `击杀后 boss_hp["${bossKey}"] 未清零：${JSON.stringify(s.boss_hp)}`
);
assert(
  Array.isArray(s.boss_cleared) && s.boss_cleared.includes(bossKey),
  `击杀后 boss_cleared 未含 ${bossKey}：${JSON.stringify(s.boss_cleared)}`
);
console.log(
  `[e] 守关者已击杀 · boss_hp=${JSON.stringify(s.boss_hp)} · boss_cleared=${JSON.stringify(s.boss_cleared)}`
);

ok("boss-hp-persistence OK");
