#!/usr/bin/env node
// F111（含 F099）技能面板预计伤害与引擎同源契约：
//   a) GET /saves/:id 每个技能都带 damage_preview{min,max}，
//      min<=max、min>0、max>power（不是把「威力」原样抄一遍）；
//   b) 同源一致性（防假绿）：直接调引擎 resolveTurn（真实结算路径），
//      按存档的真实面板（力量含装备折算、rank、技能 power/10 系数）
//      对章内两类小怪各放 N=30 次技能，所有真实伤害落点必须落在
//      [min-1, max+1] 内，且至少出现 2 个不同值（区间未退化成单点）；
//   c) 负向：技能渲染源码不再有裸「威力 {power}」单值展示，
//      SkillsPanel / CombatPanel / 行动栏技能条都输出「预计伤害」；
//   d) 战斗日志仍同源：真实 API 释放一次的「造成 X 点伤害」的 X
//      也落在服务端下发区间（交战态重取 preview，目标池含当前敌人）。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const combat = require("../../server/engine/combat.js");
const encounter = require("../../server/engine/encounter.js");

const id = await makeSave("skill-dmg-preview");
const doAct = (input) => act(id, input);

// ── (a) 存档技能视图：每个技能都有合法的 damage_preview ─────────────
const { save: save0, equipment: equip0 } = await fetchSaveView(id);
assert(Array.isArray(save0.skills) && save0.skills.length > 0, "save.skills missing");
for (const k of save0.skills) {
  const p = k.damage_preview;
  assert(
    p && Number.isInteger(p.min) && Number.isInteger(p.max),
    `${k.id} missing damage_preview{min,max}, got ${JSON.stringify(k.damage_preview)}`
  );
  assert(p.min <= p.max, `${k.id} min>max: ${JSON.stringify(p)}`);
  assert(p.min > 0, `${k.id} min<=0: ${JSON.stringify(p)}`);
  assert(
    p.max > k.power,
    `${k.id} damage_preview.max (${p.max}) must exceed power (${k.power}) — preview must not just echo 威力`
  );
}
const tiger = save0.skills.find((k) => k.id === "tiger_fury");
assert(tiger && tiger.unlocked === true, "fresh save should have tiger_fury unlocked");
const preview = tiger.damage_preview;

// ── (b) 同源一致性：引擎真实结算 30 次，全部落在 [min-1, max+1] ─────
// 玩家实体与 combatTurn 注入引擎的口径一致：sanitizeStats(stats) +
// 装备 atk/def 折算（atk/1.6 → 力量，def/0.8 → 体力）、rank、等级。
{
  const stats = { ...save0.stats };
  const atk = (equip0 && equip0.weapon && equip0.weapon.atk || 0) + (equip0 && equip0.armor && equip0.armor.atk || 0);
  const dfd = (equip0 && equip0.weapon && equip0.weapon.def || 0) + (equip0 && equip0.armor && equip0.armor.def || 0);
  stats.strength = (Number(stats.strength) || 0) + atk / 1.6;
  stats.vitality = (Number(stats.vitality) || 0) + dfd / 0.8;
  const player = {
    name: save0.player_name,
    level: save0.level,
    rank: save0.rank,
    hp: save0.hp,
    maxHp: save0.max_hp,
    mp: 9999,
    maxMp: 9999,
    stats,
  };
  // 章内目标池 = 服务端 preview 的同一批小怪模板（两类 def/rank 交替）。
  const ch = Math.max(1, Math.trunc(Number(save0.chapter) || 1));
  const table = encounter.CHAPTER_ENEMIES[ch] || encounter.CHAPTER_ENEMIES[8];
  const baseLv = encounter.mobLevel(ch);
  const mobs = (table.mobs || []).map((m) =>
    encounter.makeEnemy({
      ...m,
      level: baseLv + Math.max(0, Math.trunc(Number(m.levelBonus) || 0)),
      hp: 99999,
      xp: 1,
    })
  );
  assert(mobs.length >= 2, `chapter ${ch} mob pool too small for distribution check`);

  const skillArg = { name: tiger.name, mp_cost: tiger.mp_cost, power: tiger.power };
  const hits = [];
  for (let i = 0; i < 30; i++) {
    const enemy = mobs[i % mobs.length];
    const r = combat.resolveTurn(
      { turn: 1, player, enemy },
      "skill",
      `preview-assert-${i}`,
      { skill: skillArg }
    );
    for (const e of r.events) {
      if ((e.type === "hit" || e.type === "crit") && e.side === "player") hits.push(e.value);
    }
  }
  assert(hits.length >= 24, `too few landed hits in 30 engine casts: ${hits.length}`);
  for (const v of hits) {
    assert(
      v >= preview.min - 1 && v <= preview.max + 1,
      `engine-settled damage ${v} outside preview [${preview.min}, ${preview.max}] (same-source violation)`
    );
  }
  const distinct = new Set(hits);
  assert(
    distinct.size >= 2,
    `preview range degenerate: ${hits.length} casts produced only ${JSON.stringify([...distinct])}`
  );
  console.log(
    `[ASSERT] 30 engine casts -> ${hits.length} hits, ` +
      `distribution ${JSON.stringify([...distinct].sort((a, b) => a - b))} within [${preview.min}, ${preview.max}]`
  );
}

