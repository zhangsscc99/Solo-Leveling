#!/usr/bin/env node
// F150 守关者威压拒绝契约（全是行为断言）：
//
//   (a) 守关者未击杀 + 人站守关房：连输 4 次「前进」——每次 refused、
//       HP/MP/scene 零变化；4 条拒绝文案 ≥3 种互不相同（带计数轮换，
//       不得逐字复读），且每句都点名可输入的动作词「攻击」或「叫阵」
//       （同时保留按钮名「叫阵守关者」——gate-refusal-free 的老契约：
//       只指按钮对纯输入玩家是死路，只指动词对点按钮玩家也是死路）。
//   (b) 同一存档输「叫阵」——intent==="attack" 且 save.combat 非空
//       （文字叫阵与主按钮同一真实入口，真开战）；随后「攻击」真结算
//       一回合：回合数推进且 HP/敌方 HP 发生变化。
//
//   落点锻造走 DB 直写（同 gate-refusal-free.mjs 取径）。
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：attack 词表删掉「叫阵」→ (b) intent/combat 断言 FAIL；
//   拒绝文案退回单句复读 → (a) ≥3 种断言 FAIL；文案删掉「攻击/叫阵」
//   可输入动词 → (a) 逐句断言 FAIL；删掉计数 → (a) 第 N 次断言 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const CH1_BOSS = ch1.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS, "oracle broken: ch1 boss scene missing");

const id = await makeSave("f150-gate");
db.prepare(
  "UPDATE saves SET scene = ?, boss_cleared_json = '[]', encounter_clock = -1, encounter_cd = 0 WHERE id = ?"
).run(CH1_BOSS.id, id);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

// ── (a) 4 次「前进」：refused、零消耗、文案轮换带计数、点名可输入动词 ──
const { save: s0 } = await fetchSaveView(id);
assert(
  s0.scene === CH1_BOSS.id && s0.chapter === 1 && s0.combat === null,
  `(a) setup broken: ${s0.scene} ch${s0.chapter} combat=${JSON.stringify(s0.combat)}`
);
const lines = [];
for (let i = 0; i < 4; i++) {
  const r = await act(id, "前进");
  assert(
    r.refused === true,
    `(a) push#${i + 1} must be refused, got ${JSON.stringify(r.refused)} :: ${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `(a) push#${i + 1} changed state: ${s0.hp}/${s0.mp}/${s0.scene} -> ${r.save.hp}/${r.save.mp}/${r.save.scene}`
  );
  const c = r.reply.content;
  assert(
    /攻击|叫阵/.test(c),
    `(a) push#${i + 1} refusal must name an inputtable verb (攻击/叫阵): ${c.slice(-160)}`
  );
  assert(
    c.includes("叫阵守关者"),
    `(a) push#${i + 1} refusal must keep the clickable button name: ${c.slice(-160)}`
  );
  assert(
    /第\s*\d+\s*次/.test(c),
    `(a) push#${i + 1} refusal must carry a counter (第 N 次): ${c.slice(-160)}`
  );
  lines.push(c);
}
assert(
  new Set(lines).size >= 3,
  `(a) 4 consecutive refusals must rotate >=3 distinct wordings, got ${new Set(lines).size}`
);
console.log(`    (a) 4x 前进 refused: ${new Set(lines).size} distinct wordings, all name 攻击/叫阵 + 计数`);

// ── (b) 「叫阵」= attack 真开战；「攻击」真结算一回合 ──────────────────
const r1 = await act(id, "叫阵");
assert(
  r1.intent === "attack",
  `(b)「叫阵」expected intent=attack, got ${JSON.stringify(r1.intent)} :: ${r1.reply.content.slice(-120)}`
);
assert(
  r1.save.combat && r1.save.combat.enemy && r1.save.combat.enemy.boss === true,
  `(b)「叫阵」must really engage the guardian: ${JSON.stringify(r1.save.combat)}`
);
const enemyBefore = r1.save.combat.enemy.hp;
const turnBefore = r1.save.combat.turn;
const hpBefore = r1.save.hp;
const r2 = await act(id, "攻击");
assert(r2.intent === "attack", `(b)「攻击」expected intent=attack, got ${JSON.stringify(r2.intent)}`);
assert(
  r2.save.combat === null || r2.save.combat.turn === turnBefore + 1,
  `(b) a real round must advance the turn: ${turnBefore} -> ${JSON.stringify(r2.save.combat)}`
);
const enemyAfter = r2.save.combat ? r2.save.combat.enemy.hp : 0;
assert(
  enemyAfter !== enemyBefore || r2.save.hp !== hpBefore,
  `(b) a real round must settle vitals: enemy ${enemyBefore}->${enemyAfter}, you ${hpBefore}->${r2.save.hp}`
);
console.log(`    (b) 叫阵 → intent=attack, combat spawned, round settled (enemy ${enemyBefore}→${enemyAfter}, you ${hpBefore}→${r2.save.hp})`);

db.close();
ok("OK");
