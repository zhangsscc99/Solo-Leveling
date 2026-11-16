#!/usr/bin/env node
// F145 脱战补给契约（全是行为断言）：
//
//   (a) 脱战残血输「使用道具」→ HP 上升、治疗类补给 -1、scene 不变、
//       日志新增两条（user 输入 + system 回包）、不触发交战；
//   (b) 脱战输「喝治疗药水」→ 同样生效（intent=item，不再落未识别）；
//   (c) 满血满蓝输「使用道具」→ refused、零消耗、零日志；
//   (d) 拒绝回包必须附带恢复通道指路：含剩余休息次数（「休息 x/3」形态）
//       与一条真实可达的恢复方式，不得只说「留到战斗再用」；
//   (e) 背包无补给时拒绝同样指路。
//
// 残血由 DB 直写锻造（UPDATE saves SET hp），断言脚本与服务端共用同一
// DB_PATH 时要显式传。
// API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
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

async function newSave(tag) {
  const name = `F145-${tag}-${Date.now().toString(36)}`.slice(0, 20);
  const { status, body } = await post("/saves", { player_name: name });
  assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
  return body.save.id;
}

async function invQty(id, itemId) {
  const { inventory } = await fetchSaveView(id);
  const row = (inventory || []).find((r) => r.item_id === itemId);
  return row ? row.qty : 0;
}

async function logRows(id) {
  const r = await get(`/saves/${id}/log?limit=400`);
  assert(r.status === 200 && Array.isArray(r.body.log), `log fetch failed (HTTP ${r.status})`);
  return r.body.log;
}

// ── (a) 脱战残血「使用道具」：真回血、真扣库存、日志两条 ───────────
{
  const id = await newSave("a");
  forge(id, { hp: 50 });
  const before = (await fetchSaveView(id)).save;
  assert(before.combat === null, "(a) setup: fresh save unexpectedly in combat");
  const sceneBefore = before.scene;
  const healBefore = await invQty(id, "low_heal_potion");
  const manaBefore = await invQty(id, "mana_potion");
  const logsBefore = (await logRows(id)).length;

  const r = await act(id, "使用道具");
  assert(r.intent === "item", `(a) intent 期望 item，实际 ${JSON.stringify(r.intent)}`);
  assert(
    r.refused !== true,
    `(a) 脱战残血「使用道具」被拒：${r.reply.content.slice(0, 200)}`
  );
  assert(r.save.hp > 50, `(a) HP 未上升：50 -> ${r.save.hp}`);
  assert(
    r.save.scene === sceneBefore && r.save.chapter === before.chapter,
    `(a) 补给挪了位置：${sceneBefore}(ch${before.chapter}) -> ${r.save.scene}(ch${r.save.chapter})`
  );
  assert(r.save.combat === null, `(a) 补给掷出了交战：${JSON.stringify(r.save.combat)}`);
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore - 1,
    `(a) 治疗类补给未 -1：${healBefore} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(
    (await invQty(id, "mana_potion")) === manaBefore,
    `(a) MP 已满不许烧魔力药剂：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  const logs = await logRows(id);
  assert(
    logs.length === logsBefore + 2,
    `(a) 日志应新增两条（user+system）：${logsBefore} -> ${logs.length}`
  );
  const last2 = logs.slice(-2);
  assert(
    last2[0].role === "user" && last2[0].content === "使用道具",
    `(a) 倒数第二条日志应为 user「使用道具」：${JSON.stringify(last2[0]).slice(0, 160)}`
  );
  assert(
    last2[1].role === "system" && last2[1].content.includes("低级治疗药水"),
    `(a) 末条日志应为点名所选物品的 system 回包：${JSON.stringify(last2[1]).slice(0, 200)}`
  );

  // ── (b) 同档脱战「喝治疗药水」：点名说法同样生效 ────────────────
  forge(id, { hp: 40 });
  const healB = await invQty(id, "low_heal_potion");
  const sceneB = (await fetchSaveView(id)).save.scene;
  const rb = await act(id, "喝治疗药水");
  assert(
    rb.intent === "item",
    `(b)「喝治疗药水」期望 intent=item，实际 ${JSON.stringify(rb.intent)}（${rb.reply.content.slice(0, 160)}）`
  );
  assert(
    rb.refused !== true && rb.save.hp > 40,
    `(b)「喝治疗药水」未生效：refused=${rb.refused} hp 40 -> ${rb.save.hp}`
  );
  assert(
    (await invQty(id, "low_heal_potion")) === healB - 1,
    `(b) 低级治疗药水栈未 -1：${healB} -> ${await invQty(id, "low_heal_potion")}`
  );
  assert(rb.save.scene === sceneB, `(b) 补给挪了位置：${sceneB} -> ${rb.save.scene}`);
  assert(rb.save.combat === null, `(b) 补给掷出了交战`);
  assert(
    rb.reply.content.includes("低级治疗药水"),
    `(b) 播报未点名所选物品：${rb.reply.content.slice(0, 200)}`
  );
  console.log("[OK] (a)(b) 脱战残血「使用道具」「喝治疗药水」真回血、真扣库存、场景不动");
}

