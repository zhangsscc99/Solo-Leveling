#!/usr/bin/env node
// F107 / F094 交战期换装与加点门禁（负向断言 + 正向路径，缺一不可）：
//   交战态（同一存档、真实交战）：
//     1) POST /saves/:id/item {op:"equip"} → 必须被拒（HTTP 非 2xx 或
//        refused===true）；若装备被放行则 FAIL。拒后不得有任何副作用：
//        stats 五项属性不变、装备位（weapon/armor）不变、战斗回合数不变。
//     2) POST /saves/:id/spend {stat:"strength"}（free_points>0 前提下）
//        → 必须被拒且回包 refused===true；stats 与 free_points 零变化。
//   非交战态（同一存档脱离战斗后）——正向路径必须存在，否则把门禁判定
//     改成恒 true（全部拒绝）也会让负向断言全绿，属于假绿：
//     3) equip 必须成功：装备位真实落位、面板攻击/防御加成真实变化；
//     4) spend 必须成功：free_points -1、目标属性 +1。
// 变异敏感口径：若未来有人删掉 server/index.js 里 spend/equip 的
//   store.getCombat(save.id) 门禁，本脚本在 (1)(2) 段必须变红。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, makeSave, act, fetchSaveView, clearCombat } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const ITEMS = require(path.join(ROOT, "server", "data", "items.json"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const KNIFE = ITEMS.find((i) => i.id === "rusty_hunting_knife");
assert(KNIFE && KNIFE.atk > 0, "oracle: rusty_hunting_knife missing atk in items.json");

const id = await makeSave("combat-equip-gate");
const doAct = (input) => act(id, input);

// equipment.json 是按 save_id 留存的边车文件，不随删档/换库清理——全新
// scratch DB 回收到的 id 可能继承旧装备位（残留武器 atk 高于猎刀时，
// 正向断言「atk 增大」会假红）；且 F147 起新档本身自带配发装备。
// 没有 unequip op——清空走真实 discard：每次真扣 1 件，qty 扣到 0 服务端
// clearSlot；背包没货时先 DB 塞一件凑 discard 前置（qty>0），绝不再
// 「塞一件丢一件」空转（F147 配发品 bag qty>=1，旧写法 qty 永远回不到 0）。
async function clearEquipSlots() {
  for (const slot of ["weapon", "armor"]) {
    for (let t = 0; t < 8; t++) {
      const view = await fetchSaveView(id);
      const eq = view.equipment && view.equipment[slot];
      if (!eq || !eq.item_id) break;
      const owned = (view.inventory || []).find(
        (r) => r.item_id === eq.item_id && Number(r.qty) > 0
      );
      if (!owned) {
        db.prepare(
          "INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, 1) " +
            "ON CONFLICT(save_id, item_id) DO UPDATE SET qty = qty + 1"
        ).run(id, eq.item_id);
      }
      const { status } = await post(`/saves/${id}/item`, { item_id: eq.item_id, op: "discard" });
      assert(status === 200, `setup: discard stale ${slot}「${eq.item_id}」failed (HTTP ${status})`);
    }
  }
}

{
  await clearEquipSlots();
  const cleared = await fetchSaveView(id);
  assert(
    !cleared.equipment.weapon && !cleared.equipment.armor,
    `setup: stale equipment not cleared: ${JSON.stringify(cleared.equipment)}`
  );
  // 交战中被拒的 equip 必须真正打到 getCombat 门禁——包里得有刀，否则
  // 400「item not in inventory」在 qty 检查就被拦下，门禁被删也看不
  // 出来（假绿）。补足 1 把；注意下一次 GET 的 ensureStarterKit 会把它
  // 自动穿回武器位（F147 口径）——交战期装备基线 = 猎刀已穿上。
  db.prepare(
    "INSERT INTO inventory (save_id, item_id, qty) VALUES (?, 'rusty_hunting_knife', 1) " +
      "ON CONFLICT(save_id, item_id) DO UPDATE SET qty = MAX(qty, 1)"
  ).run(id);
}

// 前置：留出可分配的自由点（spend 正向/负向都要先决条件 free_points>0）。
db.prepare("UPDATE saves SET free_points = 3 WHERE id = ?").run(id);
{
  const s = (await fetchSaveView(id)).save;
  assert(s.free_points === 3, `setup: free_points 落点失败，got ${s.free_points}`);
  const inv = (await fetchSaveView(id)).inventory;
  assert(
    (inv || []).some((r) => r.item_id === "rusty_hunting_knife" && r.qty > 0),
    "setup: starter kit missing rusty_hunting_knife"
  );
}

// ── A) 交战态：equip 与 spend 都必须被拒，且零副作用 ─────────────
// 真实交战：新档原地「攻击」≤10 次必然触发遭遇（F088 契约）。
let cur = null;
for (let i = 0; i < 10 && !(cur && cur.save.combat); i++) cur = await doAct("攻击");
assert(cur && cur.save.combat, "setup: no encounter within 10 攻击 actions");

const viewBefore = await fetchSaveView(id);
const statsBefore = viewBefore.save.stats;
const equipBefore = viewBefore.equipment;
const turnBefore = viewBefore.save.combat.turn;
const freeBefore = viewBefore.save.free_points;

