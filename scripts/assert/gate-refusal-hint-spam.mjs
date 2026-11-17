#!/usr/bin/env node
// F183 验收断言：守关者逼退时「状态提示」分级，不再整块复读。
//
//   现状缺陷：守关房内连点「前进」被拒时，每次都在 BOSS_GATE_LINES
//   主句后追加完整 guardianWarning 块（HP 百分比 + 守关者 HP + 「估算
//   每回合能对你造成约 X–Y 点伤害」+ 三条恢复路径），第 2 次起玩家
//   只是在找怎么跳过。
//
//   断言：
//     a) 新档推进到 ch1 守关房「被拒状态」（守关者未击杀、人在房内、
//        无交战——前进到遭遇后掷逃成功、再前进回到守关房但未落地开战）；
//     b) 连发 5 次「前进」：第 1 次正文含「估算」与「攻击」（完整块），
//        第 2–5 次均不含「估算」/「每回合」/「本章还可休息」（长句与
//        恢复清单不再复读）、均含「叫阵」、均含「第 N 次」且 N 递增，
//        五次正文两两不同；
//     c) 重置生效：房内「攻击」真打一场→掷逃离房→再前进回守关房→
//        再前进被拒，正文重新含「估算」（同一次逗留口径，离房/交战
//        后计数清零）。
//
//   旧码红证：b) 第 2 次起正文仍含「每回合」（两个预警变体都带该词），
//   本断言 FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const CH1_BOSS = ch1.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS, "oracle broken: ch1 boss scene missing");

const HEAL_ITEM_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);

const name = `f183-${Date.now().toString(36)}`;
const { status, body } = await post("/saves", { player_name: name });
assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
const id = body.save.id;
console.log(`[setup] 建档 ${name} → save_id=${id}`);

// 新手装备先穿上（与 _http.advanceTraverse 同口径）：降低驱动被沿途
// 小怪/守关者打死的概率，让断言稳定跑完。
for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
  await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
}

const locTag = (s) =>
  `scene=${s.scene} ch=${s.chapter} mode=${s.advance_mode} hp=${s.hp}/${s.max_hp} ` +
  `combat=${s.combat ? `${s.combat.enemy.name} ${s.combat.enemy.hp}/${s.combat.enemy.max_hp}` : "无"}`;

let deaths0 = Math.max(0, Math.trunc(Number((await fetchSaveView(id)).save.deaths) || 0));
const checkAlive = async (stage) => {
  const s = (await fetchSaveView(id)).save;
  assert(
    Math.trunc(Number(s.deaths) || 0) === deaths0,
    `${stage} 玩家阵亡回溯（deaths ${deaths0}→${s.deaths}）——驱动无法继续：${locTag(s)}`
  );
  return s;
};

// 回血决策：交战外用「休息」配额，交战内/配额尽用背包药水。
async function maybeHeal(s, inventory) {
  const lowHp = s.hp > 0 && s.hp <= Math.max(25, s.max_hp * 0.35);
  if (!lowHp) return false;
  const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_ITEM_IDS.has(r.item_id));
  if (!s.combat && s.rest && s.rest.available === true) {
    await act(id, "休息");
    return true;
  }
  if (heal) {
    const r = await post(`/saves/${id}/item`, { item_id: heal.item_id, op: "use" });
    if (r.status === 200) return true;
  }
  return false;
}

// a) 推进到「被拒状态」：人站 ch1 守关房、守关者未击杀、无交战
//    （advance_mode === "challenge_boss"）。途中撞上小怪/守关战时
//    「前进」= 掷逃（与「逃跑」同一判定），成功即脱战，不计入推进。
let s = await checkAlive("[a] init");
let sends = 0;
while (!(s.scene === CH1_BOSS.id && !s.combat && s.advance_mode === "challenge_boss")) {
  const { inventory } = await fetchSaveView(id);
  if (s.combat) {
    if (!(await maybeHeal(s, inventory))) await act(id, "前进");
  } else {
    if (!(await maybeHeal(s, inventory))) await act(id, "前进");
  }
  sends++;
  assert(sends < 60, `[a] 推进驱动空转 ${sends} 次仍未到守关房：${locTag(s)}`);
  s = await checkAlive("[a]");
}
console.log(`[a] 已到守关房门前（未开战）：${locTag(s)} · sends=${sends}`);

