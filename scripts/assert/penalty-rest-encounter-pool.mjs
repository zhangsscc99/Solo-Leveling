#!/usr/bin/env node
// F138 惩罚副本「休息」遭遇池断言（全是行为断言）：
//
//   线上实测：惩罚副本内连休 3 次，前两次召来可击杀的惩罚沙虫 Lv.4
//   （唯一活路），第三次却召来 Boss 本体「惩罚副本·毒牙蛇」——玩家
//   最自然的「回满血再挑战」反而立刻回到必死遭遇，规则不可预测。
//   根因：rest 掷敌与「前进」落地共用 tryEncounter，站在守关房
//   （kind==="boss"）休息时必然 spawnBoss。
//
//   断言：DB 直写存档置 ch2 守关房（休息被 Boss 本体打断的真实案发点），
//   连做 3 次休息（每次 DB 置 encounter_clock=3 触发保底必掷、rest_used
//   归 0、交战行清掉——等价「玩家脱战后再歇」的真实前置）：
//     ① 三次遭遇名均不含「毒牙蛇」，且 enemy.boss !== true
//        （Boss 只在玩家主动叫阵/「前进」落地守门房时出现）；
//     ② 三次遭遇等级 ≤ 玩家等级 + 1（杂兵池带宽口径）；
//     ③ 三次回包均带 encounter_source === "rest" 字段。
//
//   旧码红证：守关房内休息掷出「惩罚副本·毒牙蛇」（spawnBoss 强制），
//   ① FAIL；回包无 encounter_source 字段，③ FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
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

const PENALTY_BOSS = "ch2_poison_fang"; // 案发点：守关房内休息召来 Boss 本体

const id = await makeSave("f138-rest");

// 与 escape-loop 同口径的 Lv.4 存档，落点直接置守关房（boss 未清）。
db.prepare(
  `UPDATE saves SET chapter = 2, scene = ?, level = 4, rank = 'E',
     hp = 60, max_hp = 176, mp = 30, max_mp = 68, deaths = 3,
     boss_cleared_json = '[]', boss_hp_json = '{}',
     encounter_clock = 3, encounter_cd = 0, encounter_seq = 0,
     rest_used = 0, advance_streak = 0, stealth_charges = 0
   WHERE id = ?`
).run(PENALTY_BOSS, id);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

const before = (await fetchSaveView(id)).save;
assert(
  before.scene === PENALTY_BOSS && before.chapter === 2 && !before.combat,
  `setup broken: scene=${before.scene} ch=${before.chapter}`
);
assert(
  before.rest && before.rest.available === true,
  `setup broken: rest unavailable ${JSON.stringify(before.rest)}（hp ${before.hp}/${before.max_hp}）`
);
const playerLevel = before.level;
console.log(`[setup] 守关房内连休 ×3 · Lv.${playerLevel} HP ${before.hp}/${before.max_hp}`);

for (let i = 1; i <= 3; i++) {
  // 保底置位 + 配额归 0 + 交战行清掉：等价「脱战后再歇」的连续休息。
  db.prepare(
    "UPDATE saves SET encounter_clock = 3, rest_used = 0, hp = 60 WHERE id = ?"
  ).run(id);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

  const r = await act(id, "休息");
  const s = r.save;
  const e = s.combat && s.combat.enemy;
  console.log(
    `  休息#${i} → combat=${e ? `${e.name} Lv.${e.level}${e.boss ? " [boss]" : ""} HP${e.hp}/${e.max_hp}` : "无"}` +
      ` · encounter_source=${JSON.stringify(r.encounter_source)}`
  );

  // 保底置位下休息必须掷出遭遇——本断言的前提是「遭遇真的发生了」。
  assert(
    e && typeof e.name === "string",
    `休息#${i} 未掷出遭遇（保底计数置位应必中）：${JSON.stringify(s.combat)}`
  );
  // ① 遭遇池不得含 Boss 本体。
  assert(
    !e.name.includes("毒牙蛇") && e.boss !== true,
    `休息#${i} 召来了 Boss 本体「${e.name}」——守关者只应被叫阵/前进惊动`
  );
  // ② 遭遇等级 ≤ 玩家等级 + 1（杂兵池带宽口径）。
  assert(
    Math.trunc(Number(e.level) || 0) <= playerLevel + 1,
    `休息#${i} 遭遇等级越界：${e.name} Lv.${e.level} > 玩家 Lv.${playerLevel}+1`
  );
  // ③ 回包必须带 encounter_source:"rest" 字段。
  assert(
    r.encounter_source === "rest",
    `休息#${i} 回包缺 encounter_source:"rest"：${JSON.stringify(r.encounter_source)}`
  );
  // 可读提示：遭遇行如实写明是被休憩惊动摸进藏身处的。
  const text = r.reply.content || "";
  assert(
    text.includes("休憩") || text.includes("藏身处"),
    `休息#${i} 遭遇行缺可读提示：${text.slice(-160)}`
  );
}

ok("F138 PASS penalty rest pool: 3 次休息全走杂兵池（无毒牙蛇、等级 ≤ 玩家+1、encounter_source=rest）");
