#!/usr/bin/env node
// F195 验收断言：守关房被逼退的提示不许说谎、不许逐字复读。
//
//   现状缺陷：连点「前进」被威压逼退时 save.hp 纹丝不动（patch:null
//   零消耗短路），短指引却写「它每回合仍在耗你的血」；且该行除
//   「第 N 次」计数器外逐字重复。
//
//   断言（落点锻造走 DB 直写，同 boss-refusal-affordance 取径）：
//     a) 人站 ch1 守关房、守关者未击杀、无交战 → 连发 4 次「前进」，
//        逐次记录回包 save.hp 与正文；
//     b) HP 未减少的那些次，正文不得含「耗你的血 / 流失 / 掉血」等
//        扣血表述；
//     c) 4 次正文去掉「第 N 次」计数器后去重 ≥3 种；
//     d) 每次正文仍点名真实可达出路「攻击」或「叫阵」。
//   旧码红证：旧 hint 恒含「耗你的血」且逐字复读 → b)/c) FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api；DB_PATH 默认
//   <repo>/data/game.db，隔离实例记得指向同一库文件。
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

const id = await makeSave("f195-refusal");
db.prepare(
  "UPDATE saves SET scene = ?, boss_cleared_json = '[]', encounter_clock = -1, encounter_cd = 0 WHERE id = ?"
).run(CH1_BOSS.id, id);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

const { save: s0 } = await fetchSaveView(id);
assert(
  s0.scene === CH1_BOSS.id && s0.chapter === 1 && s0.combat === null,
  `setup broken: ${s0.scene} ch${s0.chapter} combat=${JSON.stringify(s0.combat)}`
);

const BLEED_RE = /耗你的血|流失|掉血/;
const runs = [];
for (let i = 0; i < 4; i++) {
  const r = await act(id, "前进");
  assert(
    r.refused === true,
    `push#${i + 1} must be refused, got ${JSON.stringify(r.refused)} :: ${r.reply.content.slice(-140)}`
  );
  runs.push({ hpBefore: i === 0 ? s0.hp : runs[i - 1].hp, hp: r.save.hp, content: r.reply.content });
  console.log(`(a) push#${i + 1} hp=${r.save.hp} 正文前110字: ${r.reply.content.slice(0, 110)}`);
}

for (const [i, run] of runs.entries()) {
  if (run.hp >= run.hpBefore) {
    assert(
      !BLEED_RE.test(run.content),
      `(b) push#${i + 1} HP 未减（${run.hpBefore}→${run.hp}）却出现扣血表述: ${run.content.slice(-200)}`
    );
  }
  assert(
    /攻击|叫阵/.test(run.content),
    `(d) push#${i + 1} 必须点名可达出路（攻击/叫阵）: ${run.content.slice(-160)}`
  );
}

const deduped = new Set(runs.map((r) => r.content.replace(/第\s*\d+\s*次/g, "第N次")));
assert(
  deduped.size >= 3,
  `(c) 4 次逼退正文去掉计数器后应 ≥3 种，实得 ${deduped.size} 种`
);
console.log(`    (c) 去重后 ${deduped.size} 种文案（≥3）`);

db.close();
ok("OK");