// b) 连发 5 次「前进」：第 1 次完整提示，第 2–5 次一行行动指引。
const replies = [];
for (let i = 0; i < 5; i++) {
  const r = await act(id, "前进");
  assert(
    r.refused === true,
    `(b) push#${i + 1} must be refused, got ${JSON.stringify(r.refused)} :: ${r.reply.content.slice(-160)}`
  );
  const c = r.reply.content;
  replies.push(c);
  console.log(`(b) push#${i + 1} 正文前120字: ${c.slice(0, 120)}`);
  if (i === 0) {
    assert(c.includes("估算"), `(b) push#1 应含完整提示（「估算」缺位）: ${c.slice(-200)}`);
    assert(c.includes("攻击"), `(b) push#1 应含可执行动词「攻击」: ${c.slice(-200)}`);
  } else {
    // 旧码红证：完整预警块的两个变体分别带「估算每回合…」与
    // 「本章还可休息/已用尽」清单——短指引三个指纹都不该出现。
    assert(
      !c.includes("估算"),
      `(b) push#${i + 1} 不应再含承伤估算长句: ${c.slice(-200)}`
    );
    assert(
      !c.includes("本章还可休息") && !c.includes("本章休息已用尽"),
      `(b) push#${i + 1} 不应再含恢复清单复读: ${c.slice(-200)}`
    );
    assert(
      c.includes("叫阵"),
      `(b) push#${i + 1} 短指引必须点名可输入动词「叫阵」: ${c.slice(-200)}`
    );
    assert(
      c.includes("攻击"),
      `(b) push#${i + 1} 短指引必须点名可输入动词「攻击」: ${c.slice(-200)}`
    );
    assert(
      c.includes(`第 ${i + 1} 次`),
      `(b) push#${i + 1} 应带递增计数「第 ${i + 1} 次」: ${c.slice(-200)}`
    );
  }
}
assert(
  new Set(replies).size === 5,
  `(b) 5 次拒绝正文两两不同（实得 ${new Set(replies).size} 种）`
);
console.log(`    (b) 首屏完整提示 + 4 次一行指引，文案两两不同`);

// c) 重置生效：房内「攻击」真打一场 → 掷逃离房 → 再前进回守关房 →
//    再前进被拒，正文重新含「估算」。
{
  const r = await act(id, "攻击");
  assert(
    r.save.combat && r.save.combat.enemy && r.save.combat.enemy.boss === true,
    `(c) 房内叫阵必须真开守关战: ${JSON.stringify(r.save.combat)}`
  );
  // 掷逃离房（boss 战逃跑成功 = 撤回上一主线场景 = 真实换场景）。
  let out = null;
  for (let i = 0; i < 40 && !out; i++) {
    const { save: cs, inventory } = await fetchSaveView(id);
    if (!cs.combat) {
      out = cs;
      break;
    }
    if (!(await maybeHeal(cs, inventory))) await act(id, "前进");
    await checkAlive("[c] flee");
  }
  assert(out, `(c) 40 次掷逃仍未脱离守关战`);
  assert(
    out.scene !== CH1_BOSS.id,
    `(c) 撤离应退回守关房之外，got scene=${out.scene}`
  );
  // 再走回守关房（再入冷却期内落地不开战——F095 逃生阀）。
  for (let i = 0; i < 10; i++) {
    const { save: cs, inventory } = await fetchSaveView(id);
    if (cs.scene === CH1_BOSS.id && !cs.combat) break;
    if (cs.combat) {
      if (!(await maybeHeal(cs, inventory))) await act(id, "前进");
    } else {
      await act(id, "前进");
    }
    await checkAlive("[c] return");
  }
  s = (await fetchSaveView(id)).save;
  assert(
    s.scene === CH1_BOSS.id && !s.combat,
    `(c) 应已回到守关房且无交战: ${locTag(s)}`
  );
  const r2 = await act(id, "前进");
  assert(r2.refused === true, `(c) 重置后再拒必须 refused: ${JSON.stringify(r2.refused)}`);
  console.log(`(c) 重置后 push 正文前120字: ${r2.reply.content.slice(0, 120)}`);
  assert(
    r2.reply.content.includes("估算"),
    `(c) 换场景+交战后再被拒应恢复完整提示（「估算」缺位）: ${r2.reply.content.slice(-200)}`
  );
  console.log(`    (c) 真打一场→离房→回门前：完整提示重新出现（计数清零）`);
}

ok("OK");
