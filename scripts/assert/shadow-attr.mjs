#!/usr/bin/env node
// F072 contract: 影子成长接入五项属性 —— growth.perLevel/baseStats 只用
// stats.js STAT_KEYS，grantXp 的成长经 sanitizeStats 不被清零，
// combatProfile 折算随等级严格递增。
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
//    五项都按 perLevel 增长、结果无 atk/def/hp 键、sanitizeStats 不清零。
const cfg = shadow.loadConfig();
const lv1 = { level: 1, xp: 0, stats: { ...cfg.growth.baseStats.E } };

let need = 0;
for (let lv = 1; lv < 10; lv += 1) need += shadow.xpForLevel(lv, cfg);
const res = shadow.grantXp(lv1, need, cfg);
assert.equal(res.shadow.level, 10, `应升到 Lv.10，实际 Lv.${res.shadow.level}`);

for (const key of STAT_KEYS) {
  const expected = cfg.growth.baseStats.E[key] + cfg.growth.perLevel[key] * 9;
  assert.equal(
    res.shadow.stats[key],
    expected,
    `${key} 应为 baseStats.E + perLevel × 9 = ${expected}`,
  );
}
for (const k of ["atk", "def", "hp"]) {
  assert.ok(!(k in res.shadow.stats), `升级结果仍含旧键 ${k}`);
}
assert.ok(
  sum(statsLib.sanitizeStats(res.shadow)) > sum(statsLib.sanitizeStats(lv1)),
  "sanitizeStats 后五项总和必须大于 Lv.1（旧实现此处为 0）",
);

// 3) combatProfile：Lv.1 → Lv.10 的 atk / def / maxHp 严格递增。
const p1 = shadow.combatProfile(lv1);
const p10 = shadow.combatProfile(res.shadow);
assert.ok(p10.atk > p1.atk, `atk 未递增（${p1.atk} → ${p10.atk}）`);
assert.ok(p10.def > p1.def, `def 未递增（${p1.def} → ${p10.def}）`);
assert.ok(p10.maxHp > p1.maxHp, `maxHp 未递增（${p1.maxHp} → ${p10.maxHp}）`);

// 4) 对比数据（格式固定，供 verify 日志留存）。
console.log(
  `Lv1 atk=${p1.atk} def=${p1.def.toFixed(1)} maxHp=${p1.maxHp}` +
    ` → Lv10 atk=${p10.atk} def=${p10.def.toFixed(1)} maxHp=${p10.maxHp}`,
);
console.log("OK");
process.exit(0);
