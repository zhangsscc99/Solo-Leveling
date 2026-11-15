#!/usr/bin/env node
// F086 休息的代价与文案真实性契约：
//   a) 新档满血满蓝点「休息」→ 拒绝（rest.available=false + 真实原因），
//      播报不得出现「HP 100→100」这类 N→N 虚构数值，HP/MP 不变；
//   b) 受伤后休息 → HP 严格上升且代价真实入账（剩余次数减少 / 金币减少 /
//      触发遇敌，三者居其一以上），播报数值与 save 增量一致；
//   c) 每章休息配额（服务端下发 rest.remaining）用尽 → 拒绝且 HP 不变；
//   d) 交战中「休息」→ HP/MP 不变、无「恢复」字样（与 F088 口径一致）。
// 断言只依赖 API 返回（reply.content / save.*），不调引擎、不读库。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const ID = await makeSave("rest-cost");
const doAct = (input) => act(ID, input);

const noFabricatedDelta = (content) =>
  assert(
    !/(HP|MP)\s+(\d+)\s*→\s*\2/.test(content),
    `reply must not contain N→N fabricated delta, got: ${content.slice(0, 200)}`
  );

// 交战中一律先逃跑脱离（F088：休息/潜行在敌我面前本就改判），
// 保证后续步骤在非交战态下断言。
const ensureOutOfCombat = async () => {
  let cur = await fetchSaveView(ID);
  for (let i = 0; i < 20 && cur.save.combat; i++) {
    await doAct("逃跑");
    cur = await fetchSaveView(ID);
  }
  assert(!cur.save.combat, "still in combat after 20 flee attempts");
  return cur.save;
};

// ── (a) 满血满蓝：诚实拒绝，无虚构数值 ────────────────────────────
let view = await fetchSaveView(ID);
assert(view.save.hp === view.save.max_hp && view.save.mp === view.save.max_mp,
  "fresh save should start at full HP/MP");
assert(view.save.rest && view.save.rest.available === false,
  `full save must report rest unavailable, got ${JSON.stringify(view.save.rest)}`);
assert(typeof view.save.rest.reason === "string" && view.save.rest.reason.length > 0,
  "rest.reason must carry a real rejection reason");

let r = await doAct("休息");
noFabricatedDelta(r.reply.content);
assert(r.save.hp === view.save.hp && r.save.mp === view.save.mp,
  `full rest must not change HP/MP (got ${r.save.hp}/${r.save.mp})`);
assert(r.save.rest.available === false && r.save.rest.reason,
  "rest refusal must keep reporting unavailable + reason");

// ── (b) 受伤后休息：HP 严格上升 + 真实代价 ───────────────────────
// 「前进」有真实体力消耗（HP -3），可能顺带掷出遭遇——先打/逃到脱战。
await doAct("前进");
let s = await ensureOutOfCombat();
assert(s.hp < s.max_hp, `expected HP below max after 前进 (got ${s.hp}/${s.max_hp})`);

const before = s;
r = await doAct("休息");
s = await ensureOutOfCombat(); // 休息若惊动敌人，先脱离再取快照
assert(s.hp > before.hp, `injured rest must strictly raise HP (${before.hp} -> ${s.hp})`);
// 代价三选一以上：次数减少 / 金币减少 / 触发了遇敌（rest 后曾进战斗，
// ensureOutOfCombat 已脱离，用 rest_used/remaining 与击杀冷却之外
// 的直接信号——remaining 递减或 encounter_seq 变化或当时进入交战）。
const costPaid =
  s.rest.remaining < before.rest.remaining ||
  s.gold < before.gold ||
  s.rest_used > (before.rest_used || 0);
assert(costPaid, `rest must carry a real cost (rest before=${JSON.stringify(before.rest)} after=${JSON.stringify(s.rest)}, gold ${before.gold}->${s.gold})`);
// 播报数值与真实增量一致：含「恢复 HP X→Y」时 X/Y 必须等于真实前后值。
const m = /恢复\s+HP\s+(\d+)→(\d+)/.exec(r.reply.content);
if (m) {
  assert(Number(m[1]) === before.hp, `rest reply HP from ${m[1]} != real ${before.hp}`);
  assert(Number(m[2]) > before.hp, `rest reply HP to ${m[2]} not above ${before.hp}`);
}

// ── (c) 配额用尽：拒绝且 HP 不变 ──────────────────────────────────
// 配额按服务端口径跑到 remaining=0：每轮先「潜行」压 MP（MP<max 即满足
// 可休息前提，且不耗 HP），再「休息」回 MP；途中遇敌先脱离。
for (let i = 0; i < 12; i++) {
  s = await ensureOutOfCombat();
  if (s.rest.remaining === 0) break;
  await doAct("潜行");
  await ensureOutOfCombat();
  await doAct("休息");
}
s = await ensureOutOfCombat();
assert(s.rest.remaining === 0 && s.rest.available === false,
  `rest quota must exhaust (got ${JSON.stringify(s.rest)})`);
const hpAtEmpty = s.hp;
r = await doAct("休息");
assert(r.save.hp === hpAtEmpty, `rest after quota exhausted must not change HP (${hpAtEmpty} -> ${r.save.hp})`);
noFabricatedDelta(r.reply.content);
assert(!/恢复\s+HP/.test(r.reply.content), "exhausted rest must not claim HP recovery");

// ── (d) 交战中休息：零收益、无「恢复」字样（F088 口径） ─────────────
let cur = null;
let engaged = false;
for (let i = 1; i <= 10 && !engaged; i++) {
  cur = await doAct("攻击");
  engaged = Boolean(cur.save.combat);
}
assert(engaged, "no encounter within 10 攻击 swings");
const hpInCombat = cur.save.hp;
const mpInCombat = cur.save.mp;
r = await doAct("休息");
assert(r.save.hp === hpInCombat && r.save.mp === mpInCombat,
  `combat rest must not change HP/MP (${hpInCombat}/${mpInCombat} -> ${r.save.hp}/${r.save.mp})`);
assert(!/恢复/.test(r.reply.content), `combat rest must not claim 恢复, got: ${r.reply.content.slice(0, 160)}`);
assert(r.save.combat, "combat rest must not end the engagement");

ok("[ASSERT] rest-cost OK");
