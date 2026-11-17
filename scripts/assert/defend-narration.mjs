#!/usr/bin/env node
// F110 contract: 防御回合事件流包含玩家侧防御叙述。
//   1. defend 的 events 存在 side:"player" 的防御事件（type "damage"），
//      且排在敌方命中/闪避事件之前；
//   2. 敌人命中时该事件带真实减伤数字：「你只受 N 点，减免 M」，
//      N = 敌方命中事件 value，M = 无防御倍率 raw − N（同一 computeDamage 口径）；
//   3. 敌人未命中时仍有玩家侧防御叙述（不落空）；
//   4. 连续 3 次防御的玩家侧措辞 ≥2 种不同；
//   5. attack 回合不得出现玩家侧防御事件。
// 纯函数直测 combat.resolveTurn（固定 seed），不起服务、不碰存档。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const req = createRequire(path.join(ROOT, "noop.js"));
const combat = req(path.join(ROOT, "server", "engine", "combat.js"));
const S = req(path.join(ROOT, "server", "engine", "stats.js"));

function fail(msg) {
  console.error(`[ASSERT] ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}

const baseState = () => ({
  turn: 1,
  player: {
    hp: 100, maxHp: 100, mp: 30, maxMp: 30,
    stats: { strength: 12, agility: 8, vitality: 6, intelligence: 4, perception: 5 },
  },
  enemy: {
    name: "石像守卫", hp: 60, maxHp: 60,
    stats: { strength: 14, agility: 5, vitality: 10, intelligence: 2, perception: 3 },
  },
});

// 玩家侧防御事件：type "damage" + side "player"（其它动作不产生该组合）。
const defendEv = (r) => r.events.find((e) => e.type === "damage" && e.side === "player");
const enemyStrikeIdx = (r) =>
  r.events.findIndex((e) =>
    (e.side === "enemy" && (e.type === "hit" || e.type === "crit")) ||
    (e.side === "player" && (e.type === "miss" || e.type === "dodge")));

// ── 1+2) 命中分支：防御事件在敌方命中事件之前，且带真实减伤数字 ──
let hitRun = null;
for (let i = 0; i < 200 && !hitRun; i++) {
  const r = combat.resolveTurn(baseState(), "defend", `f110-hit-${i}`);
  const taken = r.events.find((e) => (e.type === "hit" || e.type === "crit") && e.side === "enemy");
  if (taken) hitRun = { r, taken, seed: `f110-hit-${i}` };
}
assert(hitRun, "200 个 seed 内未出现敌人命中防御的回合");

const { r: hr, taken } = hitRun;
const hdef = defendEv(hr);
assert(hdef, "防御命中回合缺少 side:player 防御事件");
assert(hdef.text.trim().length > 0, "防御事件文案为空");
assert(/只受 ?\d+ ?点|只受 \d+ 点/.test(hdef.text) && /减免 ?\d+/.test(hdef.text),
  `防御事件未带「只受/减免」数字: ${hdef.text}`);
const idxDef = hr.events.indexOf(hdef);
const idxStrike = hr.events.indexOf(taken);
assert(idxDef >= 0 && idxDef < idxStrike,
  `防御事件应排在敌方命中事件之前（def@${idxDef} vs hit@${idxStrike}）`);

// 数字真值：只受 = 敌方命中 value；减免 = raw(mult=1, 同 crit) − 实承。
const m = hdef.text.match(/只受 (\d+) 点，减免 (\d+)/);
assert(m, `防御事件数字格式不符: ${hdef.text}`);
assert(Number(m[1]) === taken.value, `「只受 ${m[1]}」≠ 敌方命中 ${taken.value}`);
const raw = combat.computeDamage(hr.state.enemy, S.defenseOf(hr.state.player), {
  crit: taken.type === "crit", defenderRank: hr.state.player.rank,
});
const expectBlocked = Math.max(0, raw - taken.value);
assert(Number(m[2]) === expectBlocked,
  `「减免 ${m[2]}」≠ raw ${raw} − 实承 ${taken.value} = ${expectBlocked}`);

// ── 3) 未命中分支：敌人打空时仍有玩家侧防御叙述 ──
let missRun = null;
for (let i = 0; i < 400 && !missRun; i++) {
  const r = combat.resolveTurn(baseState(), "defend", `f110-miss-${i}`);
  const whiff = r.events.find((e) => (e.type === "miss" || e.type === "dodge") && e.side === "player");
  if (whiff) missRun = r;
}
assert(missRun, "400 个 seed 内未出现敌人未命中的防御回合");
const mdef = defendEv(missRun);
assert(mdef, "敌人未命中的防御回合缺少 side:player 防御事件");
assert(/[\u4e00-\u9fa5]/.test(mdef.text), `未命中防御事件文案应为中文: ${mdef.text}`);
assert(!/只受|减免/.test(mdef.text) || /落空|滑开|偏出/.test(mdef.text),
  `未命中防御事件不该报减伤数字: ${mdef.text}`);
assert(missRun.events.indexOf(mdef) < enemyStrikeIdx(missRun),
  "未命中时防御事件仍应排在敌方结算事件之前");

// ── 4) 措辞轮换：连续 3 次防御 ≥2 种不同 ──
const phrases = [];
for (let i = 0; phrases.length < 3 && i < 60; i++) {
  const r = combat.resolveTurn(baseState(), "defend", `f110-rot-${i}`);
  const ev = defendEv(r);
  if (ev && ev.text) phrases.push(ev.text.split(" · ")[0]);
}
assert(phrases.length === 3, "未能收集到 3 条防御叙述");
assert(new Set(phrases).size >= 2,
  `连续 3 次防御措辞完全相同: ${JSON.stringify(phrases)}`);

// ── 5) attack 回合不得出现玩家侧防御事件 ──
for (let i = 0; i < 30; i++) {
  const r = combat.resolveTurn(baseState(), "attack", `f110-atk-${i}`);
  assert(!defendEv(r), `attack 回合出现玩家侧防御事件（seed f110-atk-${i}）`);
  assert(r.events.every((e) => !(e.side === "player" && /减免|只受/.test(e.text))),
    `attack 回合出现防御叙述文案（seed f110-atk-${i}）`);
}

console.log(
  `[ASSERT] defend-narration OK 命中「${hdef.text}」 未命中「${mdef.text}」 轮换[${[...new Set(phrases)].join("/")}]`
);
