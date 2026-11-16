#!/usr/bin/env node
// F151 疑问句守卫契约（全是行为断言）：
//
//   交战态把系统自己的兜底句复述回输入框，不得被结算成攻击指令：
//   (a) 输「你是想攻击还是想离开？」「要不要逃跑？」「攻击还是防御」——
//       intent 不得为 attack/flee（落 unknown 提示），战斗回合数不变、
//       HP 不变、敌方 HP 不变；
//   (b) 随后输陈述句「攻击」——仍走 attack 正常结算：回合推进且
//       敌方 HP 真降（锻造敌 agility=0，命中封顶，断言不赌 miss）。
//
//   交战锻造走 DB 直写（同 free-input-intent.mjs 取径：enemy_json 里的
//   seq 是开战盐，战斗种子 combat:{save_id}:{seq}:{turn}）。
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：删掉疑问句守卫 → (a) intent===attack/回合+1/HP 掉血全
//   FAIL；守卫扩到陈述句（把正常「攻击」也拦了）→ (b) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const encounterEngine = require(path.join(ROOT, "server", "engine", "encounter.js"));
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const id = await makeSave("f151-qguard");

// 交战锻造：enemy agility=0 —— 我方命中封顶，「攻击」必结算出伤害。
const enemyTpl = encounterEngine.makeEnemy({
  id: "broken_statue",
  name: "石像残兵",
  rank: "E",
  level: 2,
  hp: 300,
  xp: 22,
});
enemyTpl.stats.agility = 0;
db.prepare(
  "INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1) " +
    "ON CONFLICT(save_id) DO UPDATE SET enemy_json = excluded.enemy_json, turn = 1"
).run(id, JSON.stringify({ ...enemyTpl, seq: 77 }));

const before = (await fetchSaveView(id)).save;
assert(
  before.combat && before.combat.turn === 1 && before.combat.enemy.hp === 300,
  `setup broken: ${JSON.stringify(before.combat)}`
);

// ── (a) 疑问句形态：不命中战斗意图、回合/HP/敌血一律不变 ──────────────
for (const q of ["你是想攻击还是想离开？", "要不要逃跑？", "攻击还是防御"]) {
  const r = await act(id, q);
  assert(
    r.intent !== "attack" && r.intent !== "flee" && r.intent !== "advance",
    `(a)「${q}」resolved to a combat intent ${JSON.stringify(r.intent)} :: ${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.combat && r.save.combat.turn === before.combat.turn,
    `(a)「${q}」advanced the turn: ${before.combat.turn} -> ${r.save.combat && r.save.combat.turn}`
  );
  assert(
    r.save.combat.enemy.hp === before.combat.enemy.hp,
    `(a)「${q}」changed enemy hp: ${before.combat.enemy.hp} -> ${r.save.combat.enemy.hp}`
  );
  assert(r.save.hp === before.hp, `(a)「${q}」changed hp: ${before.hp} -> ${r.save.hp}`);
}
console.log("    (a) 3 question-form inputs: no combat intent, turn/HP unchanged");

// ── (b) 陈述句「攻击」：仍走 attack 正常结算 ───────────────────────────
const r = await act(id, "攻击");
assert(r.intent === "attack", `(b)「攻击」expected intent=attack, got ${JSON.stringify(r.intent)}`);
assert(
  r.save.combat === null || r.save.combat.turn === before.combat.turn + 1,
  `(b) turn must advance: ${before.combat.turn} -> ${JSON.stringify(r.save.combat)}`
);
const enemyAfter = r.save.combat ? r.save.combat.enemy.hp : 0;
assert(
  enemyAfter < before.combat.enemy.hp || r.save.hp !== before.hp,
  `(b) vitals must settle: enemy ${before.combat.enemy.hp}->${enemyAfter}, you ${before.hp}->${r.save.hp}`
);
console.log(`    (b) 攻击 → intent=attack, enemy ${before.combat.enemy.hp}→${enemyAfter}, turn settled`);

db.close();
ok("OK");
