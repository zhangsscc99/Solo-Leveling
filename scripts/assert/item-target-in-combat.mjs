#!/usr/bin/env node
// F144 交战补给契约（全是行为断言）：
//
//   (a) 交战态输「使用治疗药水」（不带「道具」字眼的点名说法）→ intent=item、
//       低级治疗药水栈 -1、MP 不变、HP 上升；
//   (b) HP 60% / MP 100% 时裸「使用道具」→ 选治疗类：低级治疗药水 -1、
//       魔力药剂数量不变；
//   (c) HP 60% / MP 80% 时裸「使用道具」→ HP 缺口百分比更大仍选治疗类——
//       旧码按「回复量总和最低」会烧魔力药剂（30 < 40），本条在旧码上必红；
//   (d) 交战态「使用不存在的药水名」→ refused 且零消耗：回合不动、
//       库存/HP/MP/scene 全不变；
//   (e) 「释放技能 猛虎猛击」「使用技能 猛虎猛击」不得被 item 意图抢走
//       （落 skill 门禁或正常结算，绝不走 item 结算烧补给）。
//
// 交战态由 DB 直写锻造：敌人力量 1 → 物理伤害被玩家减伤压到下限 1，
// 敏捷 0 → 先手必输；治疗 +40 vs 反击至多 -1，HP 净上升不赌种子。
//
// API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
// DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, get, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

function forge(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
}

function forgeCombat(id, seq) {
  const enemy = {
    id: "f144_puppet",
    name: "训练木偶",
    rank: "E",
    level: 1,
    hp: 999,
    maxHp: 999,
    xp: 1,
    boss: false,
    atk: 1,
    def: 0,
    seq,
    stats: { strength: 1, agility: 0, vitality: 1, intelligence: 0, perception: 0 },
  };
  db.prepare(
    "INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1) " +
      "ON CONFLICT(save_id) DO UPDATE SET enemy_json = excluded.enemy_json, turn = 1"
  ).run(id, JSON.stringify(enemy));
}

async function newSave(tag) {
  const name = `F144-${tag}-${Date.now().toString(36)}`.slice(0, 20);
  const { status, body } = await post("/saves", { player_name: name });
  assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
  return body.save.id;
}

async function invQty(id, itemId) {
  const { inventory } = await fetchSaveView(id);
  const row = (inventory || []).find((r) => r.item_id === itemId);
  return row ? row.qty : 0;
}

// ── (a) 交战态「使用治疗药水」：点名生效 ─────────────────────────
{
  const id = await newSave("a");
  forge(id, { hp: 55, mp: 10 });
  forgeCombat(id, 9101);
  const healBefore = await invQty(id, "low_heal_potion");
  const manaBefore = await invQty(id, "mana_potion");
  assert(healBefore >= 1, "(a) setup: no low_heal_potion in starter kit");

  const r = await act(id, "使用治疗药水");
  assert(r.intent === "item", `(a) intent 期望 item，实际 ${JSON.stringify(r.intent)}`);
  assert(r.refused !== true, `(a)「使用治疗药水」被拒：${r.reply.content.slice(0, 160)}`);
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore - 1,
    `(a) 低级治疗药水栈未 -1：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(
    (await invQty(id, "mana_potion")) === manaBefore,
    `(a) 魔力药剂被误烧：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  assert(
    r.save.mp === 10,
    `(a) MP 不得变化：10 -> ${r.save.mp}`
  );
  assert(
    r.save.hp > 55,
    `(a) HP 未上升：55 -> ${r.save.hp}（木偶反击至多 -1，治疗 +40 必净回）`
  );
  assert(
    r.reply.content.includes("低级治疗药水"),
    `(a) 播报未点名所选物品：${r.reply.content.slice(0, 200)}`
  );
  console.log("[OK] (a) 交战态「使用治疗药水」点名生效：治疗 -1、MP 不变、HP 上升");
}

