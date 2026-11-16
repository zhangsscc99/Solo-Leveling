#!/usr/bin/env node
// F154 item 意图收窄契约（全是行为断言）：
//
//   脱战态：
//   (a) 「喝水」「使用钥匙开门」「喝彩」——intent 不得为 item（回落
//       unknown），且三条输完库存数量零变化（旧码「喝水」经模糊匹配
//       真烧掉一瓶治疗药水）；
//   (b) 「使用治疗药水」「喝魔力药剂」——仍归 item 并真实生效：
//       HP / MP 上升，对应栈 qty 各 -1。
//
//   落点/库存锻造走 DB 直写（同 free-input-intent.mjs 取径）。
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：item 正则退回 `使用(?!技能)`/喝X水 → (a) intent/库存
//   断言 FAIL；收窄过头把「使用治疗药水」也拦了 → (b) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const id = await makeSave("f154-narrow");
db.prepare("UPDATE saves SET hp = 50, mp = 5 WHERE id = ?").run(id);

const invMap = async () => {
  const { inventory } = await fetchSaveView(id);
  return Object.fromEntries((inventory || []).map((r) => [r.item_id, r.qty]));
};

// ── (a) 非补给输入：intent≠item，库存零变化 ───────────────────────────
const before = await invMap();
for (const input of ["喝水", "使用钥匙开门", "喝彩"]) {
  const r = await act(id, input);
  assert(
    r.intent !== "item",
    `(a)「${input}」resolved to item — supply narrowing regressed: ${JSON.stringify(r.intent)} :: ${r.reply.content.slice(-120)}`
  );
}
const after = await invMap();
assert(
  JSON.stringify(before) === JSON.stringify(after),
  `(a) inventory changed on non-supply inputs: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`
);
console.log("    (a) 喝水/使用钥匙开门/喝彩: intent≠item, inventory untouched");

// ── (b) 真补给输入：仍归 item 并结算 ──────────────────────────────────
const hp0 = (await fetchSaveView(id)).save.hp;
const r1 = await act(id, "使用治疗药水");
assert(r1.intent === "item", `(b)「使用治疗药水」expected intent=item, got ${JSON.stringify(r1.intent)}`);
assert(r1.save.hp > hp0, `(b) heal must apply: ${hp0} -> ${r1.save.hp}`);

const mp0 = r1.save.mp;
const r2 = await act(id, "喝魔力药剂");
assert(r2.intent === "item", `(b)「喝魔力药剂」expected intent=item, got ${JSON.stringify(r2.intent)}`);
assert(r2.save.mp > mp0, `(b) mana must apply: ${mp0} -> ${r2.save.mp}`);

const inv = await invMap();
assert(
  (inv.low_heal_potion || 0) === (before.low_heal_potion || 0) - 1,
  `(b) low_heal_potion must be -1: ${before.low_heal_potion} -> ${inv.low_heal_potion}`
);
assert(
  (inv.mana_potion || 0) === (before.mana_potion || 0) - 1,
  `(b) mana_potion must be -1: ${before.mana_potion} -> ${inv.mana_potion}`
);
console.log(`    (b) 使用治疗药水 HP ${hp0}→${r1.save.hp} · 喝魔力药剂 MP ${mp0}→${r2.save.mp}, stacks -1 each`);

db.close();
ok("OK");