// ── (c)(d) 满血满蓝「使用道具」：refused、零消耗、指路恢复通道 ──────
{
  const id = await newSave("c");
  const before = (await fetchSaveView(id)).save;
  assert(
    before.hp === before.max_hp && before.mp === before.max_mp,
    `(c) setup: want full vitals, got ${before.hp}/${before.max_hp} hp, ${before.mp}/${before.max_mp} mp`
  );
  const healBefore = await invQty(id, "low_heal_potion");
  const manaBefore = await invQty(id, "mana_potion");
  const logsBefore = (await logRows(id)).length;

  const r = await act(id, "使用道具");
  assert(
    r.refused === true,
    `(c) 满状态「使用道具」期望 refused=true，实际 ${JSON.stringify(r.refused)}（${r.reply.content.slice(0, 160)}）`
  );
  assert(
    r.save.hp === before.hp && r.save.mp === before.mp,
    `(c) 拒绝动了数值：${before.hp}/${before.mp} -> ${r.save.hp}/${r.save.mp}`
  );
  assert(
    (await invQty(id, "low_heal_potion")) === healBefore &&
      (await invQty(id, "mana_potion")) === manaBefore,
    `(c) 拒绝消耗了库存`
  );
  const logs = await logRows(id);
  assert(logs.length === logsBefore, `(c) 拒绝写了日志：${logsBefore} -> ${logs.length}`);
  const text = r.reply.content;
  assert(
    /休息\s*\d+\s*\/\s*3/.test(text),
    `(d) 拒绝回包缺「休息 x/3」指路：${text.slice(-200)}`
  );
  assert(
    /说「休息」|回溯|恢复/.test(text),
    `(d) 拒绝回包缺可达恢复方式：${text.slice(-200)}`
  );
  console.log("[OK] (c)(d) 满状态拒绝：refused、零消耗、回包含休息配额与恢复指路");
}

// ── (e) 背包清空补给后「使用道具」：refused 仍指路 ────────────────
{
  const id = await newSave("e");
  forge(id, { hp: 50 });
  // 清空全部背包（含装备素材），确保没有任何 consumable 可用。
  db.prepare("DELETE FROM inventory WHERE save_id = ?").run(id);
  const r = await act(id, "使用道具");
  assert(
    r.refused === true,
    `(e) 空背包「使用道具」期望 refused=true，实际 ${JSON.stringify(r.refused)}（${r.reply.content.slice(0, 160)}）`
  );
  const text = r.reply.content;
  assert(
    /休息\s*\d+\s*\/\s*3/.test(text),
    `(e) 拒绝回包缺「休息 x/3」指路：${text.slice(-200)}`
  );
  assert(
    /说「休息」|回溯|恢复/.test(text),
    `(e) 拒绝回包缺可达恢复方式：${text.slice(-200)}`
  );
  assert(
    !text.includes("留到") && !text.includes("未识别"),
    `(e) 拒绝文案不得只说「留到战斗再用」或落未识别：${text.slice(-200)}`
  );
  console.log("[OK] (e) 空背包拒绝仍指路：含休息配额与可达恢复方式");
}

// ── (f) HP 残 / MP 满 / 只剩魔力药剂：拒绝文案按真实缺口说，不得谎称满格 ──
{
  const id = await newSave("f");
  const view = (await fetchSaveView(id)).save;
  forge(id, { hp: 50, mp: view.max_mp });
  // 只留魔力药剂：清掉治疗类（含装备素材一并删，确保 usable 只剩回魔）。
  db.prepare("DELETE FROM inventory WHERE save_id = ? AND item_id != 'mana_potion'").run(id);
  const manaBefore = await invQty(id, "mana_potion");
  assert(manaBefore >= 1, "(f) setup: no mana_potion in starter kit");
  const logsBefore = (await logRows(id)).length;

  const r = await act(id, "使用道具");
  assert(
    r.refused === true,
    `(f) HP 残/MP 满只剩回魔「使用道具」期望 refused=true，实际 ${JSON.stringify(r.refused)}（${r.reply.content.slice(0, 160)}）`
  );
  assert(
    (await invQty(id, "mana_potion")) === manaBefore,
    `(f) 拒绝消耗了库存：${manaBefore} -> ${await invQty(id, "mana_potion")}`
  );
  const logs = await logRows(id);
  assert(logs.length === logsBefore, `(f) 拒绝写了日志：${logsBefore} -> ${logs.length}`);
  const text = r.reply.content;
  assert(
    !/满格/.test(text),
    `(f) HP 只有一半不得谎称「满格」：${text.slice(0, 200)}`
  );
  assert(
    /回魔|魔力/.test(text),
    `(f) 拒绝回包应说明只剩回魔类/缺的是体力：${text.slice(0, 200)}`
  );
  assert(
    /休息\s*\d+\s*\/\s*3/.test(text),
    `(f) 拒绝回包缺「休息 x/3」指路：${text.slice(-200)}`
  );
  console.log("[OK] (f) HP 残/MP 满只剩回魔：refused 如实说缺口，无「满格」字样");
}

ok("out-of-combat-supply PASS");
