#!/usr/bin/env node
// F134 验收：死亡回溯必须返还本章休息配额（rest_used 归零，与跨章重置
// 同一语义）。旧口径回溯不清配额——惩罚副本里 3 次休息烧完后再死一次
// 落回入口仍是 0/3，血回不上、怪照刷，永久死局。
//   A) 配额返还：DB 构造 rest_used=3、hp=1 的存档 → 真实「前进」力竭
//      触发回溯 → 视图 rest.remaining===3 且 available===true、DB
//      rest_used===0、deaths +1（回溯本身未被破坏）；
//   B) 幂等不叠加：同一存档再死一次，remaining 仍是 3（不会累加成 4/6）；
//   C) 死局出口：从回溯落点按真实路径连跑最多 40 步（休息 → 环顾四周/
//      潜行/探索前进 轮换，交战中真打），断言 XP 至少增长过一次；若未
//      增长，放宽为「指纹至少变过一次」（有真实遭遇或休息通过），但
//      连续 12 步指纹完全不变 / 40 步全程不变一律 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 与服务端 chapterPath 同口径推导 ch1 主线链（同 death-progress-keep）。
const ch1 = raw.chapters.find((c) => c.index === 1);
const byId = new Map(ch1.scenes.map((s) => [s.id, s]));
const PATH = [];
{
  const seen = new Set();
  let cur = ch1.scenes[0];
  while (cur && !seen.has(cur.id)) {
    PATH.push(cur.id);
    seen.add(cur.id);
    let nxt =
      cur.next_scene && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => c.next && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
}

function dbRow(id) {
  return db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
}

// 指纹口径与 _http.mjs saveSig 同思路：scene/chapter/hp/mp/level/rest_used/
// encounter_cd/combat.seq 拼接——连续不变 = 驱动在空转、出口断供。
function sig(s) {
  const c = (s && s.combat) || {};
  return [
    s.scene, s.chapter, s.hp, s.mp, s.level, s.rest_used,
    s.encounter_cd, c.seq, c.turn,
  ].join("|");
}

// ── A) 配额返还：rest_used=3 的死档回溯后回到 3/3 ─────────────────────
// 站位 PATH[5]、hp=1：一推力竭。deaths=1 规避首死觉醒/保底 XP 干扰。
const idA = await makeSave("f134-refund");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, hp = 1, xp = 0, deaths = 1, rest_used = 3 WHERE id = ?"
).run(PATH[5], idA);

const preA = await fetchSaveView(idA);
assert(
  preA.save.rest && preA.save.rest.remaining === 0 && preA.save.rest.available === false,
  `A pre-death: expected rest 0/3 unavailable, got ${JSON.stringify(preA.save.rest)}`
);
const deathsBeforeA = preA.save.deaths;

const dieA = await act(idA, "前进");
const repA = dieA.reply.content;
assert(repA.includes("倒下"), `A: missing 倒下 broadcast: ${repA.slice(-300)}`);
assert(repA.includes("回溯"), `A: missing 回溯 broadcast: ${repA.slice(-300)}`);
assert(
  dieA.save.deaths === deathsBeforeA + 1,
  `A: deaths should be ${deathsBeforeA + 1}, got ${dieA.save.deaths}`
);
assert(
  dieA.save.rest && dieA.save.rest.remaining === 3 && dieA.save.rest.available === true,
  `A: rest should be refunded to 3/3 available, got ${JSON.stringify(dieA.save.rest)}`
);
const rowA = dbRow(idA);
assert(rowA.rest_used === 0, `A: DB rest_used should be 0, got ${rowA.rest_used}`);

// ── B) 幂等：再死一次仍回 3/3，不累加 ────────────────────────────────
// 回溯落点是链首（章首零消耗推不死人），重新锚回 PATH[1] + hp=1 再力竭；
// rest_used 先烧回 3，模拟「配额又用完」的最坏面。
db.prepare(
  "UPDATE saves SET hp = 1, scene = ?, rest_used = 3 WHERE id = ?"
).run(PATH[1], idA);
const deathsBeforeB = (await fetchSaveView(idA)).save.deaths;
const dieB = await act(idA, "前进");
assert(
  dieB.save.deaths === deathsBeforeB + 1,
  `B: deaths should be ${deathsBeforeB + 1}, got ${dieB.save.deaths}`
);
assert(
  dieB.save.rest && dieB.save.rest.remaining === 3 && dieB.save.rest.available === true,
  `B: second death should still refund to 3/3 (idempotent), got ${JSON.stringify(dieB.save.rest)}`
);
const rowB = dbRow(idA);
assert(rowB.rest_used === 0, `B: DB rest_used should be 0, got ${rowB.rest_used}`);

// ── C) 死局出口：回溯落点起 40 步真实路径，不得断供 ───────────────────
// 动作轮换：休息（有配额/有收益才点）→ 环顾四周 → 潜行 → 探索前进；
// 交战中真打（杀出 XP，被打死则再次回溯——配额再次返还，循环仍可数）。
const ROTATE = ["环顾四周", "潜行", "探索前进"];
const startView = await fetchSaveView(idA);
let xp0 = Number(startView.save.xp) || 0;
let xpGrew = false;
let prevSig = null;
let stale = 0;
let sigChanged = false;
let steps = 0;
for (let i = 0; i < 40; i++) {
  const { save: s } = await fetchSaveView(idA);
  const cur = sig(s);
  if (prevSig !== null && cur !== prevSig) sigChanged = true;
  stale = cur === prevSig ? stale + 1 : 0;
  prevSig = cur;
  assert(
    stale < 12,
    `C: save fingerprint unchanged across ${stale + 1} consecutive actions ` +
      `(scene=${s.scene} hp=${s.hp}/${s.max_hp} rest=${JSON.stringify(s.rest)}) — dead-end stall`
  );
  if ((Number(s.xp) || 0) > xp0) xpGrew = true;
  let input;
  if (s.combat) {
    const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
    input = castable ? `释放技能 ${castable.name}` : "攻击";
  } else if (
    s.rest && s.rest.available === true &&
    (s.hp < s.max_hp || s.mp < s.max_mp)
  ) {
    input = "休息";
  } else {
    input = ROTATE[steps % ROTATE.length];
  }
  await act(idA, input);
  steps++;
}
const endView = await fetchSaveView(idA);
const xpEnd = Number(endView.save.xp) || 0;
if (xpEnd > xp0) xpGrew = true;
// 主口径：XP 至少增长过一次。放宽口径（配额恢复后至少有一次真实遭遇
// 或休息通过）：40 步内指纹必须变过；全程不变 = 出口断供，FAIL。
assert(
  xpGrew || sigChanged,
  `C: 40 steps after rewind — no XP growth (${xp0} -> ${xpEnd}) and fingerprint ` +
    `never changed; rest refund did not reopen the dead end`
);

db.prepare("DELETE FROM saves WHERE id = ?").run(idA);
ok("F134 PASS death rewind refunds rest quota (A refund / B idempotent / C dead-end exit)");