// 1) 交战中换装：必须被拒——若服务端放行 equip（门禁被删/恒 false），
//    这里立即 FAIL；被拒后装备位/属性/回合数一律不得变化。
{
  const { status, body } = await post(`/saves/${id}/item`, {
    item_id: "rusty_hunting_knife",
    op: "equip",
  });
  assert(
    !(status >= 200 && status < 300) || (body && body.refused === true),
    `equip must be refused during combat (HTTP ${status}, body=${JSON.stringify(body || {}).slice(0, 160)})`
  );
  const v = await fetchSaveView(id);
  assert(v.save.combat, "combat vanished after refused equip");
  assert(
    sameJson(v.save.stats, statsBefore),
    `refused equip mutated stats: ${JSON.stringify(statsBefore)} -> ${JSON.stringify(v.save.stats)}`
  );
  assert(
    sameJson(v.equipment, equipBefore),
    `refused equip mutated equipment slots: ${JSON.stringify(equipBefore)} -> ${JSON.stringify(v.equipment)}`
  );
  assert(
    v.save.combat.turn === turnBefore,
    `refused equip consumed a combat turn: ${turnBefore} -> ${v.save.combat.turn}`
  );
}

// 2) 交战中加点：必须被拒且 refused===true；free_points 与 stats 零变化。
{
  const { status, body } = await post(`/saves/${id}/spend`, { stat: "strength" });
  assert(
    !(status >= 200 && status < 300) && body && body.refused === true,
    `spend must be refused with refused===true during combat (HTTP ${status})`
  );
  const v = await fetchSaveView(id);
  assert(
    sameJson(v.save.stats, statsBefore),
    `refused spend mutated stats: ${JSON.stringify(statsBefore)} -> ${JSON.stringify(v.save.stats)}`
  );
  assert(
    v.save.free_points === freeBefore,
    `refused spend consumed a point: ${freeBefore} -> ${v.save.free_points}`
  );
  if (v.save.combat) {
    assert(
      v.save.combat.turn === turnBefore,
      `refused spend consumed a combat turn: ${turnBefore} -> ${v.save.combat.turn}`
    );
  }
}

// ── B) 非交战态：equip/spend 正向路径必须真实生效 ────────────────
// 脱离战斗：先掷逃（不清场景），掷逃 20 次仍脱不了就真打清场。
for (let i = 0; i < 20; i++) {
  const s = (await fetchSaveView(id)).save;
  if (!s.combat) break;
  if (s.hp > 0 && s.hp <= Math.max(25, s.max_hp * 0.35)) {
    // 残血先防御保命再逃，阵亡也能自然脱战（回溯章首）。
    await doAct("防御");
  } else {
    await doAct("逃跑");
  }
}
{
  const s = (await fetchSaveView(id)).save;
  if (s.combat) await clearCombat(id);
}
const outView = await fetchSaveView(id);
assert(!outView.save.combat, "setup: still in combat after flee/clear");

// 交战期每次 GET 的 ensureStarterKit 已把包里的猎刀自动穿回武器位
// （F147：空槽+包里有配发品→自动穿）。正向「空 → knife」精确增量断言
// 要求槽位真空，再清一次——连同背包那份丢到 qty 0，否则下一次 GET
// 又会把它穿回去。
await clearEquipSlots();
{
  const c = await fetchSaveView(id);
  assert(
    !c.equipment.weapon && !c.equipment.armor,
    `setup: post-combat equipment not cleared: ${JSON.stringify(c.equipment)}`
  );
}

// 玩家可能阵亡（hp 重置）或 free_points 被花掉前已落点——重新确认
// free_points>0，不够就补一次 DB 落点（正向 spend 的先决条件）。
if ((Number(outView.save.free_points) || 0) <= 0) {
  db.prepare("UPDATE saves SET free_points = 1 WHERE id = ?").run(id);
}
const base = await fetchSaveView(id);
const statsBase = base.save.stats;
const freeBase = Number(base.save.free_points) || 0;
assert(freeBase > 0, "setup: no free_points for positive spend check");

// 3) equip 正向：200 + 武器位从空真实落位 + 面板攻/防加成精确增量
//    （setup 已把装备位清到真空，atk 增量必须恰好等于猎刀面板 atk，
//    残留装备位造成的「不增反降/假绿」两边都被钉死）。
{
  assert(
    !base.equipment.weapon,
    `setup: weapon slot should be empty after clearing, got ${JSON.stringify(base.equipment.weapon)}`
  );
  // post-combat 清仓把背包里的猎刀一并丢了——equip 前置 qty>0，补回 1 把。
  db.prepare(
    "INSERT INTO inventory (save_id, item_id, qty) VALUES (?, 'rusty_hunting_knife', 1) " +
      "ON CONFLICT(save_id, item_id) DO UPDATE SET qty = MAX(qty, 1)"
  ).run(id);
  const { status, body } = await post(`/saves/${id}/item`, {
    item_id: "rusty_hunting_knife",
    op: "equip",
  });
  assert(status === 200 && body && body.save, `equip out of combat must succeed (HTTP ${status})`);
  const v = await fetchSaveView(id);
  assert(
    v.equipment && v.equipment.weapon && v.equipment.weapon.item_id === "rusty_hunting_knife",
    `weapon slot not equipped after successful equip: ${JSON.stringify(v.equipment)}`
  );
  assert(
    (v.equipment.atk || 0) === (base.equipment.atk || 0) + KNIFE.atk,
    `equip atk bonus must increase by exactly knife atk ${KNIFE.atk}: ${base.equipment.atk} -> ${v.equipment.atk}`
  );
}

// 4) spend 正向：free_points -1、strength +1。
{
  const { status, body } = await post(`/saves/${id}/spend`, { stat: "strength" });
  assert(status === 200 && body && body.save, `spend out of combat must succeed (HTTP ${status})`);
  const v = await fetchSaveView(id);
  assert(
    v.save.free_points === freeBase - 1,
    `free_points ${freeBase} -> ${v.save.free_points} (expected -1)`
  );
  assert(
    (v.save.stats.strength || 0) === (statsBase.strength || 0) + 1,
    `strength ${statsBase.strength} -> ${v.save.stats.strength} (expected +1)`
  );
}

ok("OK");
