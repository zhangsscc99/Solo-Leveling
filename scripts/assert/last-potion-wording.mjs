#!/usr/bin/env node
// F153 最后一瓶补给播报契约（全是行为断言）：
//
//   qty=1 的栈被用掉时，回包不得写「剩余 ×0」（物品其实已从背包移除），
//   须写「用完」或「最后一瓶」——与丢弃路径「背包中已无此物」同一口径。
//   两条用药路径都钉住：
//   (a) POST /saves/:id/item op=use（背包直用通道）；
//   (b) POST /action 自由输入「使用道具 X」（脱战结算通道）；
//   (c) 对照：qty>1 时仍写「剩余 ×N」——正常余量播报不得被改坏。
//   每一步都核 GET /saves/:id 的 inventory：扣尽的栈必须消失。
//
//   落点/库存锻造走 DB 直写（同 gate-refusal-free.mjs 取径）。
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：qty-1===0 仍写「剩余 ×0」→ (a)(b) FAIL；用量尾注连
//   qty>1 的余量也吞掉 → (c) FAIL；栈没真删 → inventory 断言 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView, post } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const id = await makeSave("f153-last");
const setQty = (itemId, qty) =>
  db.prepare(
    "INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, ?) " +
      "ON CONFLICT(save_id, item_id) DO UPDATE SET qty = excluded.qty"
  ).run(id, itemId, qty);
const setVitals = (hp, mp) => db.prepare("UPDATE saves SET hp = ?, mp = ? WHERE id = ?").run(hp, mp, id);
const stackQty = async (itemId) => {
  const { inventory } = await fetchSaveView(id);
  const row = (inventory || []).find((r) => r.item_id === itemId);
  return row ? row.qty : 0;
};

function assertLastWording(text, tag) {
  assert(!text.includes("剩余 ×0"), `${tag} still reports「剩余 ×0」: ${text.slice(-160)}`);
  assert(/用完|最后一瓶/.test(text), `${tag} must say「用完/最后一瓶」: ${text.slice(-160)}`);
}

// ── (a) /item op=use 直用通道：qty=1 用掉 → 用完口径 + 栈消失 ──────────
setVitals(50, 5);
setQty("low_heal_potion", 1);
{
  const r = await post(`/saves/${id}/item`, { item_id: "low_heal_potion", op: "use" });
  assert(r.status === 200 && r.body && r.body.reply, `(a) op=use failed (HTTP ${r.status})`);
  assertLastWording(r.body.reply.content, "(a) op=use qty=1");
  assert(
    (await stackQty("low_heal_potion")) === 0,
    `(a) stack must be gone from inventory, still ${await stackQty("low_heal_potion")}`
  );
  console.log("    (a) /item op=use qty=1: 用完 wording, stack removed");
}

// ── (b) 「使用道具」脱战结算通道：qty=1 用掉 → 用完口径 + 栈消失 ────────
setVitals(50, 5);
setQty("mana_potion", 1);
{
  const r = await act(id, "使用道具 魔力药剂");
  assert(r.intent === "item", `(b)「使用道具 魔力药剂」expected intent=item, got ${JSON.stringify(r.intent)}`);
  assertLastWording(r.reply.content, "(b) free-input qty=1");
  assert(
    (await stackQty("mana_potion")) === 0,
    `(b) stack must be gone from inventory, still ${await stackQty("mana_potion")}`
  );
  console.log("    (b) /action 使用道具 qty=1: 用完 wording, stack removed");
}

// ── (c) 对照：qty=2 用掉 → 仍写「剩余 ×1」，栈按余量留存 ───────────────
setVitals(50, 5);
setQty("mana_potion", 2);
{
  const r = await post(`/saves/${id}/item`, { item_id: "mana_potion", op: "use" });
  assert(r.status === 200 && r.body && r.body.reply, `(c) op=use failed (HTTP ${r.status})`);
  assert(
    r.body.reply.content.includes("剩余 ×1"),
    `(c) qty=2 must still report「剩余 ×1」: ${r.body.reply.content.slice(-160)}`
  );
  assert(
    (await stackQty("mana_potion")) === 1,
    `(c) stack must remain at qty 1, got ${await stackQty("mana_potion")}`
  );
  console.log("    (c) qty=2: 剩余 ×1 wording intact");
}

db.close();
ok("OK");
