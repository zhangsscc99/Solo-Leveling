#!/usr/bin/env node
// F072 contract: 影子成长接入五项属性 —— growth.perLevel/baseStats 只用
// stats.js STAT_KEYS，grantXp 的成长经 sanitizeStats 不被清零，
// combatProfile 折算随等级严格递增；缺五项 stats 的老影子按 rank
// baseStats 兜底，与同 rank Lv.1 新影子一致（不被静默清零）。
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const shadow = require(path.join(ROOT, "server", "engine", "shadow.js"));
const statsLib = require(path.join(ROOT, "server", "engine", "stats.js"));
const { STAT_KEYS } = statsLib;

const sum = (stats) => STAT_KEYS.reduce((t, k) => t + (Number(stats[k]) || 0), 0);

// 1) shadow.json：growth.perLevel 键集合恰为五项属性（无 atk/def/hp），
//    growth.baseStats 覆盖 E..S 六档且每档都是五项。
const raw = JSON.parse(
  fs.readFileSync(path.join(ROOT, "server", "data", "shadow.json"), "utf8"),
);
assert.ok(raw.growth && typeof raw.growth === "object", "shadow.json 缺 growth 段");
assert.deepEqual(
  Object.keys(raw.growth.perLevel || {}).sort(),
  [...STAT_KEYS].sort(),
  "growth.perLevel 必须恰为五项属性",
);
for (const k of ["atk", "def", "hp"]) {
  assert.ok(!(k in raw.growth.perLevel), `growth.perLevel 仍含旧键 ${k}`);
}
assert.ok(raw.growth.baseStats && typeof raw.growth.baseStats === "object", "缺 growth.baseStats");
for (const rank of ["E", "D", "C", "B", "A", "S"]) {
  const bs = raw.growth.baseStats[rank];
  assert.ok(bs && typeof bs === "object", `baseStats 缺 ${rank} 档`);
  assert.deepEqual(
    Object.keys(bs).sort(),
    [...STAT_KEYS].sort(),
    `baseStats.${rank} 必须恰为五项属性`,
  );
}

// 2) Lv.1（baseStats.E）起手，按 config 原生 xp 曲线喂足经验升到 Lv.10：
//    期望数值为写死常量（不从 config 反推，避免自证循环）：
//    perLevel = {strength:1.5, agility:1, vitality:0.5, intelligence:0.5, perception:0.5}
//    Lv.10 = baseStats.E + perLevel × 9。
const cfg = shadow.loadConfig();
const lv1 = { rank: "E", level: 1, xp: 0, stats: { strength: 6, agility: 5, vitality: 6, intelligence: 3, perception: 4 } };

let need = 0;
for (let lv = 1; lv < 10; lv += 1) need += shadow.xpForLevel(lv, cfg);
const res = shadow.grantXp(lv1, need, cfg);
assert.equal(res.shadow.level, 10, `应升到 Lv.10，实际 Lv.${res.shadow.level}`);

const LV10_EXPECTED = {
  strength: 19.5,
  agility: 14,
  vitality: 10.5,
  intelligence: 7.5,
  perception: 8.5,
};
for (const key of STAT_KEYS) {
  assert.equal(
    res.shadow.stats[key],
    LV10_EXPECTED[key],
    `${key} 应为写死期望 ${LV10_EXPECTED[key]}（baseStats.E + perLevel × 9）`,
  );
}
for (const k of ["atk", "def", "hp"]) {
  assert.ok(!(k in res.shadow.stats), `升级结果仍含旧键 ${k}`);
}
assert.ok(
  sum(statsLib.sanitizeStats(res.shadow)) > sum(statsLib.sanitizeStats(lv1)),
  "sanitizeStats 后五项总和必须大于 Lv.1（旧实现此处为 0）",
);

// 3) combatProfile：Lv.1 / Lv.10 的折算结果与写死常量一致（随等级严格递增）。
const p1 = shadow.combatProfile(lv1);
const p10 = shadow.combatProfile(res.shadow);
assert.equal(p1.atk, 10, `Lv.1 atk 应为 round(1.6×6)=10，实际 ${p1.atk}`);
assert.ok(Math.abs(p1.def - 4.8) < 1e-9, `Lv.1 def 应为 0.8×6=4.8，实际 ${p1.def}`);
assert.equal(p1.maxHp, 144, `Lv.1 maxHp 应为 80+4+10×6=144，实际 ${p1.maxHp}`);
assert.equal(p10.atk, 31, `Lv.10 atk 应为 round(1.6×19.5)=31，实际 ${p10.atk}`);
assert.ok(Math.abs(p10.def - 8.4) < 1e-9, `Lv.10 def 应为 0.8×10.5=8.4，实际 ${p10.def}`);
assert.equal(p10.maxHp, 225, `Lv.10 maxHp 应为 80+40+10×10.5=225，实际 ${p10.maxHp}`);
assert.ok(p10.atk > p1.atk && p10.def > p1.def && p10.maxHp > p1.maxHp, "折算必须随等级递增");

// 4) 回归锁：缺五项 stats 的老影子（F072 前的 {atk,def,hp} 形态 / stats 缺失）
//    combatProfile 必须等于同 rank Lv.1 新影子（baseStats 兜底，不得静默清零）。
const legacyAtkDefHp = { rank: "E", level: 1, stats: { atk: 20, def: 9, hp: 160 } };
const legacyNoStats = { rank: "E", level: 1 };
const legacyZeroStats = { rank: "E", level: 1, stats: { strength: 0, agility: 0, vitality: 0, intelligence: 0, perception: 0 } };
const pFresh = shadow.combatProfile(lv1);
for (const [label, legacy] of [
  ["{atk,def,hp} 老影子", legacyAtkDefHp],
  ["无 stats 老影子", legacyNoStats],
  ["五项全 0 老影子", legacyZeroStats],
]) {
  assert.deepEqual(
    shadow.combatProfile(legacy),
    pFresh,
    `${label} 的 combatProfile 必须等于同 rank Lv.1 新影子`,
  );
}
// grantXp 同样兜底：老影子吃经验后从 baseStats 起点成长，不产出 atk=1。
const grown = shadow.grantXp(legacyAtkDefHp, shadow.xpForLevel(1, cfg), cfg);
assert.equal(grown.shadow.level, 2);
assert.deepEqual(
  grown.shadow.stats,
  { strength: 7.5, agility: 6, vitality: 6.5, intelligence: 3.5, perception: 4.5 },
  "老影子升级应从 baseStats.E + perLevel 起步",
);
assert.ok(shadow.combatProfile(grown.shadow).atk > 1, "老影子折算不得退化为 atk=1");

// 5) 对比数据（格式固定，供 verify 日志留存）。
console.log(
  `Lv1 atk=${p1.atk} def=${p1.def.toFixed(1)} maxHp=${p1.maxHp}` +
    ` → Lv10 atk=${p10.atk} def=${p10.def.toFixed(1)} maxHp=${p10.maxHp}`,
);
console.log("OK");
process.exit(0);
