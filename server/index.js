const fs = require("fs");
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const store = require("./db");
const progression = require("./engine/progression");
const chaptersEngine = require("./engine/chapters");
const questEngine = require("./engine/quests");
const shadowEngine = require("./engine/shadow");
const endingEngine = require("./engine/ending");
const aiGateway = require("./ai/gateway");
const aiValidate = require("./ai/validate");
const aiContext = require("./ai/context");
const aiFallback = require("./ai/fallback");
const intentRules = require("./ai/keywords");

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
// cleared 是通关唯一判定（endingEngine.hasCleared：当前场景为 ch8_epilogue），
// 前端「结算」tab 与 /saves/:id/ending 门禁共用同一结论，不各自推导。
function saveView(save) {
  if (!save) return save;
  return {
    ...save,
    free_points: Number(save.free_points) || 0,
    kills: Number(save.kills) || 0,
    cleared: endingEngine.hasCleared(save),
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

// F051 影子编队：列表/摘要统一走引擎纯函数，db 行 → 视图（含 stats/power/deployed）。
// 读视图前先自愈：旧版按 (save_id, shadow_id) 广播 deployed=1，同 shadow_id
// 多行曾被一次全部置出战、计数冲破上限。写库已改按主键行定位（不再新增），
// 这里把仍超出上限的出战行自动收回，只保留前 max 个。
function formationView(saveId) {
  const f = shadowEngine.formationSummary(store.getShadows(saveId));
  if (f.count > f.max) {
    store.releaseExcessDeployed(saveId, f.max);
    return shadowEngine.formationSummary(store.getShadows(saveId));
  }
  return f;
}

function shadowLine(s) {
  return `${s.deployed ? "▶" : "·"} ${s.name}（${s.rank}级 · Lv.${s.level}）攻${s.stats.atk} 防${s.stats.def} 血${s.stats.hp}`;
}

// 任务数据走引擎加载器：quests.json 校验不过会在启动时直接抛错。
const QUESTS = questEngine.loadQuests();

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


// Whitelisted intents. Each entry owns its log role, the
// deterministic state delta and the narration text — every number is computed
// here on the server, never taken from the client payload.
// 关键词匹配不在此表：/action 与 /ai-action 统一走 ai/keywords.js 的
// INTENT_MATCHERS（单一事实源），INTENTS 只负责按 id 结算。
const INTENTS = [
  {
    id: "shadow_deploy",
    role: "system",
    build: (save, input) => {
      const f = formationView(save.id);
      const shadows = store.getShadows(save.id);
      if (!shadows.length) {
        return {
          patch: null,
          shadows: f,
          content: "【影子编队】你的影子栏位空空如也。击败强敌后尝试将其提取为影子，再来编队。",
        };
      }
      // 只剥句首指令前缀；影子名（可含「影子」「的」等字）原文保留。
      const target = shadowEngine.shadowTarget(input);
      if (!target) {
        // 裸指令「影子出战」：绝不替玩家选人，只列名单并提示点名格式。
        const idle = f.shadows.find((s) => !s.deployed);
        const hint =
          f.count >= f.max
            ? `队伍已满 ${f.count}/${f.max}。先「影子撤回 <名字>」撤下一员，再点名出战。`
            : `点名出战对象：「影子出战 ${(idle || f.shadows[0]).name}」。`;
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】已出战 ${f.count}/${f.max} · 战力合计 ${f.power}\n` +
            f.shadows.map(shadowLine).join("\n") +
            `\n${hint}`,
        };
      }
      const gate = shadowEngine.canDeploy(shadows, target);
      if (!gate.ok && gate.reason === "ambiguous") {
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】「${target}」同时命中多个影子，请改用影子 ID 点名：\n` +
            gate.candidates.map((s) => `· ${s.name}（ID ${s.id}）`).join("\n"),
        };
      }
      if (!gate.ok && gate.reason === "formation_full") {
        return {
          patch: null,
          shadows: f,
          content: `【影子编队】队伍已满（${f.count}/${f.max}）。先「影子撤回」一名影子，再遣新影出战。`,
        };
      }
      if (!gate.ok) {
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】没有找到名为「${target}」的影子（原指令：「${input}」）。当前影子：\n` +
            f.shadows.map(shadowLine).join("\n"),
        };
      }
      if (!gate.already && !store.setShadowDeployed(save.id, gate.shadow.rowId, true)) {
        return {
          patch: null,
          shadows: formationView(save.id),
          content: `【影子编队】「${gate.shadow.name}」出战失败：影子记录已变化，请重试。`,
        };
      }
      const after = formationView(save.id);
      return {
        patch: null,
        shadows: after,
        content: gate.already
          ? `【影子编队】「${gate.shadow.name}」已在阵中。已出战 ${after.count}/${after.max} · 战力合计 ${after.power}。`
          : `【影子编队】「${gate.shadow.name}」自你脚下的阴影中升起，列入战阵。已出战 ${after.count}/${after.max} · 战力合计 ${after.power}。`,
      };
    },
  },
  {
    id: "shadow_undeploy",
    role: "system",
    build: (save, input) => {
      const f = formationView(save.id);
      const shadows = store.getShadows(save.id);
      if (!shadows.length) {
        return {
          patch: null,
          shadows: f,
          content: "【影子编队】你的影子栏位空空如也，无影可撤。",
        };
      }
      const target = shadowEngine.shadowTarget(input);
      if (!target) {
        // 裸指令「影子撤回」：与出战对称，列出名单让玩家点名。
        const onDuty = f.shadows.find((s) => s.deployed);
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】已出战 ${f.count}/${f.max} · 战力合计 ${f.power}\n` +
            f.shadows.map(shadowLine).join("\n") +
            `\n点名撤回对象：「影子撤回 ${(onDuty || f.shadows[0]).name}」。`,
        };
      }
      const gate = shadowEngine.canUndeploy(shadows, target);
      if (!gate.ok && gate.reason === "ambiguous") {
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】「${target}」同时命中多个影子，请改用影子 ID 点名：\n` +
            gate.candidates.map((s) => `· ${s.name}（ID ${s.id}）`).join("\n"),
        };
      }
      if (!gate.ok && gate.reason === "not_deployed") {
        return {
          patch: null,
          shadows: f,
          content: `【影子编队】「${gate.shadow.name}」本就不在战阵之中。已出战 ${f.count}/${f.max}。`,
        };
      }
      if (!gate.ok) {
        return {
          patch: null,
          shadows: f,
          content:
            `【影子编队】没有找到名为「${target}」的影子（原指令：「${input}」）。当前影子：\n` +
            f.shadows.map(shadowLine).join("\n"),
        };
      }
      if (!store.setShadowDeployed(save.id, gate.shadow.rowId, false)) {
        return {
          patch: null,
          shadows: formationView(save.id),
          content: `【影子编队】「${gate.shadow.name}」撤回失败：影子记录已变化，请重试。`,
        };
      }
      const after = formationView(save.id);
      return {
        patch: null,
        shadows: after,
        content: `【影子编队】「${gate.shadow.name}」化作一缕黑雾归回你的影子里。已出战 ${after.count}/${after.max} · 战力合计 ${after.power}。`,
      };
    },
  },
  {
    id: "shadow_formation",
    role: "system",
    build: (save) => {
      const f = formationView(save.id);
      if (!f.shadows.length) {
        return {
          patch: null,
          shadows: f,
          content: "【影子编队】你的影子栏位空空如也。击败强敌后尝试将其提取为影子，再来编队。",
        };
      }
      return {
        patch: null,
        shadows: f,
        content:
          `【影子编队】已出战 ${f.count}/${f.max} · 战力合计 ${f.power}\n` +
          f.shadows.map(shadowLine).join("\n") +
          `\n「影子出战 <名字>」遣其入阵 · 「影子撤回 <名字>」令其归队。`,
      };
    },
  },
  {
    id: "status",
    role: "system",
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
    build: () => ({
      patch: null,
      content:
        "【系统】可用指令：\n" +
        "「状态」查看属性面板 · 「帮助」列出指令 · 「观察」环顾四周\n" +
        "「前进」推进剧情（消耗少量体力） · 「潜行」压低气息（消耗 5 MP）\n" +
        "「休息」恢复体力与魔力 · 「存档」写入当前进度\n" +
        "「影子」查看编队 · 「影子出战 <名字>」遣影入阵 · 「影子撤回 <名字>」令其归队\n" +
        "其余自由输入将交由叙事层判定，未识别的动作不会改变状态。",
    }),
  },
  {
    id: "observe",
    role: "narrator",
    build: () => ({
      patch: null,
      content:
        "你环顾四周：残破的神殿大厅内烛火摇曳，远处的石门紧闭，门缝里渗出幽蓝色的微光，空气里弥漫着尘土与铁锈的气味。石像的嘴角似乎还残留着那抹笑意。",
    }),
  },
  {
    id: "advance",
    role: "narrator",
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

// 引擎执行：intent id → 服务端结算出参。/action 与 /ai-action 共用，
// AI/客户端给的任何数值都不会走到这里，patch 只由白名单模板产出。
function executeIntent(save, intentId, input) {
  const intent = INTENTS.find((it) => it.id === intentId);
  if (!intent) return null;
  const built = intent.build(save, input);
  return {
    intent: intent.id,
    role: intent.role,
    patch: built.patch,
    content: built.content,
    shadows: built.shadows,
  };
}

function resolveAction(save, input) {
  const intentId = intentRules.resolveIntent(input);
  if (intentId) {
    return executeIntent(save, intentId, input);
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

// 通关结算：数值取自存档行 + shadows 表 + cleared_at 冻结时间戳。
// 门禁：只有存档真到结局场景（save.scene 解析为 ch8_epilogue，即
// endingEngine.hasCleared，与前端 save.cleared 同一判定）才返回结算，
// 否则 409 —— chapter>=8 只代表「在最后一章」，剧透结局全文不允许。
// save.scene 目前无写入路径，待 F074 场景运行时落地后本门禁自动生效。
api.get("/saves/:id/ending", (req, res) => {
  try {
    const save = store.getSave(Number(req.params.id));
    if (!save) {
      return res.status(404).json({ error: "save not found" });
    }
    if (!endingEngine.hasCleared(save)) {
      return res.status(409).json({ error: "尚未通关：抵达终局场景后才可进行结算" });
    }
    // 首次抵达结局场景时冻结通关时间戳；耗时按 cleared_at - created_at 结算，
    // 已冻结的存档不再改写，clear_time 跨请求稳定。
    if (!save.cleared_at) store.markCleared(save.id);
    const fresh = store.getSave(save.id);
    const chapter = chaptersEngine.getChapter(8);
    const ending = endingEngine.buildEnding({
      save: fresh,
      shadows: store.getShadows(save.id),
      chapter,
    });
    res.json({ ending });
  } catch (err) {
    res.status(500).json({ error: "结算数据生成失败" });
  }
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

// 任务面板：主线由章节数据推导（当前章进行中/已过 done/未解锁），
// 每日任务读 quest_daily 当天进度，惩罚倒计时由引擎按上一 quest-day
// 是否清完计算 —— 全部为纯函数拼装，这里只做取数。
api.get("/saves/:id/quests", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const now = new Date();
  res.json(
    questEngine.buildView({
      save,
      data: QUESTS,
      chaptersData: chaptersEngine.loadChapters(),
      todayRows: store.getDailyQuests(save.id, questEngine.dayKey(now)),
      prevRows: store.getDailyQuests(save.id, questEngine.prevDayKey(now)),
      now,
    })
  );
});

// 影子面板：编队视图（名单 + 出战位 + 战力合计），全部引擎纯函数拼装。
api.get("/saves/:id/shadows", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const f = formationView(save.id);
  res.json({ shadows: f.shadows, formation: { max: f.max, count: f.count, power: f.power } });
});

// 出战/撤回：客户端只传 shadow_id + op，满员判定与文案都在服务端结算。
api.post("/saves/:id/shadow", (req, res) => {
  const save = store.getSave(Number(req.params.id));
  if (!save) {
    return res.status(404).json({ error: "save not found" });
  }
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const shadowId = typeof body.shadow_id === "string" ? body.shadow_id.trim() : "";
  const op = body.op === "deploy" || body.op === "undeploy" ? body.op : null;
  if (!shadowId) return res.status(400).json({ error: "shadow_id is required" });
  if (!op) return res.status(400).json({ error: 'op must be one of deploy, undeploy' });

  const f = formationView(save.id);
  const shadows = store.getShadows(save.id);
  // 与 /action 的同名指令共用同一套引擎判定，两处行为不分叉。
  const gate =
    op === "deploy"
      ? shadowEngine.canDeploy(shadows, shadowId)
      : shadowEngine.canUndeploy(shadows, shadowId);

  if (!gate.ok && gate.reason === "ambiguous") {
    return res.status(409).json({
      error: `「${shadowId}」同时命中多个影子，请改用影子 ID`,
      code: "ambiguous",
      candidates: gate.candidates.map((s) => ({ id: s.id, name: s.name })),
    });
  }
  if (!gate.ok && gate.reason === "formation_full") {
    return res.status(400).json({
      error: `队伍已满（${f.count}/${f.max}），先撤回一名影子`,
      code: "formation_full",
    });
  }
  if (!gate.ok && gate.reason === "not_found") {
    return res.status(404).json({ error: "没有找到这个影子", code: "not_found" });
  }

  let content;
  if (op === "deploy") {
    if (gate.already) {
      content = `【影子编队】「${gate.shadow.name}」已在阵中。已出战 ${f.count}/${f.max} · 战力合计 ${f.power}。`;
    } else {
      const updated = store.setShadowDeployed(save.id, gate.shadow.rowId, true);
      const after = formationView(save.id);
      content = updated
        ? `【影子编队】「${gate.shadow.name}」自你脚下的阴影中升起，列入战阵。已出战 ${after.count}/${after.max} · 战力合计 ${after.power}。`
        : `【影子编队】「${gate.shadow.name}」出战失败：影子记录已变化，请重试。`;
    }
  } else if (!gate.ok) {
    // 仅剩 not_deployed（其余失败分支上面已拦截）。
    content = `【影子编队】「${gate.shadow.name}」本就不在战阵之中。已出战 ${f.count}/${f.max}。`;
  } else {
    const updated = store.setShadowDeployed(save.id, gate.shadow.rowId, false);
    const after = formationView(save.id);
    content = updated
      ? `【影子编队】「${gate.shadow.name}」化作一缕黑雾归回你的影子里。已出战 ${after.count}/${after.max} · 战力合计 ${after.power}。`
      : `【影子编队】「${gate.shadow.name}」撤回失败：影子记录已变化，请重试。`;
  }

  const after = formationView(save.id);
  const reply = store.appendLog(save.id, "system", content);
  res.json({
    reply,
    shadows: after.shadows,
    formation: { max: after.max, count: after.count, power: after.power },
    save: saveView(store.getSave(save.id)),
  });
});

// 每日任务结算：输入 → 事件（前进/技能/击败）→ 当天进度累加；
// 完成的任务当场发奖励（XP/金币/物品），并返回一行播报并入本条回复。
function settleDailyQuests(saveId, input) {
  const events = questEngine.detectEvents(input);
  if (!events.length) return null;
  const key = questEngine.dayKey(new Date());
  const { updates, completed } = questEngine.applyDailyEvents(
    QUESTS.daily,
    store.getDailyQuests(saveId, key),
    events
  );
  for (const u of updates) {
    store.setDailyQuest(saveId, key, u.quest_id, u.progress, u.done);
  }
  if (!completed.length) return null;

  const fresh = store.getSave(saveId);
  const total = questEngine.mergeRewards(completed);
  store.updateSave(saveId, { xp: fresh.xp + total.xp, gold: fresh.gold + total.gold });
  for (const item of total.items) {
    invStmts.add.run(saveId, item.id, item.qty);
  }
  const names = completed.map((q) => `「${q.title}」`).join("、");
  const parts = [`XP +${total.xp}`, `金币 +${total.gold}`];
  if (total.items.length) parts.push(total.items.map((i) => `${i.name} ×${i.qty}`).join("、"));
  return `【任务】每日任务完成：${names}。奖励已入账 ${parts.join(" · ")}。`;
}

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
  // 每日任务进度随真实动作推进；完成播报并进本条回复，不重开日志行。
  const questNote = settleDailyQuests(save.id, input);
  const reply = store.appendLog(
    save.id,
    outcome.role,
    questNote ? `${outcome.content}\n${questNote}` : outcome.content
  );
  const payload = { reply, save: saveView(store.getSave(save.id)) };
  if (outcome.shadows) payload.shadows = outcome.shadows;
  res.json(payload);
});

// F021 自由输入 → AI JSON → 白名单校验 → 引擎执行 → 叙述返回。
// AI 只负责挑选 intent；一切数值由 executeIntent 的服务端模板结算。
// 网关失败/超时/无 key/非法 JSON 一律降级到规则解析器，永远 200。
const AI_SYSTEM_PROMPT =
  "你是文字冒险游戏的意图解析器。根据玩家输入与状态摘要，只输出一行 JSON：" +
  '{"intent":"<intent>","args":{}}。' +
  `intent 只能是：${aiValidate.INTENTS.join(", ")}。` +
  "不要输出任何其他文字、解释或数值（hp/mp/xp/gold 由服务端计算）。";

api.post("/ai-action", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};

    const rawId = body.save_id;
    const saveId =
      typeof rawId === "number"
        ? rawId
        : typeof rawId === "string" && rawId.trim() !== ""
          ? Number(rawId)
          : NaN;
    if (!Number.isInteger(saveId) || saveId <= 0) {
      return res.status(400).json({ error: "save_id must be a positive integer" });
    }

    const rawInput = body.input;
    if (typeof rawInput !== "string") {
      return res.status(400).json({ error: "input is required" });
    }
    const input = rawInput.trim().slice(0, MAX_INPUT_LEN);
    if (!input) {
      return res.status(400).json({ error: "input is required" });
    }

    const save = store.getSave(saveId);
    if (!save) {
      return res.status(404).json({ error: "save not found" });
    }

    store.appendLog(save.id, "user", input);

    let intentId = null;
    let degraded = false;
    try {
      const ctx = aiContext.buildContext({
        save: saveView(save),
        logs: store.getLog(save.id, 8),
        playerInput: input,
      });
      const historyText = ctx.history.map((h) => `${h.role}: ${h.content}`).join("\n");
      const gen = await aiGateway.generate({
        messages: [
          { role: "system", content: AI_SYSTEM_PROMPT },
          {
            role: "user",
            content: `${ctx.summary}\n${historyText ? `${historyText}\n` : ""}玩家输入：${ctx.input}`,
          },
        ],
        temperature: 0.2,
        maxTokens: 200,
      });
      if (gen.ok) {
        const decision = aiValidate.normalizeDecision(gen.text);
        if (decision.ok) {
          intentId = decision.intent;
        } else {
          degraded = true;
        }
      } else {
        degraded = true;
      }
    } catch {
      degraded = true;
    }

    if (!intentId) {
      const rule = aiFallback.parse(input);
      intentId = rule && aiValidate.INTENT_IDS.has(rule.intent) ? rule.intent : "observe";
      degraded = true;
    }

    const outcome = executeIntent(save, intentId, input) || executeIntent(save, "observe", input);
    if (outcome.patch) {
      // F025：await AI 期间存档可能已被其它写入改动，outcome.patch 是相对旧
      // 快照的绝对值。重读存档，把 patch 隐含的增量套到新快照上再夹紧写回。
      const fresh = store.getSave(save.id) || save;
      store.updateSave(save.id, aiValidate.applyVitalsDelta(save, fresh, outcome.patch));
    }
    const questNote = settleDailyQuests(save.id, input);
    const reply = store.appendLog(
      save.id,
      outcome.role,
      questNote ? `${outcome.content}\n${questNote}` : outcome.content
    );
    const payload = { reply, intent: outcome.intent, save: saveView(store.getSave(save.id)) };
    if (outcome.shadows) payload.shadows = outcome.shadows;
    if (degraded) payload.degraded = true;
    res.json(payload);
  } catch (err) {
    // 兜底中的兜底：任何意外都不能让请求 5xx 或挂起。
    try {
      if (!res.headersSent) {
        res.json({
          reply: { role: "system", content: "【系统】叙事链路暂时紊乱，请先「观察」四周。" },
          intent: "observe",
          degraded: true,
        });
      }
    } catch {
      /* nothing left to do */
    }
  }
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
