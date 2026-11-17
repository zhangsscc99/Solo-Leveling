#!/usr/bin/env node
// F189 回合播报去模板复读 e2e：锻造一场与石像守卫的真打（DB 直写 combat
// 行，与 flee-prose-by-enemy-kind 同取径；玩家/敌敏捷压到 0 → 双方命中率
// 封顶 0.98，回回合几乎必有「造成 N 点伤害」；敌血池放大保证 ≥4 回合）。
//
//   (a) 同一场 ≥4 个连续回合，相邻两回合的正文（数字归一化后）不得逐字
//       全等——旧码「命中…造成 N 点伤害」单模板会把相邻回合写成同一句话；
//   (b) 事实子串与实测掉血绑定：本回合实际掉血的一侧，正文必须含
//       「造成 N 点伤害」（N = 该侧 HP 箭头实测掉血量）；双方都未掉
//       血的回合（命中率封顶 0.98，同回合双方打空是合法结果），正文
//       必须含 miss/闪避语义且不得凭空出现「造成 N 点伤害」；
//   (c) HP/MP 序列符合预期：敌 HP 逐回合单调不增、你 HP 单调不增、
//       MP 在纯普攻下不得变动（无 MP → 箭头也不出现）。
//
//   旧码必红：旧实现 strike 文案各只有一条模板 → (a) 直接 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const encounter = require(path.join(ROOT, "server", "engine", "encounter.js"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const TURN_RE = /【战斗】第\s*\d+\s*回合/;
const DMG_RE = /造成\s*\d+\s*点伤害/;
const VITALS_RE = /(.+?)\s*(HP|MP)\s*(\d+)\s*→\s*(\d+)/g;

const id = await makeSave("round-variety");

// 锻造：玩家低攻高血（磨 8+ 回合不死人）、石像守卫 0 敏巨血池。
const enemy = encounter.spawn(1, "assert-f189-stone");
enemy.name = "石像守卫";
enemy.kind = "stone";
enemy.seq = 7;
enemy.hp = enemy.maxHp = 5000;
enemy.stats = { strength: 4, agility: 0, vitality: 6, intelligence: 4, perception: 5 };
db.prepare(
  "UPDATE saves SET level = 30, hp = 5000, max_hp = 5000, mp = 40, max_mp = 40, " +
    "stats_json = ?, boss_cleared_json = '[]', encounter_clock = 0, encounter_cd = 0 WHERE id = ?"
).run(
  JSON.stringify({ strength: 5, agility: 0, vitality: 50, intelligence: 0, perception: 0 }),
  id
);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
db.prepare("INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1)").run(
  id,
  JSON.stringify(enemy)
);
db.close();

const s0 = (await fetchSaveView(id)).save;
assert(s0.combat && s0.combat.enemy && s0.combat.enemy.name === "石像守卫", "forged combat missing");

// ── 真打：逐回合「攻击」直到脱战/阵亡/封顶 ─────────────────────────
const turns = []; // { n, line, vitals: [{who,kind,a,b}] }
for (let i = 0; i < 40; i++) {
  const r = await act(id, "攻击");
  const content = (r.reply && r.reply.content) || "";
  const line = content.split("\n").find((l) => TURN_RE.test(l));
  if (line) {
    const vline = (
      content
        .split("\n")
        .find((l) => /^【战斗】/.test(l) && /(?:HP|MP)\s*\d+\s*→/.test(l) && !TURN_RE.test(l)) || ""
    ).replace(/^【战斗】/, "");
    const vitals = [];
    let m;
    VITALS_RE.lastIndex = 0;
    while ((m = VITALS_RE.exec(vline))) {
      vitals.push({
        who: m[1].replace(/^[^\u4e00-\u9fa5\w]+/, "").split(/[·\s]+/).pop(),
        kind: m[2], a: Number(m[3]), b: Number(m[4]),
      });
    }
    turns.push({ line, vitals });
  }
  if (!r.save.combat) break;
}
assert(turns.length >= 4, `交战不足 4 回合（实际 ${turns.length}）`);
const run = turns.slice(0, 4);

// (a) 相邻回合正文不得逐字复读：数字归一化后也必须不同（排除纯数值差异）。
const norm = (s) => s.replace(/\d+/g, "#");
for (let i = 1; i < run.length; i++) {
  assert(
    norm(run[i].line) !== norm(run[i - 1].line),
    `相邻回合正文逐字重复（模板归一后全等）：\n  ${run[i - 1].line}\n  ${run[i].line}`
  );
}

// (b) 事实子串与实测掉血绑定：命中必然掉血（伤害下限 1 点），掉血侧
//     的箭头差值就是正文里必须出现的「造成 N 点伤害」的 N；双方都未
//     掉血的回合必然是两记打空，正文要有 miss/闪避语义且不得虚报伤害。
const MISS_RE = /落空|了个空|没能命中|没有命中|避开|闪开|擦身|滑开/;
for (const t of run) {
  const drops = t.vitals
    .filter((v) => v.kind === "HP" && v.a > v.b)
    .map((v) => ({ who: v.who === enemy.name ? enemy.name : "你", n: v.a - v.b }));
  if (drops.length) {
    for (const d of drops) {
      assert(
        new RegExp(`造成\\s*${d.n}\\s*点伤害`).test(t.line),
        `回合正文缺「造成 ${d.n} 点伤害」（${d.who} 实测掉血 ${d.n}）：${t.line}`
      );
    }
  } else {
    assert(
      MISS_RE.test(t.line),
      `双方都未掉血的回合正文缺 miss/闪避语义：${t.line}`
    );
    assert(
      !DMG_RE.test(t.line),
      `双方都未掉血的回合不得出现「造成 N 点伤害」：${t.line}`
    );
  }
}

// (c) HP/MP 序列符合预期：敌血、你血单调不增；纯普攻不得有 MP 变动。
let prevEnemy = null;
let prevYou = null;
for (const t of run) {
  for (const v of t.vitals) {
    assert(v.b >= 0, `负值血量箭头：${JSON.stringify(v)}`);
    if (v.kind === "MP") fail(`纯普攻回合不应出现 MP 变动：${JSON.stringify(v)}`);
    if (v.who === enemy.name) {
      if (prevEnemy !== null) assert(v.b <= prevEnemy, `敌 HP 回升：${prevEnemy}→${v.b}`);
      prevEnemy = v.b;
    } else {
      if (prevYou !== null) assert(v.b <= prevYou, `你 HP 回升：${prevYou}→${v.b}`);
      prevYou = v.b;
    }
  }
}
assert(prevEnemy !== null && prevEnemy < 5000, "敌 HP 全程未降，战斗没有结算");

ok("OK");
