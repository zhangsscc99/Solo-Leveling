#!/usr/bin/env node
// F149 死亡/回溯流程专项探针（第 21 轮实测遗留：HP 归零播报与回溯落点
// 已见，但复活 HP 84/100 非满——「回满 or 非满」口径未定，本脚本只锁
// 不变量、把实测数值打印出来供人工定口径，不断言满血）。
//
//   驱动（独立于 death.mjs 的固定路径）：「前进」自然撞遭遇；交战前把
//   HP 恢复满（DB 直写）、交战中每次动作前把 HP 压到 1（只写 hp 列，
//   max_hp 不动）——撤离掷逃失败回合敌人反击最小伤害为 1（F111 下限）
//   即归零，死亡必然出自「交战中前进」的撤离掷逃反击，不靠直写 deaths
//   伪造；非交战 HP 回满保证死亡只落在交战路径上（确定性送死）。
//   RNG 处（掷逃成败 / 反击命中）循环上限 60 动作，耗尽判 FAIL 并打印
//   最后 3 条动作日志。回包出现「叫阵」/ advance_mode=challenge_boss /
//   指纹连续 2 次不变 → 发「攻击」叫阵（服务端指令白名单无「叫阵」词，
//   守关房内真实入口就是 attack 意图）。
//
//   断言：
//     ① 死亡回包是可读播报：「倒下」+「黑」类词在场；「撤离失败」「仍
//        堵在面前」「寸步未移」「TODO」「undefined」等占位/拼接残留
//        一律不得出现（pre-F103 旧码在撤离致死回包里拼「撤离失败…寸
//        步未移」，本断言在旧码上必红）；
//     ② deaths 精确 +1（相对死亡动作前一刻的存档）；
//     ③ 回溯落点 = 本章主线链首入口（期望值独立推导自 chapters.json），
//        且与死亡场景不同（不是原地不动）；
//     ④ hp > 0 且 hp <= max_hp（实测值打印，报告注明「回满/非满」）；
//     ⑤ combat === null（交战态收敛）。
//
// 用法（_http.mjs 默认 http://127.0.0.1:3020/game/api，API_BASE/DB_PATH 覆盖）：
//   PORT=3094 DB_PATH=/tmp/fd22.db node server/index.js &
//   API_BASE=http://127.0.0.1:3094/game/api DB_PATH=/tmp/fd22.db \
//     node scripts/assert/death-probe-live.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

