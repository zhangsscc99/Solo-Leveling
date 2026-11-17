#!/usr/bin/env node
// F120 休息叙述复读修复契约（全是行为断言）：
//
//   旧拼接：池句「……体力一点点回到四肢。」+ 尾句「体力与魔力一点点
//   回流……」——正文同义复读。修复后：
//   (a) 同一存档连做 2 次休息，两次回包正文前 12 字不得相同
//       （代价尾注按 rest_used 轮换 ≥3 变体且置前，与池句轮转叠加）；
//   (b) 回包不得出现「回到四肢。体力与魔力」式拼接复读，也不得再出现
//       旧尾句「体力与魔力一点点回流」；
//   (c) 回归：恢复数值不变——HP +ceil(max_hp*0.35)、MP +ceil(max_mp*0.40)
//       （clamp 到上限），「恢复 HP X→Y」记账口径不变（rest-cost.mjs
//       同源契约）。
//
//   落点锻造（DB 直写）：scene 落到 encounters:"none" 的 ch1_surface，
//   杜绝休息掷敌打断断言（惊敌是或然事件，不该让断言赌 RNG）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：旧拼句加回 → (b) FAIL；拼接句写死单条 → (a) FAIL；
//   恢复系数改动 → (c) FAIL。
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

// 独立 oracle：找一个 encounters==="none" 的 ch1 场景，杜绝掷敌。
const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const QUIET = ch1.scenes.find((s) => s.encounters === "none");
assert(QUIET, "oracle broken: ch1 has no encounters:none scene");

const id = await makeSave("f120-rest");
db.prepare(
  "UPDATE saves SET scene = ?, chapter = 1, hp = 40, mp = 5, rest_used = 0 WHERE id = ?"
).run(QUIET.id, id);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

const { save: s0 } = await fetchSaveView(id);
assert(
  s0.scene === QUIET.id && s0.hp === 40 && s0.max_hp === 100 && s0.combat === null && s0.rest.available === true,
  `setup broken: ${JSON.stringify({ scene: s0.scene, hp: s0.hp, combat: s0.combat, rest: s0.rest })}`
);

// ── (a)(b)(c) 第一次休息 ─────────────────────────────────────────────
const r1 = await act(id, "休息");
const c1 = r1.reply.content;
assert(!r1.save.combat, `(a) quiet scene must not roll an encounter: ${JSON.stringify(r1.save.combat)}`);
assert(
  r1.save.hp === 40 + Math.ceil(s0.max_hp * 0.35),
  `(c) HP recovery must stay ceil(max_hp*0.35): 40 -> ${r1.save.hp}`
);
assert(
  r1.save.mp === 5 + Math.ceil(s0.max_mp * 0.40),
  `(c) MP recovery must stay ceil(max_mp*0.40): 5 -> ${r1.save.mp}`
);
assert(
  /恢复\s+HP\s+40→75/.test(c1),
  `(c) rest ledger line must keep the「恢复 HP X→Y」form: ${c1.slice(-160)}`
);

// ── 第二次休息（hp 75→100 触顶 clamp，仍是一次真实休息）───────────────
const r2 = await act(id, "休息");
const c2 = r2.reply.content;
assert(!r2.save.combat, `(a) quiet scene must not roll an encounter: ${JSON.stringify(r2.save.combat)}`);
assert(r2.save.hp === 100, `(c) second rest should clamp HP to 100, got ${r2.save.hp}`);
assert(r2.save.rest_used === 2, `(c) rest_used should be 2, got ${r2.save.rest_used}`);

// (a) 前 12 字不得相同——代价尾注轮换 + 池句轮转双重保证。
assert(
  c1.slice(0, 12) !== c2.slice(0, 12),
  `(a) two consecutive rests must differ in first 12 chars:\n  1: ${c1.slice(0, 40)}\n  2: ${c2.slice(0, 40)}`
);
// (b) 拼接复读与旧尾句都不得回归。
for (const [tag, text] of [["rest#1", c1], ["rest#2", c2]]) {
  assert(
    !/回到四肢。\s*体力与魔力/.test(text),
    `(b) ${tag} repeated the pool-line ending verbatim: ${text.slice(-200)}`
  );
  assert(
    !text.includes("体力与魔力一点点回流"),
    `(b) ${tag} still carries the old splice「体力与魔力一点点回流」: ${text.slice(-200)}`
  );
}
console.log(`    (a) 两次休息前 12 字不同：「${c1.slice(0, 12)}…」/「${c2.slice(0, 12)}…」`);
console.log("    (b) 无拼接复读 (c) HP +35 / MP +8 记账不变");

db.close();
ok("rest-narration OK");
