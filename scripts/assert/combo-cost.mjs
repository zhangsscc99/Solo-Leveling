#!/usr/bin/env node
// P205 战斗「连击 ×3」真实代价断言（纯 API + DB 锻造，与
// combat-multi-round 同取径）：锻造一场必然打不完的 3 回合长战——
// 双方互磨个位数伤害、敌血池 5000，不存在提前结束。
//
//   a) 代价：交战态点一次「连击」→ MP 恰好 −6（整次固定代价，不是每
//      回合），首条战报带「【连击】…MP a→b」入账行；随后点一次「攻击」
//      → MP 不再变动（单键攻击零消耗口径不动）；
//   b) RNG 等价：回滚存档/交战行到同一起点（同 seq）后连点三次「攻
//      击」，逐回合正文行与 HP/MP 箭头行必须与连击战报逐项相等；终态
//      hp/敌 hp/turn 相等、mp 恰少 6——代价在回合循环外落账，不挤占
//      回合种子；
//   c) 门禁：MP 压到 5（<6）时「连击」refused——正文含明确理由与当前
//      MP、可行动作指引；MP 不变、敌 HP 不变、回合不推进、不静默降级
//      为单次攻击；
//   d) 旧码必红：旧版连击零消耗 → (a) 的「MP 恰好 −6」首条即 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, get, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const encounter = require(path.join(ROOT, "server", "engine", "encounter.js"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const TURN_RE = /【战斗】第(\d+)回合/;
const COMBO_COST = 6;
const MP_FULL = 40;

const id = await makeSave("combo-cost");

// ── 锻造：玩家低攻高血高蓝、敌低攻巨血池——每回合互磨几点，谁也打不死谁 ──
const db = new Database(dbPath);
db.prepare(
  "UPDATE saves SET level = 30, hp = 5000, max_hp = 5000, mp = ?, max_mp = ?, " +
    "stats_json = ?, boss_cleared_json = '[]', encounter_clock = 0, encounter_cd = 0 WHERE id = ?"
).run(
  MP_FULL,
  MP_FULL,
  JSON.stringify({ strength: 5, agility: 0, vitality: 50, intelligence: 0, perception: 0 }),
  id
);

// 起点快照：连击跑完后回滚到同一状态再跑三连点——同 save.id + 同 seq +
// 同回合号 → 回合种子逐位相同。
const saveSnap = db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
const saveCols = Object.keys(saveSnap).filter((k) => k !== "id");
const restore = db.prepare(
  `UPDATE saves SET ${saveCols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`
);
function forgeCombat(seq) {
  const enemy = encounter.spawn(1, "assert-p205-stone");
  enemy.name = "P205木桩守卫";
  enemy.kind = "stone";
  enemy.seq = seq;
  enemy.hp = enemy.maxHp = 5000;
  enemy.stats = { strength: 4, agility: 0, vitality: 6, intelligence: 4, perception: 5 };
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  db.prepare("INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1)").run(
    id,
    JSON.stringify(enemy)
  );
}
const restoreSave = () => restore.run(...saveCols.map((c) => saveSnap[c]), id);
const setMp = (mp) => db.prepare("UPDATE saves SET mp = ? WHERE id = ?").run(mp, id);

// 从日志尾摘逐回合战报：返回 [{ id, turn, content, turnLine, vitalsLine }]
async function turnReports() {
  const { status, body } = await get(`/saves/${id}/log?limit=40`);
  assert(status === 200 && body && Array.isArray(body.log), "fetch log failed");
  return body.log
    .filter((e) => e.role !== "user" && TURN_RE.test(e.content || ""))
    .slice(-3)
    .map((e) => {
      const m = (e.content || "").match(TURN_RE);
      const turnLine = (e.content || "").split("\n").find((l) => TURN_RE.test(l)) || "";
      const vitalsLine =
        (e.content || "")
          .split("\n")
          .find((l) => /^【战斗】/.test(l) && /(?:HP|MP)\s*\d+\s*→/.test(l) && !TURN_RE.test(l)) ||
        "";
      return { id: e.id, turn: Number(m[1]), content: e.content, turnLine, vitalsLine };
    });
}

const T0 = 1;
let comboTurns = null;
let comboEnd = null;
let comboFirst = null;
let seqUsed = null;

// ── a) 一次「连击」：MP 恰好 −6、三回合战报独立成条、代价入账行可见 ──
for (let attempt = 0; attempt < 20; attempt++) {
  const seq = 31 + attempt;
  restoreSave();
  forgeCombat(seq);
  const s = (await fetchSaveView(id)).save;
  assert(
    s.combat && s.combat.turn === T0 && s.combat.enemy.hp === 5000 && s.mp === MP_FULL,
    `锻造/回滚失败：${JSON.stringify({ turn: s.combat && s.combat.turn, mp: s.mp })}`
  );
  const combo = await act(id, "连击");
  assert(
    combo.save.combat && combo.save.combat.turn === T0 + 3,
    `「连击」后回合数应 +3：turn=${combo.save.combat ? combo.save.combat.turn : "脱战"}（起点 ${T0}）`
  );
  assert(
    combo.save.mp === MP_FULL - COMBO_COST,
    `「连击」整次代价应恰好 -${COMBO_COST} MP：${MP_FULL} → ${combo.save.mp}` +
      `（旧码零消耗为 ${MP_FULL}，每回合扣费也得不到这个值）`
  );
  const turns = await turnReports();
  assert(
    turns.length === 3 && turns.map((t) => t.turn).join(",") === [T0, T0 + 1, T0 + 2].join(","),
    `「连击」应写 3 条独立回合战报（${T0}..${T0 + 2}），实测 ${turns.map((t) => t.turn).join(",")}`
  );
  for (const t of turns) assert(t.turnLine.length > 0, `第${t.turn}回合缺「第N回合」正文行`);
  if (turns.every((t) => t.vitalsLine.length > 0)) {
    comboTurns = turns;
    comboFirst = turns[0];
    comboEnd = {
      hp: combo.save.hp,
      mp: combo.save.mp,
      enemyHp: combo.save.combat.enemy.hp,
      turn: combo.save.combat.turn,
    };
    seqUsed = seq;
    break;
  }
}
assert(comboTurns, "20 次换 seq 仍抽不到三回合全有 HP 行的流");
assert(
  /^【连击】/.test(comboFirst.content) &&
    new RegExp(`MP\\s*${MP_FULL}→${MP_FULL - COMBO_COST}`).test(comboFirst.content.split("\n")[0]),
  `首条战报缺连击代价入账行「【连击】…MP ${MP_FULL}→${MP_FULL - COMBO_COST}」：${comboFirst.content.split("\n")[0]}`
);

