const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const store = require("./db");
const progression = require("./engine/progression");

const VERSION = "0.1.0";
const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT || 3020);
const BASE = "/game";

const app = express();
app.use(express.json());

const MAX_INPUT_LEN = 200;

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function vitalsLine(save) {
  return `HP ${save.hp}/${save.max_hp} · MP ${save.mp}/${save.max_mp}`;
}

// 出参统一带派生字段：xp_to_next 由等级曲线算出，free_points 兜底 0。
function saveView(save) {
  if (!save) return save;
  return {
    ...save,
    free_points: Number(save.free_points) || 0,
    xp_to_next: progression.xpToNext(save.level),
  };
}

/* ────────────────────────────────────────────────────────────────
   物品目录与背包写操作
   目录是纯数据（server/data/items.json）；db.js 只读导出 inventory，
   因此这里开一条独立连接（WAL 下多连接安全）负责 qty 增减。
   所有数值都在服务端计算，客户端只传 item_id 与 op。
──────────────────────────────────────────────────────────────── */
const CATALOG = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "items.json"), "utf8"));
const ITEMS = new Map(CATALOG.map((item) => [item.id, item]));
const OPS = ["use", "equip", "discard"];
const SLOT_OF = { weapon: "weapon", armor: "armor" };
const SLOT_LABEL = { weapon: "武器", armor: "防具" };

const SKILLS = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "skills.json"), "utf8"));

const db = new Database(path.join(__dirname, "..", "data", "game.db"));

const invStmts = {
  get: db.prepare("SELECT qty FROM inventory WHERE save_id = ? AND item_id = ?"),
  add: db.prepare(`
    INSERT INTO inventory (save_id, item_id, qty) VALUES (?, ?, ?)
    ON CONFLICT(save_id, item_id) DO UPDATE SET qty = qty + excluded.qty
  `),
  setQty: db.prepare("UPDATE inventory SET qty = ? WHERE save_id = ? AND item_id = ?"),
  remove: db.prepare("DELETE FROM inventory WHERE save_id = ? AND item_id = ?"),
  isEmpty: db.prepare("SELECT 1 FROM inventory WHERE save_id = ? LIMIT 1"),
  seeded: db.prepare("SELECT 1 FROM log WHERE save_id = ? AND content LIKE '%配发基础装备%' LIMIT 1"),
};

const STARTER_KIT = [
  ["rusty_hunting_knife", 1],
  ["worn_leather_vest", 1],
  ["low_heal_potion", 3],
  ["mana_potion", 2],
  ["gate_shard", 2],
];

// 装备位：saves 表没有装备列且 db.js 不在本功能可改范围内，
// 因此用一个 JSON 边车文件按 save_id 记录当前武器/防具。
const EQUIP_FILE = path.join(__dirname, "data", "equipment.json");

