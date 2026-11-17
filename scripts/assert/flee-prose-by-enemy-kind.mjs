#!/usr/bin/env node
// F131 撤离文案按（敌型, boss_cleared）分支契约（全是行为断言）：
//
//   (a) 普通遭遇（非 boss 怪）撤离成功 → 回包不得含「守关者」「残骸」，
//       写「它没有追出来」这类中性收尾；
//   (b) 已击杀守关者（boss_cleared 含本章）的守关战撤离 → 收尾可以谈
//       「残骸」——它被真杀过，凝聚的确实是残骸；
//   (c) 未击杀守关者的守关战撤离 → 它「仍守在门后」（含「门后」），
//       同样不得提前说「残骸」。
//
//   交战态/击杀标记锻造走 DB 直写（combat 表一行即真实交战态，与
//   boss-room-escape 类断言同取径）：enemy_json 由遭遇引擎真模板生成
//   （spawnBoss / spawn），不手拼敌人字段。掷逃每回合 50%，逐回合重试
//   直至真实撤离成功；锻造高 HP 池保证失败回合不把人打死。
//
//   旧码必红：旧实现对「已清守关者」也只写「仍守在门后没有追出来」，
//   从不出现「残骸」→ (b) FAIL。
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

const PENALTY_GATE = "ch2_penalty_gate"; // 惩罚副本（毒牙蛇守关房的前一景）
const PENALTY_BOSS = "ch2_poison_fang"; // 守关房（毒牙蛇）
const CH2_ID = "ch2";

function forge(id, { scene, cleared, enemy }) {
  db.prepare(
    "UPDATE saves SET chapter = 2, scene = ?, level = 30, hp = 5000, max_hp = 5000, " +
      "boss_cleared_json = ?, encounter_clock = 0, encounter_cd = 0 WHERE id = ?"
  ).run(scene, JSON.stringify(cleared), id);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  db.prepare("INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1)").run(
    id,
    JSON.stringify(enemy)
  );
}

// 掷逃直至真实脱离（combat 行被清且 hp>0）；阵亡说明锻造没扛住反击。
async function fleeUntilOut(id, tag, tries = 80) {
  for (let i = 0; i < tries; i++) {
    const r = await act(id, "逃跑");
    if (!r.save.combat) {
      assert(r.save.hp > 0, `${tag}: player died while fleeing (forged hp pool too small)`);
      return r;
    }
  }
  fail(`${tag}: flee never succeeded within ${tries} turns`);
}

const id = await makeSave("flee-prose");

// ── (a) 普通怪撤离：不许套「守关者/残骸」模板 ─────────────────────
{
  const mob = encounter.spawn(2, "assert-f131-mob");
  mob.seq = 1;
  forge(id, { scene: PENALTY_GATE, cleared: [], enemy: mob });
  const s0 = (await fetchSaveView(id)).save;
  assert(s0.combat && s0.combat.enemy && !s0.combat.enemy.boss, "(a) forged combat must be a mob");
  const r = await fleeUntilOut(id, "(a)");
  const content = r.reply.content || "";
  assert(
    !content.includes("守关者") && !content.includes("残骸"),
    `(a) mob flee must not borrow guardian/remains wording: ${content.slice(0, 240)}`
  );
  assert(
    content.includes("没有追出来") || content.includes("追出来"),
    `(a) mob flee should close with a 「它没有追出来」-style line: ${content.slice(0, 240)}`
  );
}

// ── (b) 已击杀守关者撤离：残骸措辞成立 ────────────────────────────
{
  const boss = encounter.spawnBoss(2);
  boss.seq = 2;
  forge(id, { scene: PENALTY_BOSS, cleared: [CH2_ID], enemy: boss });
  const s0 = (await fetchSaveView(id)).save;
  assert(
    s0.combat && s0.combat.enemy && s0.combat.enemy.boss === true,
    "(b) forged combat must be the guardian"
  );
  const r = await fleeUntilOut(id, "(b)");
  const content = r.reply.content || "";
  assert(
    content.includes("残骸"),
    `(b) fleeing a cleared guardian may speak of 残骸: ${content.slice(0, 240)}`
  );
}

// ── (c) 未击杀守关者撤离：它仍守在门后，不得说残骸 ────────────────
{
  const boss = encounter.spawnBoss(2);
  boss.seq = 3;
  forge(id, { scene: PENALTY_BOSS, cleared: [], enemy: boss });
  const r = await fleeUntilOut(id, "(c)");
  const content = r.reply.content || "";
  assert(
    content.includes("门后"),
    `(c) fleeing a living guardian must say it 仍守在门后: ${content.slice(0, 240)}`
  );
  assert(
    !content.includes("残骸"),
    `(c) a guardian never killed leaves no 残骸: ${content.slice(0, 240)}`
  );
}

db.close();
ok("OK");
