#!/usr/bin/env node
// F200 战斗「连击 ×3」e2e（纯 API + DB 锻造，与 combat-round-variety 同取径）：
//   锻造一场必然打不完的 3 回合长战——双方互磨个位数伤害、敌血池 5000，
//   不存在提前结束。
//
//   a) 一次「连击」= 连续结算至多 3 个回合：交战行 turn +3（本构造必然
//      +3；提前结束是另一条合法路径，不在本构造覆盖内），日志逐回合各
//      写一条独立战报——每条独立日志行里都有「第N回合 · …」正文行与
//      「【战斗】X HP a→b · 你 HP c→d」箭头行；
//   b) RNG 等价：把存档/交战行回滚到同一起点后连点三次「攻击」，逐回合
//      正文行、HP/MP 箭头行、以及终态 hp/敌 hp/turn 必须与连击结果逐项
//      相等；终态 mp 恰少 6（P205 连击整次固定代价，回合种子 =
//      存档 + 开战盐 + 回合号，同档同起点两次驱动理当逐位一致）；
//   c) 旧码必红：词表里没有「连击」→ 落 unknown、回合不推进 → (a) FAIL。
//
//   命中率封顶 0.98：双方同回合同时打空（≈0.04%/回合）的战报合法地没有
//   HP 箭头行——与单次「攻击」同一行为。为让 (a) 的「每回合都有 HP 行」
//   断言可判定，按 enemy.seq（开战盐，种子成分）轮换重锻，直到抽到一支
//   三回合全有数值变化的流；等价性对比固定用同一支流。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, get, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const encounter = require(path.join(ROOT, "server", "engine", "encounter.js"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const TURN_RE = /【战斗】第(\d+)回合/;

const id = await makeSave("multi-round");

// ── 锻造：玩家低攻高血、敌低攻巨血池——每回合双方互磨几点，谁也打不死谁 ──
const db = new Database(dbPath);
db.prepare(
  "UPDATE saves SET level = 30, hp = 5000, max_hp = 5000, mp = 40, max_mp = 40, " +
    "stats_json = ?, boss_cleared_json = '[]', encounter_clock = 0, encounter_cd = 0 WHERE id = ?"
).run(
  JSON.stringify({ strength: 5, agility: 0, vitality: 50, intelligence: 0, perception: 0 }),
  id
);

// 起点快照：连击跑完后回滚到同一状态再跑三连点——同 save.id + 同 seq +
// 同回合号 → 回合种子逐位相同，任何 RNG 流分叉都会在下面对比里现形。
const saveSnap = db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
const saveCols = Object.keys(saveSnap).filter((k) => k !== "id");
const restore = db.prepare(
  `UPDATE saves SET ${saveCols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`
);
function forgeCombat(seq) {
  const enemy = encounter.spawn(1, "assert-f200-stone");
  enemy.name = "F200木桩守卫";
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
let seqUsed = null;

// ── a) 一次「连击」连打三回合（按 seq 轮换直到抽到三回合全有 HP 行的流）──
for (let attempt = 0; attempt < 20; attempt++) {
  const seq = 11 + attempt;
  restoreSave();
  forgeCombat(seq);
  const s = (await fetchSaveView(id)).save;
  assert(
    s.combat && s.combat.turn === T0 && s.combat.enemy.hp === 5000,
    `锻造/回滚失败：${JSON.stringify({ turn: s.combat && s.combat.turn, ehp: s.combat && s.combat.enemy.hp })}`
  );
  const combo = await act(id, "连击");
  assert(
    combo.save.combat && combo.save.combat.turn === T0 + 3,
    `「连击」后回合数应 +3：turn=${combo.save.combat ? combo.save.combat.turn : "脱战"}（起点 ${T0}）`
  );
  const turns = await turnReports();
  assert(
    turns.length === 3 && new Set(turns.map((t) => t.id)).size === 3,
    `「连击」应写 3 条独立回合战报，实测 ${turns.length} 条`
  );
  assert(
    turns.map((t) => t.turn).join(",") === [T0, T0 + 1, T0 + 2].join(","),
    `「连击」回合序应为 ${T0}..${T0 + 2}，实测 ${turns.map((t) => t.turn).join(",")}`
  );
  for (const t of turns) {
    assert(t.turnLine.length > 0, `第${t.turn}回合缺「第N回合」正文行`);
  }
  if (turns.every((t) => t.vitalsLine.length > 0)) {
    comboTurns = turns;
    comboEnd = {
      hp: combo.save.hp,
      mp: combo.save.mp,
      enemyHp: combo.save.combat.enemy.hp,
      turn: combo.save.combat.turn,
    };
    seqUsed = seq;
    break;
  }
  // 某回合双方同时打空（合法无 HP 行）——换 seq 重锻重抽一支流。
}
assert(comboTurns, "20 次换 seq 仍抽不到三回合全有 HP 行的流");

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
    `第${T0 + i}回合正文不一致：\n  连击「${c.turnLine}」\n  连点「${a.turnLine}」`
  );
  assert(
    c.vitalsLine === a.vitalsLine,
    `第${T0 + i}回合 HP/MP 箭头不一致：\n  连击「${c.vitalsLine}」\n  连点「${a.vitalsLine}」`
  );
}
// P205：连击整次固定代价 6 MP——终态 mp 恰少 6，其余逐项相等（代价在
// 回合循环外一次性落账，不挤占回合种子，逐回合 RNG 流不变）。
assert(
  comboEnd.hp === attackEnd.hp && comboEnd.mp === attackEnd.mp - 6 &&
    comboEnd.enemyHp === attackEnd.enemyHp && comboEnd.turn === attackEnd.turn,
  `终态不一致：连击 ${JSON.stringify(comboEnd)} vs 连点 ${JSON.stringify(attackEnd)}（mp 应恰少 6）`
);

db.close();
console.log(
  `[ASSERT] combat-multi-round OK — seq=${seqUsed} 连击 3 回合战报独立成条` +
    `（${comboTurns.map((t) => `#${t.id}`).join("/")}），逐回合正文与 HP/MP 箭头` +
    `同三连点逐项相等，终态 ${JSON.stringify(comboEnd)}`
);
ok("[ASSERT] PASS");