// ── (d) 战斗日志同源：真实 API 释放一次，播报伤害在区间内 ──────────
// 先引战（攻击掷遭遇，保底必中），交战态重取 preview（目标池含当前
// 敌人，区间必然覆盖本次落点），miss 则耗冷却后重试。
{
  let cur = null;
  for (let i = 0; i < 12 && !(cur && cur.save.combat); i++) {
    cur = await doAct("攻击");
    if (!cur.save.combat) cur = await doAct("前进");
  }
  assert(cur && cur.save.combat, "setup: no encounter within budget");

  let logged = null;
  for (let attempt = 0; attempt < 40 && !logged; attempt++) {
    const { save: s } = await fetchSaveView(id);
    if (!s.combat) {
      for (let i = 0; i < 12 && !cur.save.combat; i++) {
        cur = await doAct("攻击");
        if (!cur.save.combat) cur = await doAct("前进");
      }
      assert(cur.save.combat, "setup: cannot re-engage for log check");
      continue;
    }
    const meta = (s.skills || []).find((k) => k.id === "tiger_fury");
    if (!(meta && meta.can_cast)) {
      // 冷却中防御耗回合；MP 不足喝魔力药剂；都不成立则攻击推进。
      if (meta && meta.reason === "MP 不足") cur = await doAct("使用道具 魔力药剂");
      else cur = await doAct("防御");
      continue;
    }
    const r = await doAct(`释放技能 ${meta.name}`);
    const m = String(r.reply.content).match(/「[^」]+」[^·]*?造成 (\d+) 点伤害/);
    if (m) {
      const p = meta.damage_preview;
      assert(
        p && Number(m[1]) >= p.min && Number(m[1]) <= p.max,
        `log damage ${m[1]} outside engaged preview [${p && p.min}, ${p && p.max}]: ${r.reply.content.slice(0, 160)}`
      );
      logged = Number(m[1]);
    } else {
      cur = r; // miss：本轮无伤害数字，耗冷却后再试
    }
  }
  assert(logged !== null, "never landed a real API skill cast within 40 actions");
  console.log(`[ASSERT] real API cast dealt ${logged}, within preview range`);
}

// ── (c) 负向：技能渲染源码不再有裸「威力 {power}」单值展示 ─────────
{
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const files = [
    "client/src/panels/SkillsPanel.tsx",
    "client/src/panels/CombatPanel.tsx",
    "client/src/App.tsx",
  ];
  const barePower = /威力\s*\{[^}]*\.power[^}]*\}/;
  for (const f of files) {
    const src = readFileSync(`${root}${f}`, "utf8");
    assert(
      !barePower.test(src),
      `${f} still renders bare 威力 {power} — players would keep estimating damage from power`
    );
    assert(/预计伤害/.test(src), `${f} missing 预计伤害 range rendering`);
  }
}

ok("OK");
