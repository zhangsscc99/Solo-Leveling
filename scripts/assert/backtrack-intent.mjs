#!/usr/bin/env node
// F140「往回走」被 advance 抢走（全是行为断言）：
//
//   (a) 非交战存档站在 ch3_association（正常场景、非封门），依次输
//       「往回走」「原路返回」「回头」——每次回包 intent 必须是 flee
//       （绝不能是 advance），save.scene 与发之前一致、不掷遭遇；
//       若回包按既有口径挂 refused（非交战 flee 被拒是允许口径），
//       intent==="flee" 且 scene 不变的约束照旧成立。
//   (b) 同一存档输「继续走」「向前走」——intent==="advance"、不
//       refused、scene 真的变化：词表修补不得把推进抢坏。
//       ch3 主线链 = ch3_association(链首) → ch3_retest(boss) →
//       ch3_new_rank(链尾)；从链首「前进」是 F124 scripted 步——
//       零消耗、不掷遭遇、必落第二幕——故每次推进断言前把站位铸回
//       链首，确定性不依赖守关者生死也不吃遭遇随机数。
//
//   落点锻造走 DB 直写（同 escape-locked-boss-cleared.mjs 取径）：
//   UPDATE saves 改 chapter/scene + DELETE combat 清交战。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：把 flee 词表改回 F137 版（删掉 往回|回头|退回去|原路返回）
//   →「往回走」重新落 advance 真推进一幕、「回头」落 unknown——(a) FAIL；
//   反之把 advance 词表改坏（如删掉裸「走」）→ (b) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

function forgeSave(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

const CH3_FIRST = "ch3_association";

const id = await makeSave("f140");
forgeSave(id, {
  chapter: 3,
  scene: CH3_FIRST,
  level: 10,
  encounter_clock: 0,
  encounter_cd: 0,
});
const before0 = (await fetchSaveView(id)).save;
assert(
  before0.scene === CH3_FIRST && before0.chapter === 3 && before0.combat === null,
  `setup broken: ${before0.scene} ch${before0.chapter} combat=${JSON.stringify(before0.combat)}`
);

// ── (a) 后退说法：intent=flee、原地不动（refused 与否都是允许口径）──
for (const word of ["往回走", "原路返回", "回头"]) {
  const before = (await fetchSaveView(id)).save;
  const r = await act(id, word);
  assert(
    r.intent === "flee",
    `(a)「${word}」期望 intent=flee，实际 ${JSON.stringify(r.intent)}` +
      `（scene=${r.save.scene}，flee 词表漏词会被 advance 抢走真推进一幕）`
  );
  assert(
    r.save.scene === before.scene && r.save.chapter === before.chapter,
    `(a)「${word}」挪了位置：${before.scene}(ch${before.chapter}) -> ${r.save.scene}(ch${r.save.chapter})`
  );
  assert(
    r.save.combat === null,
    `(a)「${word}」掷出了遭遇：${JSON.stringify(r.save.combat)}`
  );
}
console.log("[OK] (a) 往回走/原路返回/回头 → intent=flee，scene 原地不动");

// ── (b) 推进说法：intent=advance 且 scene 真变化（没把 advance 抢坏）──
for (const word of ["继续走", "向前走"]) {
  // 铸回链首：链首出发是 scripted 步，落点确定（ch3_retest）、不掷遭遇。
  forgeSave(id, { scene: CH3_FIRST });
  const before = (await fetchSaveView(id)).save;
  const r = await act(id, word);
  assert(
    r.intent === "advance",
    `(b)「${word}」期望 intent=advance，实际 ${JSON.stringify(r.intent)}`
  );
  assert(
    r.refused !== true,
    `(b)「${word}」被 refused：${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.scene !== before.scene || r.save.chapter !== before.chapter,
    `(b)「${word}」没有推进：${before.scene}(ch${before.chapter}) -> ${r.save.scene}(ch${r.save.chapter})`
  );
}
console.log("[OK] (b) 继续走/向前走 → intent=advance 且 scene 真变化，推进未被抢坏");

ok("F140 backtrack-intent contract: all assertions passed");