// ── (b) HP 60% / MP 100% 裸「使用道具」：不得消耗魔力药剂 ────────
{
  const id = await newSave("b");
  forge(id, { hp: 60, mp: 20 });
  forgeCombat(id, 9102);
  const manaBefore = await invQty(id, "mana_potion");
  const healBefore = await invQty(id, "low_heal_potion");

  const r = await act(id, "使用道具");
  assert(r.refused !== true, `(b) 裸「使用道具」被拒：${r.reply.content.slice(0, 160)}`);
  assert(
    (await invQty(id, "mana_potion")) === manaBefore,
    `(b) MP 满值时不许消耗魔力药剂：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore - 1,
    `(b) 应选治疗类补给：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(
    r.reply.content.includes("低级治疗药水"),
    `(b) 播报未点名所选物品：${r.reply.content.slice(0, 200)}`
  );
  console.log("[OK] (b) HP60%/MP100% 裸「使用道具」选治疗类，魔力药剂零消耗");
}

// ── (c) HP 60% / MP 80% 裸「使用道具」：HP 缺口更大仍选治疗类 ─────
{
  const id = await newSave("c");
  forge(id, { hp: 60, mp: 16 });
  forgeCombat(id, 9103);
  const manaBefore = await invQty(id, "mana_potion");
  const healBefore = await invQty(id, "low_heal_potion");

  const r = await act(id, "使用道具");
  assert(r.refused !== true, `(c) 裸「使用道具」被拒：${r.reply.content.slice(0, 160)}`);
  assert(
    (await invQty(id, "mana_potion")) === manaBefore,
    `(c) HP 缺口更大时不许烧魔力药剂：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore - 1,
    `(c) 应按最缺选治疗类：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(r.save.hp > 60, `(c) HP 未上升：60 -> ${r.save.hp}`);
  console.log("[OK] (c) HP60%/MP80% 裸「使用道具」按最缺选治疗类");
}

// ── (d) 交战态点名不存在的药水：refused 且零消耗 ──────────────────
{
  const id = await newSave("d");
  forge(id, { hp: 50, mp: 10 });
  forgeCombat(id, 9104);
  const healBefore = await invQty(id, "low_heal_potion");
  const manaBefore = await invQty(id, "mana_potion");
  const sceneBefore = (await fetchSaveView(id)).save.scene;

  const r = await act(id, "使用不存在的药水名");
  assert(
    r.refused === true,
    `(d)「使用不存在的药水名」期望 refused=true，实际 ${JSON.stringify(r.refused)}（${(r.reply && r.reply.content || "").slice(0, 160)}）`
  );
  const after = (await fetchSaveView(id)).save;
  assert(after.hp === 50 && after.mp === 10, `(d) 拒绝动了数值：hp=${after.hp} mp=${after.mp}`);
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore &&
      (await invQty(id, "mana_potion")) === manaBefore,
    `(d) 拒绝消耗了库存`
  );
  assert(
    after.combat && after.combat.turn === 1,
    `(d) 拒绝消耗了回合：${JSON.stringify(after.combat)}`
  );
  assert(after.scene === sceneBefore, `(d) 拒绝挪了位置：${sceneBefore} -> ${after.scene}`);
  console.log("[OK] (d) 交战态点名不存在药水：refused、零消耗、不占回合");
}

// ── (e) 技能说法不被 item 抢走 ──────────────────────────────────
{
  const id = await newSave("e");
  forge(id, { hp: 50, mp: 20 });
  forgeCombat(id, 9105);
  const healBefore = await invQty(id, "low_heal_potion");
  for (const phrase of ["释放技能 猛虎猛击", "使用技能 猛虎猛击"]) {
    const r = await act(id, phrase);
    assert(
      r.intent === "skill",
      `(e)「${phrase}」期望 intent=skill，实际 ${JSON.stringify(r.intent)}`
    );
  }
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore,
    `(e) 技能输入被 item 结算烧掉了补给：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  console.log("[OK] (e)「释放技能」「使用技能」仍走 skill，未被 item 抢走");
}

// ── (f) MP 缺口更大时裸「使用道具」：选魔力药剂（回蓝方向覆盖）────────
{
  const id = await newSave("f");
  forge(id, { hp: 90, mp: 2 });
  forgeCombat(id, 9106);
  const manaBefore = await invQty(id, "mana_potion");
  const healBefore = await invQty(id, "low_heal_potion");
  assert(manaBefore >= 1, "(f) setup: no mana_potion in starter kit");

  const r = await act(id, "使用道具");
  assert(r.refused !== true, `(f) 裸「使用道具」被拒：${r.reply.content.slice(0, 160)}`);
  assert(
    (await invQty(id, "mana_potion")) === manaBefore - 1,
    `(f) MP 缺口更大时应选魔力药剂：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore,
    `(f) 不许烧治疗类补给：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(r.save.mp > 2, `(f) MP 未上升：2 -> ${r.save.mp}`);
  assert(
    r.reply.content.includes("魔力药剂"),
    `(f) 播报未点名所选物品：${r.reply.content.slice(0, 200)}`
  );
  console.log("[OK] (f) MP 缺口更大时裸「使用道具」选魔力药剂：mana -1、治疗不动、MP 上升");
}

ok("item-target-in-combat PASS");