// ── a') 随后一次「攻击」：MP 不再变动（单键攻击零消耗口径不动）────────
{
  const before = comboEnd;
  const r = await act(id, "攻击");
  assert(
    r.save.mp === before.mp,
    `「攻击」应零消耗：MP ${before.mp} → ${r.save.mp}`
  );
  assert(
    r.save.combat && r.save.combat.turn === before.turn + 1,
    `「攻击」应正常推进一回合：turn ${before.turn} → ${r.save.combat ? r.save.combat.turn : "脱战"}`
  );
}

// ── b) 回滚到同一起点（同 seq），连点三次「攻击」逐项对比 ─────────────
restoreSave();
forgeCombat(seqUsed);

const attackTurns = [];
let last = null;
for (let i = 0; i < 3; i++) {
  last = await act(id, "攻击");
  const content = (last.reply && last.reply.content) || "";
  attackTurns.push({
    turnLine: content.split("\n").find((l) => TURN_RE.test(l)) || "",
    vitalsLine:
      content
        .split("\n")
        .find((l) => /^【战斗】/.test(l) && /(?:HP|MP)\s*\d+\s*→/.test(l) && !TURN_RE.test(l)) || "",
  });
}
const attackEnd = {
  hp: last.save.hp,
  mp: last.save.mp,
  enemyHp: last.save.combat && last.save.combat.enemy ? last.save.combat.enemy.hp : null,
  turn: last.save.combat ? last.save.combat.turn : null,
};

for (let i = 0; i < 3; i++) {
  const c = comboTurns[i];
  const a = attackTurns[i];
  assert(
    c.turnLine === a.turnLine,
    `第${T0 + i}回合正文不一致（伤害/RNG 分叉）：\n  连击「${c.turnLine}」\n  连点「${a.turnLine}」`
  );
  assert(
    c.vitalsLine === a.vitalsLine,
    `第${T0 + i}回合 HP/MP 箭头不一致：\n  连击「${c.vitalsLine}」\n  连点「${a.vitalsLine}」`
  );
}
assert(
  comboEnd.hp === attackEnd.hp && comboEnd.enemyHp === attackEnd.enemyHp &&
    comboEnd.turn === attackEnd.turn && comboEnd.mp === attackEnd.mp - COMBO_COST,
  `终态不一致：连击 ${JSON.stringify(comboEnd)} vs 连点 ${JSON.stringify(attackEnd)}（mp 应恰少 ${COMBO_COST}）`
);

// ── c) MP < 6：「连击」refused、正文理由明确、MP/敌 HP/回合全不变 ──────
restoreSave();
forgeCombat(seqUsed);
setMp(COMBO_COST - 1);
{
  const s0 = (await fetchSaveView(id)).save;
  assert(s0.combat && s0.mp === COMBO_COST - 1, `低蓝锻造失败：mp=${s0.mp}`);
  const enemyHp0 = s0.combat.enemy.hp;
  const turn0 = s0.combat.turn;
  const r = await act(id, "连击");
  const content = (r.reply && r.reply.content) || "";
  assert(r.refused === true, `MP ${COMBO_COST - 1} 时「连击」应 refused，实测未挂拒绝标记`);
  assert(
    /魔力不足/.test(content) && content.includes(String(COMBO_COST)) &&
      content.includes(String(COMBO_COST - 1)),
    `拒绝正文缺明确理由（需要 ${COMBO_COST} MP / 当前 ${COMBO_COST - 1} MP）：${content.slice(0, 140)}`
  );
  assert(
    /攻击/.test(content) && /魔力药剂|药剂/.test(content),
    `拒绝正文缺可行动作指引（单次「攻击」/ 魔力药剂）：${content.slice(0, 140)}`
  );
  assert(r.save.mp === COMBO_COST - 1, `被拒后 MP 不应变动：${r.save.mp}`);
  assert(
    r.save.combat && r.save.combat.enemy.hp === enemyHp0 && r.save.combat.turn === turn0,
    `被拒后战斗态不应推进：${JSON.stringify(r.save.combat)}`
  );
  assert(
    !/第\s*\d+\s*回合/.test(content),
    `拒绝不得静默降级为单次攻击（战报里出现回合结算）：${content.slice(0, 140)}`
  );
}

db.close();
console.log(
  `[ASSERT] combo-cost OK — seq=${seqUsed} 连击 MP ${MP_FULL}→${MP_FULL - COMBO_COST}（整次 -${COMBO_COST}），` +
    `随后「攻击」零消耗；三回合正文与 HP/MP 箭头同三连点逐项相等；` +
    `MP ${COMBO_COST - 1} 时 refused 且战斗态不变`
);
ok("[ASSERT] PASS");
