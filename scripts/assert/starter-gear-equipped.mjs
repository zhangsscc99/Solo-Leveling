#!/usr/bin/env node
// F147 contract: 建档配发的基础武器/防具自动穿戴（不再裸身出门）。
//   a) POST /saves 新档 → GET /saves/:id 的 equipment.weapon/armor 非空，
//      equipment.atk >= 4、def >= 2；攻击合计（floor(1.6×力量)+装备加成，
//      基础值从 save.stats 现算）> 基础攻击；
//   b) 背包里配发武器/防具栈仍在（自动穿戴不消耗背包物品）；
//   c) 日志含「已为你装备」且含实际武器名，原「配发基础装备」播报保留；
//   d) 幂等：重复打开背包不重复播报、装备不翻倍；
//   e) 老存档（DB 直插：配发品已在背包、equipment.json 无槽位，模拟
//      F147 上线前的档）走 ensureStarterKit（GET /saves/:id）后同样
//      自动装备。
// 依赖：API_BASE（游戏 API 根，含 /game/api 段）、DB_PATH（直插老存档）。
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, post, get } from "./_http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SERVER_DIR = path.resolve(HERE, "..", "..", "server");
const require = createRequire(import.meta.url);
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const Database = require("better-sqlite3");
const db = new Database(dbPath);

// equipment.json 是跨 DB 持久的边车文件：新库 save id 从 1 起，旧测试
// 留下的槽位会让 autoEquipStarterGear 误判「已装备」而跳过播报。
// 建档前清掉 id >= 即将分配的 save id 的残留键（保留真实旧档的键）。
let stalePurged = 0;
try {
  const m = Number(db.prepare("SELECT COALESCE(MAX(id),0) AS m FROM saves").get().m) || 0;
  const eqFile = path.resolve(SERVER_DIR, "data", "equipment.json");
  const map = JSON.parse(fs.readFileSync(eqFile, "utf8") || "{}");
  const kept = {};
  let maxKey = 0;
  for (const [k, v] of Object.entries(map)) {
    const id = Number(k);
    if (id > maxKey) maxKey = id;
    if (id >= m + 1) stalePurged += 1;
    else kept[k] = v;
  }
  if (stalePurged > 0) fs.writeFileSync(eqFile, JSON.stringify(kept, null, 2) + "\n");
  // server 启动时把 equipment.json 全量读进内存，之后只为真实 save 追加
  // 键——所以它此刻可能仍持有已被清掉的残留键。若新档 id 撞上内存里的
  // 残留槽位，autoEquipStarterGear 会误判「已装备」而跳过播报。saves 是
  // AUTOINCREMENT：插一行显式 id 再删掉即可把序列推到 maxKey 之后，让
  // 下一个 save id 必然大于任何残留键。
  if (maxKey >= m + 1) {
    const info = db
      .prepare("INSERT INTO saves (id, player_name, stats_json) VALUES (?, ?, ?)")
      .run(maxKey, `F147-bump-${Date.now().toString(36)}`.slice(0, 20), "{}");
    db.prepare("DELETE FROM saves WHERE id = ?").run(info.lastInsertRowid);
  }
} catch (e) {
  console.error(`[WARN] 清理 equipment.json 残留失败: ${e && e.message}`);
}

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}
function assert(cond, msg) {
  if (!cond) fail(msg);
}
const show = (r) => `status=${r.status} body=${JSON.stringify(r.body)}`;

const tag = Date.now().toString(36);
const name = `F147-${tag}`.slice(0, 20);

// 与 client/src/api.ts baseAttack 同口径：floor(1.6×力量)。基础值从
// save.stats 现算，不写死。
const baseAtkOf = (stats) => Math.floor(Math.max(0, Number(stats?.strength) || 0) * 1.6);