// 期望值独立推导：本章主线链首 = 回溯落点契约（与 chapter-gate.mjs 同源，
// 不调用被测引擎的 chapterPath）。
function deriveMainPath(chapter) {
  const byId = new Map(chapter.scenes.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  let cur = chapter.scenes[0];
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => typeof c.next === "string" && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
  return out;
}
const chains = {};
for (const c of raw.chapters) chains[c.index] = deriveMainPath(c);

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");
const id = await makeSave("dp"); // assert-dp-<b36> ≤ 20 字，服务端同名 409 规避

const pressHp = () => db.prepare("UPDATE saves SET hp = 1 WHERE id = ?").run(id);
const healHp = () => db.prepare("UPDATE saves SET hp = max_hp WHERE id = ?").run(id);

const sigOf = (s) => {
  const c = (s && s.combat) || {};
  const e = c.enemy || {};
  return [
    s.scene, s.chapter, s.hp, s.mp, s.deaths, s.encounter_clock,
    s.encounter_cd, s.advance_mode, c.seq, c.turn, e.hp,
  ].join("|");
};

const act = async (input) => {
  const { status, body } = await post("/action", { save_id: id, input });
  assert(status === 200 && body && body.reply && body.save, `action「${input}」failed (HTTP ${status})`);
  return body;
};

const tail = []; // 最近 3 条动作日志，超时报导用
let died = null;
let dyingScene = null;
let preDeaths = 0;
let prevSig = null;
let stale = 0;
let lastInput = null;
// 非交战「前进」真实推进（HP 由 DB 保持满值，绝不死于体力扣费）；
// 交战中动作前压 HP 至 1 后发「前进」撤离掷逃——失败回合吃反击即阵亡，
// 成功脱身则下一迭代先回满再上路，死亡只可能落在交战路径上。
for (let i = 0; i < 60 && !died; i++) {
  const { body } = await get(`/saves/${id}`);
  const s = body && body.save;
  assert(s, `save fetch failed at loop ${i}`);
  const inCombat = Boolean(s.combat);
  let input = "前进";
  if (inCombat) {
    pressHp();
    if (stale >= 2 && lastInput === "前进") input = "攻击"; // 撤离掷逃打不出结果时改拼反击
  } else {
    healHp();
    const mustChallenge = stale >= 2 || s.advance_mode === "challenge_boss";
    if (mustChallenge && lastInput !== "攻击") input = "攻击";
  }
  preDeaths = Number(s.deaths) || 0;
  dyingScene = s.scene;
  const r = await act(input);
  lastInput = input;
  const sig = sigOf(r.save);
  stale = sig === prevSig ? stale + 1 : 0;
  prevSig = sig;
  tail.push(
    `[${i}] ${inCombat ? "combat" : s.scene} ${input} -> ` +
      `${r.reply.content.replace(/\s+/g, " ").slice(0, 90)}`
  );
  if (tail.length > 3) tail.shift();
  if ((Number(r.save.deaths) || 0) > preDeaths && inCombat) died = r;
}
db.close();

assert(
  died,
  `60 回合未送死成功（RNG 耗尽 / 驱动空转）——最后 3 条动作日志:\n${tail.join("\n")}`
);

// ① 死亡回包是可读播报而非占位/拼接残留。
const reply = died.reply.content;
assert(reply.includes("倒下"), `death reply missing「倒下」broadcast: ${reply.slice(-200)}`);
assert(/黑|回溯/.test(reply), `death reply missing 黑/回溯 broadcast: ${reply.slice(-200)}`);
for (const bad of ["撤离失败", "仍堵在面前", "寸步未移", "TODO", "undefined"]) {
  assert(!reply.includes(bad), `death reply carries 占位/拼接残留「${bad}」: ${reply.slice(-300)}`);
}

// ② deaths 精确 +1。
assert(
  died.save.deaths === preDeaths + 1,
  `deaths 应精确 +1：动作前 ${preDeaths} -> 回包 ${died.save.deaths}`
);

// ③ 回溯落点 = 本章主线链首入口，且不是原地不动。
const entry = chains[died.save.chapter] && chains[died.save.chapter][0];
assert(entry, `unknown chapter ${died.save.chapter} for rewind check`);
assert(
  died.save.scene === entry,
  `回溯落点应为本章入口 ${entry}，实际 ${died.save.scene}（死亡场景 ${dyingScene}）`
);
assert(
  dyingScene !== entry,
  `探针预设失效：死亡场景 ${dyingScene} 即章入口，「不是原地不动」无法判定`
);

// ⑤ 交战态收敛。
assert(died.save.combat === null, `stale active combat after death: ${JSON.stringify(died.save.combat)}`);

// ④ 复活血量不变量：0 < hp <= max_hp；满血口径本轮未定，实测值打印。
assert(
  died.save.hp > 0 && died.save.hp <= died.save.max_hp,
  `revived hp 非法: ${died.save.hp}/${died.save.max_hp}（应 0 < hp <= max_hp）`
);
const fillState = died.save.hp === died.save.max_hp ? "回满" : "非满";
console.log(
  `[F149] deaths ${preDeaths}->${died.save.deaths} · ` +
    `${dyingScene} -> ${died.save.scene}（第${died.save.chapter}章入口）· ` +
    `复活 hp=${died.save.hp}/${died.save.max_hp}（${fillState}）`
);

ok("OK");
