#!/usr/bin/env node
// F169 敌方阶段反应 e2e：真实交战打到结束，战斗日志应出现 ≥2 条互不相同
// 的敌人阶段反应句（HP 首破 50% / 25% 各一句）；阶段句只能落在
// 「【战斗】第N回合 …」叙述行末尾，不得混进「【战斗】X HP a→b」数值行；
// 击杀结算后 XP/金币 必须照常入账。
//   旧码必红：旧实现从不产出阶段句 → 收集数 0 < 2，直接 FAIL。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const { ENEMY_PHASE_TEMPLATES, enemyPhaseKind } = require(
  path.join(ROOT, "server", "engine", "combat.js")
);

const NAME = `F169-${Date.now().toString(36)}`;
const VITALS_RE = /(?:HP|MP)\s*\d+\s*→\s*\d+/;

// 该敌人的全部合法阶段句（{name} 替换为本名）——与引擎同一张表，
// 命中即认定是阶段反应句，绝不靠关键词瞎猜。
function phaseLinesFor(enemy) {
  const pool = ENEMY_PHASE_TEMPLATES[enemyPhaseKind(enemy || {})];
  const name = (enemy && enemy.name) || "敌人";
  return [...pool.half, ...pool.low].map((t) => t.replace(/\{name\}/g, name));
}

// 点行动栏按钮并等 /action 回包完整落地，返回响应 JSON。
async function tap(page, label) {
  const btn = page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    btn.click(),
  ]);
  await resp.finished().catch(() => {});
  await page.waitForTimeout(300);
  return resp.json().catch(() => null);
}

run("combat-enemy-phases", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");
  await page.waitForSelector(".input-row input");

  // 逐条收集交战回合播报；enemy 名取自同一条回包的 save.combat。
  const turns = []; // { enemy, content }
  let killReply = null;
  let lastEnemy = null;

  const note = (json) => {
    if (!json || !json.reply) return;
    const enemy = json.save && json.save.combat && json.save.combat.enemy
      ? json.save.combat.enemy
      : lastEnemy;
    if (json.save && json.save.combat && json.save.combat.enemy) lastEnemy = enemy;
    const content = json.reply.content || "";
    if (/第\s*\d+\s*回合/.test(content)) turns.push({ enemy, content });
    if (/击败.*获得/.test(content)) killReply = content;
  };

  // 至多打 6 场：场场磨到交战态清空（击杀/阵亡/脱战都算结束），
  // 攒够 2 条不同阶段句即可提前收工。
  const found = []; // { line, sentence }
  const seen = new Set();
  let inCombat = false;
  const scan = (j) => {
    const content = (j && j.reply && j.reply.content) || "";
    const enemy = lastEnemy;
    if (enemy) {
      for (const line of content.split("\n")) {
        for (const sentence of phaseLinesFor(enemy)) {
          if (line.includes(sentence)) {
            seen.add(sentence);
            found.push({ line, sentence });
          }
        }
      }
    }
    inCombat = Boolean(j && j.save && j.save.combat);
  };
  for (let battle = 0; battle < 6 && seen.size < 2; battle++) {
    // ── 连点「探索前进」直到交战（击杀冷却期前进只磨时钟，天然兼容）──
    for (let i = 0; i < 60 && !inCombat; i++) {
      const j = await tap(page, "探索前进");
      note(j);
      scan(j);
    }
    assert(inCombat, `battle ${battle}: 60 次「探索前进」仍未交战`);
    // ── 反复点「攻击」到战斗结束（击杀/阵亡/脱战都算收束）──
    for (let i = 0; i < 40 && inCombat; i++) {
      const j = await tap(page, "攻击");
      note(j);
      scan(j);
    }
  }

  assert(found.length >= 2, `战斗日志阶段反应句不足 2 条（实际 ${found.length}）`);
  assert(seen.size >= 2, `阶段反应句逐字重复（去重后 ${seen.size} 条）`);

  // 阶段句只能出现在回合叙述行，绝不许混进 HP/MP 数值行。
  for (const { line, sentence } of found) {
    assert(/第\s*\d+\s*回合/.test(line), `阶段句不在回合叙述行：${line}`);
    assert(!VITALS_RE.test(line), `阶段句混进数值行：${line}`);
  }
  // 反向：数值行里不得出现任何阶段句措辞（用本场敌人名全池比对）。
  for (const { enemy, content } of turns) {
    for (const line of content.split("\n")) {
      if (!VITALS_RE.test(line)) continue;
      for (const sentence of phaseLinesFor(enemy)) {
        assert(!line.includes(sentence), `数值行混入阶段句：${line}`);
      }
    }
  }

  // 发奖未破坏：至少一场以击杀收束，且播报带 XP/金币入账。
  assert(killReply, "没有任何一场战斗以击杀收束（无法验证发奖）");
  assert(/XP\s*\+\s*\d+/.test(killReply), `击杀播报缺 XP 入账：${killReply.slice(-160)}`);
  assert(/金币\s*\+\s*\d+/.test(killReply), `击杀播报缺金币入账：${killReply.slice(-160)}`);

  // 舞台日志同步可见（呈现层与回包同源）。
  const stage = await page.locator(".stage").innerText().catch(() => "");
  for (const { sentence } of found.slice(0, 2)) {
    assert(stage.includes(sentence), `阶段句未落到舞台日志：${sentence}`);
  }
});