async function fetchView(id) {
  const r = await get(`/saves/${id}`);
  assert(r.status === 200 && r.body && r.body.save, `GET /saves/${id} 失败: ${show(r)}`);
  return r.body;
}
async function fetchLog(id) {
  const r = await get(`/saves/${id}/log?limit=200`);
  assert(r.status === 200 && r.body && Array.isArray(r.body.log), `GET /saves/${id}/log 失败: ${show(r)}`);
  return r.body.log;
}
function checkEquipped(view, label) {
  const eq = view.equipment;
  assert(eq && eq.weapon && eq.weapon.name, `${label}: equipment.weapon 应为非空，实际 ${JSON.stringify(eq)}`);
  assert(eq.armor && eq.armor.name, `${label}: equipment.armor 应为非空，实际 ${JSON.stringify(eq)}`);
  assert(eq.atk >= 4, `${label}: equipment.atk 应 >=4，实际 ${eq.atk}`);
  assert(eq.def >= 2, `${label}: equipment.def 应 >=2，实际 ${eq.def}`);
  const base = baseAtkOf(view.save.stats);
  assert(base + eq.atk > base, `${label}: 攻击合计 ${base}+${eq.atk} 应大于基础攻击 ${base}`);
  return eq;
}

// ── a/b/c) 新档：自动穿戴 + 背包栈仍在 + 播报 ──
const created = await post("/saves", { player_name: name });
assert(created.status === 201 && created.body && created.body.save && created.body.save.id,
  `建档应 201+save.id: ${show(created)}`);
const sid = created.body.save.id;

const view = await fetchView(sid);
const eq = checkEquipped(view, "新档");
console.log(`[OK] 新档自动装备 ${eq.weapon.name}/${eq.armor.name}（atk+${eq.atk} def+${eq.def}）`);

const inv = new Map((view.inventory || []).map((r) => [r.item_id, Number(r.qty) || 0]));
for (const itemId of [eq.weapon.item_id, eq.armor.item_id]) {
  assert((inv.get(itemId) || 0) >= 1, `配发品 ${itemId} 应仍在背包（自动穿戴不消耗），实际 ${JSON.stringify(view.inventory)}`);
}
console.log("[OK] 背包内配发装备栈仍在");

const log1 = await fetchLog(sid);
assert(log1.some((l) => l.content.includes("配发基础装备")), "原「配发基础装备」播报应保留");
assert(
  log1.some((l) => l.content.includes("已为你装备") && l.content.includes(eq.weapon.name)),
  `日志应含「已为你装备」且含武器名「${eq.weapon.name}」，实际 ${JSON.stringify(log1.map((l) => l.content))}`
);
console.log("[OK] 播报含「已为你装备」与武器名");

// ── d) 幂等：再开一次背包不重复播报、槽位不变 ──
await fetchView(sid);
const log2 = await fetchLog(sid);
const equipLines = log2.filter((l) => l.content.includes("已为你装备"));
assert(equipLines.length === 1, `重复打开背包不应重复播报「已为你装备」，实际 ${equipLines.length} 条`);
const view2 = await fetchView(sid);
assert(
  view2.equipment.weapon.item_id === eq.weapon.item_id && view2.equipment.armor.item_id === eq.armor.item_id,
  `重复打开背包装备不应变化，实际 ${JSON.stringify(view2.equipment)}`
);
console.log("[OK] 重复打开背包幂等");

// ── e) 老存档（F147 上线前的档）：配发品已在背包、无任何装备槽位，
//       走 ensureStarterKit（GET /saves/:id）后同样自动装备 ──
const legacyName = `F147-old-${tag}`.slice(0, 20);
const legacyId = db
  .prepare("INSERT INTO saves (player_name, stats_json) VALUES (?, ?)")
  .run(legacyName, JSON.stringify({ strength: 10, agility: 12, vitality: 8, intelligence: 10, perception: 14 }))
  .lastInsertRowid;
const insInv = db.prepare("INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, ?)");
for (const [itemId, qty] of [
  ["rusty_hunting_knife", 1],
  ["worn_leather_vest", 1],
  ["low_heal_potion", 3],
]) insInv.run(legacyId, itemId, qty);
db.prepare("INSERT INTO log (save_id, role, content) VALUES (?, 'system', ?)").run(
  legacyId,
  "【系统】猎人协会向你配发基础装备与补给，已存入背包。"
);

const legacyView = await fetchView(legacyId);
const legacyEq = checkEquipped(legacyView, "老存档");
assert(
  (legacyView.inventory || []).some((r) => r.item_id === legacyEq.weapon.item_id && r.qty >= 1),
  "老存档配发武器栈应仍在背包"
);
console.log(`[OK] 老存档走 ensureStarterKit 自动装备 ${legacyEq.weapon.name}/${legacyEq.armor.name}`);

console.log(`stale equipment purged: ${stalePurged}`);
console.log(`F147 OK — ${API} 新档与老存档配发装备均自动穿戴`);
process.exit(0);