function loadEquip() {
  try {
    const raw = JSON.parse(fs.readFileSync(EQUIP_FILE, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

const equipment = loadEquip();

function persistEquip() {
  const tmp = `${EQUIP_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(equipment, null, 2));
  fs.renameSync(tmp, EQUIP_FILE);
}

function slotView(saveId, slot) {
  const itemId = (equipment[saveId] || {})[slot];
  const item = itemId ? ITEMS.get(itemId) : null;
  if (!item || SLOT_OF[item.category] !== slot) return null;
  return {
    item_id: item.id,
    name: item.name,
    rarity: item.rarity,
    atk: item.atk || 0,
    def: item.def || 0,
  };
}

function equipView(saveId) {
  const weapon = slotView(saveId, "weapon");
  const armor = slotView(saveId, "armor");
  return {
    weapon,
    armor,
    atk: (weapon ? weapon.atk : 0) + (armor ? armor.atk : 0),
    def: (weapon ? weapon.def : 0) + (armor ? armor.def : 0),
  };
}

function clearSlot(saveId, slot) {
  if (!equipment[saveId] || !equipment[saveId][slot]) return false;
  delete equipment[saveId][slot];
  persistEquip();
  return true;
}

function grantStarterKit(saveId) {
  const tx = db.transaction((rows) => {
    for (const [itemId, qty] of rows) invStmts.add.run(saveId, itemId, qty);
  });
  tx(STARTER_KIT);
  store.appendLog(
    saveId,
    "system",
    "【系统】猎人协会向你配发基础装备与补给（猎刀 / 皮甲 / 治疗药水 ×3 / 魔力药剂 ×2 / 传送门碎片 ×2），已存入背包。"
  );
}

// 老存档第一次打开背包时补发一次；用日志里的配发记录做幂等标记，
// 所以清空背包后不会无限补发。
function ensureStarterKit(saveId) {
  if (invStmts.isEmpty.get(saveId)) {
    if (!invStmts.seeded.get(saveId)) grantStarterKit(saveId);
    return true;
  }
  return false;
}

function itemLine(item) {
  if (item.category === "weapon") return `攻击 +${item.atk || 0}`;
  if (item.category === "armor") return `防御 +${item.def || 0}`;
  if (item.category === "consumable") {
    const parts = [];
    if (item.heal) parts.push(`HP +${item.heal}`);
    if (item.mp) parts.push(`MP +${item.mp}`);
    return parts.join(" · ");
  }
  return "素材";
}


// Whitelisted intents. Each entry owns its keyword match, log role, the
// deterministic state delta and the narration text — every number is computed
// here on the server, never taken from the client payload.
const INTENTS = [
  {
    id: "status",
    role: "system",
    match: /状态|面板|属性|status|stat/i,
    build: (save) => {
      const s = save.stats || {};
      return {
        patch: null,
        content:
          `【状态】${save.player_name} — Lv.${save.level} · ${save.rank}级猎人 · 第${save.chapter}章\n` +
          `${vitalsLine(save)} · XP ${save.xp} · 金币 ${save.gold}\n` +
          `力量 ${s.strength} · 敏捷 ${s.agility} · 体力 ${s.vitality} · 智力 ${s.intelligence} · 感知 ${s.perception}`,
      };
    },
  },
  {
    id: "help",
    role: "system",
    match: /帮助|指令|help/i,
    build: () => ({
      patch: null,
      content:
        "【系统】可用指令：\n" +
        "「状态」查看属性面板 · 「帮助」列出指令 · 「观察」环顾四周\n" +
        "「前进」推进剧情（消耗少量体力） · 「潜行」压低气息（消耗 5 MP）\n" +
        "「休息」恢复体力与魔力 · 「存档」写入当前进度\n" +
        "其余自由输入将交由叙事层判定，未识别的动作不会改变状态。",
    }),
  },
  {
    id: "observe",
    role: "narrator",
    match: /观察|查看|环顾|四周|环境|look/i,
    build: () => ({
      patch: null,
      content:
        "你环顾四周：残破的神殿大厅内烛火摇曳，远处的石门紧闭，门缝里渗出幽蓝色的微光，空气里弥漫着尘土与铁锈的气味。石像的嘴角似乎还残留着那抹笑意。",
    }),
  },
  {
    id: "advance",
    role: "narrator",
    match: /前进|探索|走|移动|离开|进入|advance|go/i,
    build: (save) => {
      const hp = clamp(save.hp - 3, 1, save.max_hp);
      const mp = clamp(save.mp - 2, 0, save.max_mp);
      return {
        patch: { hp, mp },
        content:
          `你踩着碎石向那扇石门挪去，脚下的石砖忽然下沉半寸，机关咬合的声音在暗处响起。你屏住呼吸，从缝隙里挤了过去。\n` +
          `（体力消耗 HP ${save.hp}→${hp} · MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "sneak",
    role: "narrator",
    match: /潜行|藏匿|隐蔽|sneak|stealth/i,
    build: (save) => {
      const mp = clamp(save.mp - 5, 0, save.max_mp);
      return {
        patch: { mp },
        content:
          `你把魔力压进四肢，脚步轻得几乎没有声音。石像的目光扫过你所立之处，停顿了一瞬——又缓缓移开。\n` +
          `（魔力消耗 MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "rest",
    role: "narrator",
    match: /休息|睡觉|休整|小憩|rest|sleep/i,
    build: (save) => {
      const hp = clamp(save.hp + 15, 0, save.max_hp);
      const mp = clamp(save.mp + 8, 0, save.max_mp);
      return {
        patch: { hp, mp },
        content:
          `你背靠石柱坐下，闭上眼调整呼吸。系统在视野边缘安静地跳动着，体力与魔力一点点回流。\n` +
          `（恢复 HP ${save.hp}→${hp} · MP ${save.mp}→${mp}）`,
      };
    },
  },
  {
    id: "save",
    role: "system",
    match: /存档|保存|save/i,
    build: (save) => ({
      patch: null,
      content: `【系统】存档已写入。第${save.chapter}章 · Lv.${save.level} · ${vitalsLine(save)} · 金币 ${save.gold}。`,
    }),
  },
];

const PLACEHOLDER = {
  role: "system",
  content: null, // filled per-request with the raw input
};

function resolveAction(save, input) {
  for (const intent of INTENTS) {
    if (intent.match.test(input)) {
      const built = intent.build(save);
      return { intent: intent.id, role: intent.role, patch: built.patch, content: built.content };
    }
  }
  return {
    intent: "unknown",
    role: PLACEHOLDER.role,
    patch: null,
    content: `【系统】指令已接收：「${input}」。命运之线仍在编织中……（叙事引擎尚未接入，此处为占位回应。输入「帮助」查看当前可用指令。）`,
  };
}

const api = express.Router();

api.get("/health", (req, res) => {
  res.json({ ok: true, version: VERSION });
});

api.get("/items", (req, res) => {
  res.json({ items: CATALOG });
});

api.get("/skills", (req, res) => {
  res.json({ skills: SKILLS });
});

api.post("/saves", (req, res) => {
  const playerName = String((req.body && req.body.player_name) || "").trim();
  if (!playerName) {
    return res.status(400).json({ error: "player_name is required" });
  }
  const save = store.createSave(playerName);
  grantStarterKit(save.id);
  res.status(201).json({ save: saveView(store.getSave(save.id)) });
});

api.get("/saves/:id", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  ensureStarterKit(save.id);
  res.json({
    save: saveView(store.getSave(save.id)),
    inventory: store.getInventory(save.id),
    equipment: equipView(save.id),
  });
});

// 自由属性点加点：stat 白名单 + free_points 余量都在服务端校验，
// 客户端只传要加哪一项，数值一律由 progression.spendPoint 结算。
api.post("/saves/:id/spend", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const stat = typeof body.stat === "string" ? body.stat.trim() : "";
  if (!progression.VALID_STATS.includes(stat)) {
    return res.status(400).json({ error: `stat must be one of ${progression.VALID_STATS.join(", ")}` });
  }
  if ((Number(save.free_points) || 0) <= 0) {
    return res.status(400).json({ error: "没有剩余的自由属性点" });
  }

  const { state, events } = progression.spendPoint(save, stat);
  const failed = events.find((e) => e.type === "error");
  if (failed) {
    return res.status(400).json({ error: failed.message || "无法分配属性点" });
  }
  store.updateSave(save.id, {
    free_points: state.free_points,
    max_hp: state.max_hp,
    max_mp: state.max_mp,
    stats: state.stats,
  });

  const message = events
    .filter((e) => e.type === "spend" && e.message)
    .map((e) => e.message)
    .join("\n");
  const reply = message ? store.appendLog(save.id, "system", message) : null;
  res.json({
    reply,
    save: saveView(store.getSave(save.id)),
    inventory: store.getInventory(save.id),
    equipment: equipView(save.id),
  });
});

// 背包操作：只有 item_id + op 两个入参，效果（回复量、装备加成、qty 扣减）
// 全部由服务端按目录计算，客户端传任何数值都会被忽略。
api.post("/saves/:id/item", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const itemId = typeof body.item_id === "string" ? body.item_id.trim() : "";
  const item = ITEMS.get(itemId);
  if (!item) {
    return res.status(400).json({ error: "unknown item_id" });
  }
  if (!OPS.includes(body.op)) {
    return res.status(400).json({ error: `op must be one of ${OPS.join(", ")}` });
  }

  const row = invStmts.get.get(save.id, item.id);
  const qty = row ? Number(row.qty) : 0;
  if (qty <= 0) {
    return res.status(400).json({ error: "item not in inventory" });
  }

  let content = "";
  let patch = null;

  if (body.op === "use") {
    if (item.category !== "consumable") {
      return res.status(400).json({ error: "该物品无法使用" });
    }
    // 数值只取目录 + 当前存档，客户端不可覆盖；HP/MP 一律夹紧到 0..max。
    const hp = item.heal ? clamp(save.hp + item.heal, 0, save.max_hp) : save.hp;
    const mp = item.mp ? clamp(save.mp + item.mp, 0, save.max_mp) : save.mp;
    if (hp === save.hp && mp === save.mp) {
      return res.status(400).json({ error: "当前状态已是满值，无需使用" });
    }
    patch = { hp, mp };
    const deltas = [];
    if (hp !== save.hp) deltas.push(`HP ${save.hp}→${hp}`);
    if (mp !== save.mp) deltas.push(`MP ${save.mp}→${mp}`);
    content =
      `【系统】已使用「${item.name}」。${deltas.join(" · ")}。` +
      `（${itemLine(item)}，剩余 ×${qty - 1}）`;
    if (qty <= 1) invStmts.remove.run(save.id, item.id);
    else invStmts.setQty.run(qty - 1, save.id, item.id);
  } else if (body.op === "equip") {
    const slot = SLOT_OF[item.category];
    if (!slot) {
      return res.status(400).json({ error: "该物品无法装备" });
    }
    equipment[save.id] = equipment[save.id] || {};
    const previous = equipment[save.id][slot];
    equipment[save.id][slot] = item.id;
    persistEquip();
    const view = equipView(save.id);
    content =
      `【系统】已装备「${item.name}」至${SLOT_LABEL[slot]}位。` +
      (previous && previous !== item.id ? `原装备已卸下。` : "") +
      `当前攻击 +${view.atk} · 防御 +${view.def}。`;
  } else {
    // discard：可能丢掉的正是当前装备，qty 归零时同时清空装备位。
    const next = qty - 1;
    if (next <= 0) invStmts.remove.run(save.id, item.id);
    else invStmts.setQty.run(next, save.id, item.id);
    const slot = SLOT_OF[item.category];
    const wasEquipped = slot && equipment[save.id] && equipment[save.id][slot] === item.id;
    if (wasEquipped && next <= 0) {
      clearSlot(save.id, slot);
    }
    content =
      `【系统】已丢弃「${item.name}」×1` +
      (next > 0 ? `，剩余 ×${next}。` : "，背包中已无此物。") +
      (wasEquipped && next <= 0 ? `（${SLOT_LABEL[slot]}位已空出）` : "");
  }

  if (patch) store.updateSave(save.id, patch);
  const reply = store.appendLog(save.id, "system", content);
  res.json({
    reply,
    save: saveView(store.getSave(save.id)),
    inventory: store.getInventory(save.id),
    equipment: equipView(save.id),
  });
});

api.get("/saves/:id/log", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  res.json({ log: store.getLog(save.id, limit) });
});

api.post("/action", (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};

  // save_id must be a positive integer, whether sent as a number or numeric string.
  const rawId = body.save_id;
  const saveId =
    typeof rawId === "number" ? rawId : typeof rawId === "string" && rawId.trim() !== "" ? Number(rawId) : NaN;
  if (!Number.isInteger(saveId) || saveId <= 0) {
    return res.status(400).json({ error: "save_id must be a positive integer" });
  }

  // input must be a non-empty string of at most MAX_INPUT_LEN characters.
  const rawInput = body.input;
  if (typeof rawInput !== "string") {
    return res.status(400).json({ error: "input is required" });
  }
  const input = rawInput.trim();
  if (!input) {
    return res.status(400).json({ error: "input is required" });
  }
  if (input.length > MAX_INPUT_LEN) {
    return res.status(400).json({ error: `input must be at most ${MAX_INPUT_LEN} characters` });
  }

  const save = store.getSave(saveId);
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }

  store.appendLog(save.id, "user", input);

  // Server-side authority: the resolved intent's own delta is applied and the
  // result is clamped, so any numbers in the client payload are ignored.
  const outcome = resolveAction(save, input);
  if (outcome.patch) {
    store.updateSave(save.id, outcome.patch);
  }
  const reply = store.appendLog(save.id, outcome.role, outcome.content);
  res.json({ reply, save: saveView(store.getSave(save.id)) });
});

api.use((req, res) => res.status(404).json({ error: "not found" }));

app.use(`${BASE}/api`, api);

const distDir = path.join(__dirname, "..", "client", "dist");
app.get(BASE, (req, res) => res.sendFile(path.join(distDir, "index.html")));
app.use(BASE, express.static(distDir));
app.use(BASE, (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  res.sendFile(path.join(distDir, "index.html"));
});

app.use((req, res) => res.status(404).json({ error: "not found" }));

app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`solo-leveling listening on http://${HOST}:${PORT}${BASE}`);
});
