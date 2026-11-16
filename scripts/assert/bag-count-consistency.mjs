#!/usr/bin/env node
// F148 背包「N 件」计数与 API 物品栈一一对应：
//   a) 建档（初始包自带 gate_shard×2）→ 开背包 → .inv-slot-total 的
//      「N 件」== GET /saves/:id 里 qty>0 的物品栈数；
//   b) 每个 API 物品栈的显示名都能在某个分类页签里看到——含 /items
//      目录查不到的掉落物（rune_shard 走兜底中文名、完全陌生的 id 退回
//      原始 id 文本），不许静默吞栈；
//   c) 关键道具 gate_shard 在「关键」页签可见并带「关键道具」标注。
// 依赖：E2E_BASE_URL（游戏页）、API_BASE、DB_PATH（直插掉落物栈造数据）。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { fetchSaveView, get } = await import("./_http.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const Database = require("better-sqlite3");
const db = new Database(dbPath);

// 与 client/src/panels/InventoryPanel.tsx LOOT_FALLBACK 同源——断言「每个
// 栈都有可见名」时按同一兜底顺序推导期望显示名。
const LOOT_FALLBACK = {
  rune_shard: "符文碎片",
  stone_core: "石核",
  guardian_plate: "守卫铠片",
  smiling_idol_eye: "笑脸神像之眼",
  wolf_pelt: "狼皮",
  cracked_fang: "裂齿",
  beast_core: "兽核",
  moonlit_hide: "月光兽皮",
  venom_sac: "毒囊",
  serpent_scale: "蛇鳞",
  antidote_herb: "解毒草",
  toxic_gland: "毒腺",
  basilisk_venom: "蛇王毒液",
  frost_dust: "霜尘",
  ice_shard: "冰晶碎块",
  ice_crystal: "冰晶",
  eternal_frost_core: "永冻之核",
  winter_queen_tear: "冬之女王之泪",
  demon_iron: "恶魔铁",
  knight_crest: "骑士徽记",
  castle_key: "城堡钥匙",
  demon_blade: "恶魔之刃",
  baran_sigil: "巴兰印记",
  beru_carapace: "蚁王甲壳",
  ant_queen_essence: "蚁后精华",
  shadow_essence: "暗影精粹",
  monarch_fragment: "君主碎片",
  kings_jaw: "王者之颚",
  torn_scrap: "破损布片",
  dim_crystal: "微光晶石",
};

const NAME = `F148-${Date.now().toString(36)}`;

await run("bag-count-consistency", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 造两个目录外栈：已知掉落物（rune_shard，走兜底中文名）与完全陌生的
  // id（走原始 id 兜底）——覆盖「不吞栈」的两条路径。
  db.prepare("INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, ?)").run(
    saveId,
    "rune_shard",
    2
  );
  db.prepare("INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, ?)").run(
    saveId,
    "fb_unknown_ore",
    1
  );

  const { inventory } = await fetchSaveView(saveId);
  const stacks = inventory.filter((r) => r.qty > 0);
  assert(stacks.length >= 7, `expect ≥7 stacks incl. injected loot, got ${stacks.length}`);
  assert(
    stacks.some((r) => r.item_id === "gate_shard"),
    "starter kit missing gate_shard"
  );

  const items = (await get("/items")).body.items;
  const catalog = new Map(items.map((it) => [it.id, it]));
  const nameOf = (id) => catalog.get(id)?.name ?? LOOT_FALLBACK[id] ?? id;

  // 开背包面板（系统组「背包」按钮）。
  await page.locator(".btn-group-sys .btn", { hasText: "背包" }).first().click();
  await page.waitForSelector(".sidebar.open .inv");
  await page.waitForSelector(".inv-slot-total .inv-slot-num");

  // ── (a) 「N 件」== API 栈数 ──
  const totalText = (await page.locator(".inv-slot-total .inv-slot-num").innerText()).trim();
  const m = totalText.match(/^(\d+)\s*件$/);
  assert(m, `inv total copy malformed: "${totalText}"`);
  assert(
    Number(m[1]) === stacks.length,
    `(a) 「${totalText}」!= API 栈数 ${stacks.length}（口径必须是可见栈数）`
  );

  // ── (b) 逐页签收集行名，每个 API 栈都要在某处可见 ──
  const seen = new Set();
  const tabs = page.locator(".inv-tab");
  const tabCount = await tabs.count();
  assert(tabCount >= 5, `expect ≥5 inv tabs incl. 关键, got ${tabCount}`);
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    for (const t of await page.locator(".inv-row-name").allInnerTexts()) {
      seen.add(t.trim());
    }
  }
  for (const r of stacks) {
    const want = nameOf(r.item_id);
    assert(
      seen.has(want),
      `(b) stack ${r.item_id}（${want} ×${r.qty}）silent-dropped — not visible in any tab; seen=${[...seen].join(",")}`
    );
  }

  // ── (c) gate_shard 在「关键」页签可见 + 标注 ──
  await page.locator(".inv-tab", { hasText: "关键" }).first().click();
  const keyRow = page.locator(".inv-row", { hasText: "传送门碎片" });
  assert((await keyRow.count()) === 1, "(c) 传送门碎片 not in 关键 tab");
  assert(
    (await keyRow.first().innerText()).includes("关键道具"),
    "(c) gate_shard row missing 关键道具 flag"
  );
});
