#!/usr/bin/env node
// F197 软门量化风险断言（全是行为断言）：
//
//   Lv.1 新档越 ch1→ch2 软门（直写落点 = ch1 主线链尾 + 守关者已击杀，
//   同 soft-gate-wording.mjs 取径）：
//
//   (a) 过门前 GET /api/chapters：ch2 unlock.state === "soft" 且带
//       unlock.risk——enemy_level/enemy_hp/player_level/player_hp/
//       player_max_hp/est_take_lo/est_take_hi 全部为正整数，hi ≥ lo；
//       unlock.hint 文案必须带同一组数字（敌方 Lv.、玩家 Lv.、承伤区间
//       逐字出现——与字段同源，不是另写的一套）。
//   (b) 「前进」过门回包：正文同时含敌方名、敌方 Lv.数字、玩家 Lv.数字、
//       敌方 HP、以及 est_take_lo–est_take_hi 区间（逐字与 risk 字段相同）；
//       回包 save.chapter_unlock.risk 与地图侧字段完全一致（同一事实源）。
//
//   数字口径不取自断言自算——脚本只比对「服务端字段 vs 服务端文案」，
//   不重新实现伤害公式；风险数值的真实出处是 encounterEngine.spawnBoss
//   （F097 带宽钳制）+ computeDamage（F191 est_take 口径）。
//
//   旧码必红：unlock 视图没有 risk 字段、hint/crossing 不含任何数字 →
//   (a) 第一枪就 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, get, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 主线链独立推导（与 chapter-gate.mjs / soft-gate-wording.mjs 同一口径）。
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

const ch1 = raw.chapters.find((c) => c.index === 1);
const ch2 = raw.chapters.find((c) => c.index === 2);
const ch1Tail = deriveMainPath(ch1).slice(-1)[0];
const GATE_LV = ch2.unlock.level;

const id = await makeSave("soft-gate-risk");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, level = 1, boss_cleared_json = ? WHERE id = ?"
).run(ch1Tail, JSON.stringify([ch1.id]), id);

const before = (await fetchSaveView(id)).save;
assert(
  before.scene === ch1Tail && before.chapter === 1 && before.level === 1 && !before.combat,
  `setup broken: scene=${before.scene} ch=${before.chapter} lv=${before.level}`
);
assert(before.level < GATE_LV, `setup broken: level ${before.level} not below gate Lv.${GATE_LV}`);

// ── (a) 地图侧：/api/chapters 的 ch2 unlock 量化风险 ──────────────
const map = await get(`/chapters?save_id=${id}`);
assert(map.status === 200, `GET /chapters failed (HTTP ${map.status})`);
const ch2v = (map.body.chapters || []).find((c) => c.index === 2);
assert(ch2v && ch2v.unlock, "ch2 unlock view missing from /chapters");
assert(
  ch2v.unlock.state === "soft",
  `setup broken: ch2 gate should be soft for Lv.1, got ${ch2v.unlock.state}`
);
const risk = ch2v.unlock.risk;
assert(
  risk && typeof risk === "object",
  "(a) unlock.risk missing — soft gate gives no quantified danger"
);
for (const k of [
  "enemy_level",
  "enemy_hp",
  "player_level",
  "player_hp",
  "player_max_hp",
  "est_take_lo",
  "est_take_hi",
]) {
  assert(
    Number.isInteger(risk[k]) && risk[k] >= 1,
    `(a) risk.${k} must be a positive integer, got ${JSON.stringify(risk[k])}`
  );
}
assert(
  risk.est_take_hi >= risk.est_take_lo,
  `(a) take range inverted: ${risk.est_take_lo}–${risk.est_take_hi}`
);
assert(risk.player_level === 1, `(a) risk.player_level should be 1, got ${risk.player_level}`);
assert(
  typeof risk.enemy_name === "string" && risk.enemy_name.trim().length > 0,
  `(a) risk.enemy_name missing: ${JSON.stringify(risk.enemy_name)}`
);

const hint = String(ch2v.unlock.hint || "");
assert(
  hint.includes(`Lv.${risk.enemy_level}`),
  `(a) hint must carry the enemy level (Lv.${risk.enemy_level}): ${hint}`
);
assert(
  hint.includes(`Lv.${risk.player_level}`),
  `(a) hint must carry the player level (Lv.${risk.player_level}): ${hint}`
);
assert(
  hint.includes(`${risk.est_take_lo}–${risk.est_take_hi}`),
  `(a) hint must carry the same take range as risk fields (${risk.est_take_lo}–${risk.est_take_hi}): ${hint}`
);

// ── (b) 过门回包：正文与字段同源的数字 ────────────────────────────
const r = await act(id, "前进");
assert(r.save.chapter === 2, `gate push should land chapter 2, got ${r.save.chapter}`);
const content = r.reply.content || "";
assert(
  content.includes(risk.enemy_name),
  `(b) crossing reply must name the enemy「${risk.enemy_name}」: ${content.slice(0, 240)}`
);
assert(
  content.includes(`Lv.${risk.enemy_level}`),
  `(b) crossing reply must carry the enemy level digit (Lv.${risk.enemy_level}): ${content.slice(0, 240)}`
);
assert(
  content.includes(`Lv.${risk.player_level}`),
  `(b) crossing reply must carry the player level digit (Lv.${risk.player_level}): ${content.slice(0, 240)}`
);
assert(
  content.includes(`HP ${risk.enemy_hp}`),
  `(b) crossing reply must carry the enemy HP (${risk.enemy_hp}): ${content.slice(0, 240)}`
);
assert(
  content.includes(`${risk.est_take_lo}–${risk.est_take_hi}`),
  `(b) crossing reply must carry the same take range as risk fields ` +
    `(${risk.est_take_lo}–${risk.est_take_hi}): ${content.slice(0, 240)}`
);
const gate2 = r.save.chapter_unlock;
assert(
  gate2 && gate2.state === "soft" && gate2.risk && typeof gate2.risk === "object",
  "(b) save.chapter_unlock.risk missing after crossing"
);
for (const k of ["enemy_level", "enemy_hp", "player_level", "est_take_lo", "est_take_hi"]) {
  assert(
    gate2.risk[k] === risk[k],
    `(b) chapter_unlock.risk.${k} diverged from /chapters view ` +
      `(${gate2.risk[k]} vs ${risk[k]}) — not a single source of truth`
  );
}

db.close();
ok("OK");
