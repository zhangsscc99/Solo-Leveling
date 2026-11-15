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
const combatEngine = require("./engine/combat");
const encounterEngine = require("./engine/encounter");
const lootEngine = require("./engine/loot");
const statsEngine = require("./engine/stats");
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

// F074 场景运行时：主线进度 = 当前场景在本章主线链中的位置 + 1，
// chapter_total = 主线链长度（支线场景不计入）。save.scene 缺失或错章时
// 按主线链首场景展示（与「前进」结算的自愈落点一致），所以新档也能直接
// 拿到 scene / chapter_progress 字段。chapter_unlock 显性化软门判定：
// 当前章的 unlock 要求对照存档等级（level_ok=false 时客户端据 hint 提示）。
function sceneView(save) {
  const chapter = chaptersEngine.getChapter(save && save.chapter);
  const scene = chaptersEngine.currentScene(save);
  const base = {
    scene: scene ? scene.id : null,
    scene_title: null,
    scene_index: -1,
    chapter_steps: 0,
    chapter_total: 0,
    chapter_progress: "0/0",
    chapter_completed: false,
    chapter_unlock: null,
    next_choices: [],
  };
  if (!chapter || !scene) return base;
  const total = chaptersEngine.chapterPath(chapter).length;
  const idx = chaptersEngine.pathIndexOf(chapter, scene.id);
  const steps = idx + 1;
  const gate = chaptersEngine.unlockedFor(save, chapter);
  return {
    scene: scene.id,
    scene_title: scene.title,
    scene_index: idx,
    chapter_steps: steps,
    chapter_total: total,
    chapter_progress: `${steps}/${total}`,
    chapter_completed: idx >= 0 && idx === total - 1,
    chapter_unlock: {
      level: gate.level,
      chapter: gate.chapter,
      level_ok: gate.level_ok,
      hint: gate.level === null ? null : `需 Lv.${gate.level}`,
    },
    next_choices: (Array.isArray(scene.choices) ? scene.choices : [])
      .slice(0, 3)
      .map((c) => ({ id: c.id, label: c.label })),
  };
}

// F088 交战视图：无交战返回 null；有交战暴露敌人完整面板数据
// （名/等级/HP/攻/防）与回合数，战斗面板据此挂载真实数值。
function combatView(combat) {
  if (!combat || !combat.enemy || typeof combat.enemy !== "object") return null;
  const e = combat.enemy;
  return {
    enemy: {
      id: e.id ?? null,
      name: e.name || "敌人",
      rank: e.rank || "E",
      level: Math.max(1, Math.trunc(Number(e.level) || 1)),
      hp: Math.max(0, Math.trunc(Number(e.hp) || 0)),
      max_hp: Math.max(1, Math.trunc(Number(e.maxHp ?? e.max_hp) || 1)),
      atk: Math.max(0, Math.trunc(Number(e.atk) || 0)),
      def: Math.max(0, Math.trunc(Number(e.def) || 0)),
    },
    turn: Math.max(1, Math.trunc(Number(combat.turn) || 1)),
    started_at: combat.started_at || null,
  };
}

// 出参统一带派生字段：xp_to_next 由等级曲线算出，free_points 兜底 0。
// cleared 是通关唯一判定（endingEngine.hasCleared：当前场景为 ch8_epilogue），
// 前端「结算」tab 与 /saves/:id/ending 门禁共用同一结论，不各自推导。
function saveView(save) {
  if (!save) return save;
  return {
    ...save,
    ...sceneView(save),
    free_points: Number(save.free_points) || 0,
    kills: Number(save.kills) || 0,
    deaths: Number(save.deaths) || 0,
    combat: combatView(store.getCombat(save.id)),
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

// 掉落素材的展示名：drops.json 的掉落物是「素材」，不在装备/道具目录
// （items.json）里，播报与背包展示都需要中文名兜底。
const LOOT_NAMES = {
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

function lootName(itemId) {
  return (ITEMS.get(itemId) || {}).name || LOOT_NAMES[itemId] || itemId;
}
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

// 与 db.js 同一个库文件：DB_PATH 覆盖时两边必须指向同一处，否则背包
// 写入与存档读写会落进两个库。
const INV_DB = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, "..", "data", "game.db");
const db = new Database(INV_DB);

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


// 推进体力消耗（沿用原数值）：HP-3、MP-2，下限一律 0——F077 起不再夹
// 在 1，耗尽可能触发死亡回溯。数值没动过的一律不进文案——HP 已 0 时
// 不得输出「HP 0→0」这种虚构消耗，只写「体力已见底」。
function vitalsCost(save) {
  const hp = clamp(save.hp - 3, 0, save.max_hp);
  const mp = clamp(save.mp - 2, 0, save.max_mp);
  const parts = [];
  if (hp !== save.hp) parts.push(`HP ${save.hp}→${hp}`);
  if (mp !== save.mp) parts.push(`MP ${save.mp}→${mp}`);
  const note = parts.length ? `（体力消耗 ${parts.join(" · ")}）` : "（体力已见底）";
  return { patch: { hp, mp }, note };
}

// 章节门（F075）：站在本章主线链尾再前进 = 本章主线完成，结算准入。
// 准入通过 → chapter+1 并落到下一章主线链首场景，同时写入一行主线播报；
// 准入失败 → 留在当前场景，仅提示门槛。等级门当前是软门：等级不足也放行，
// 但播报必须显性写出压制提示，不得静默（见 chapters.js 的 TODO(F088)）。
function chapterGate(save, chapter, nextChapter, vit) {
  const gate = chaptersEngine.unlockedFor(save, nextChapter);
  if (!gate.ok) {
    const need =
      gate.level !== null ? `需 Lv.${gate.level}` : `需先抵达第${gate.chapter}章`;
    return {
      patch: vit.patch,
      content:
        `【主线】通往第${nextChapter.index}章的门没有开启——${need} 才能进入第${nextChapter.index}章。\n` +
        vit.note,
    };
  }
  const first = chaptersEngine.firstSceneOf(nextChapter);
  const suppressed =
    gate.level_ok === false && gate.level !== null
      ? `（等级未达 Lv.${gate.level}，系统压制了传送门——继续任务/战斗提升等级）`
      : "";
  return {
    patch: { ...vit.patch, scene: first.id, chapter: nextChapter.index },
    content:
      `【主线】第${nextChapter.index}章「${nextChapter.title}」开启${suppressed}。\n` +
      `${first.text}\n${vit.note}`,
  };
}

// 「前进」结算：严格沿本章主线链推进 save.scene，日志正文一律用落点
// 场景的真实 text。落到链尾场景 = 本章主线完成（播报写出 N/N），站在
// 链尾再前进触发章节门；全篇终点（ch8_epilogue）只输出收束提示——
// 结局正文在抵达 epilogue 时已输出一次，之后不得重复打印。
function advanceOutcome(save) {
  const chapter = chaptersEngine.getChapter(save.chapter);
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  if (!path.length) {
    return { patch: null, content: "【系统】前路在此断裂，暂无可以踏足之地。" };
  }
  const vit = vitalsCost(save);
  const idx = chaptersEngine.pathIndexOf(chapter, save.scene);

  // 自愈落点：save.scene 为空、悬空、错章或落在主线链之外（支线场景，
  // 支线只能通过 choice 进入、不占主线步序）→ 一律落到主线链首场景。
  if (idx < 0) {
    return {
      patch: { ...vit.patch, scene: path[0].id },
      content: `${path[0].text}\n${vit.note}`,
    };
  }

  const nextChapter = chaptersEngine.getChapter(chapter.index + 1);

  // 已站在主线链尾：再前进即过门穿章；没有下一章 = 全篇终点，
  // 只给收束提示，不重复输出结局正文。
  if (idx === path.length - 1) {
    if (!nextChapter) {
      return {
        patch: vit.patch,
        content: `【系统】此处已是故事的终章，再无前路。\n${vit.note}`,
      };
    }
    return chapterGate(save, chapter, nextChapter, vit);
  }

  const next = path[idx + 1];
  // 这一步将抵达主线链尾 = 本章 N/N 集满：播报写出完成状态，
  // saveView 同步暴露 chapter_completed。
  const completeNote =
    idx + 1 === path.length - 1 ? `\n【主线】本章主线 ${path.length}/${path.length} 完成。` : "";
  return {
    patch: { ...vit.patch, scene: next.id },
    content: `${next.text}${completeNote}\n${vit.note}`,
  };
}

// ---------------------------------------------------------------------------
// F077/F082/F088 结算辅助：遭遇判定、死亡回溯、统一奖励、战斗回合
// ---------------------------------------------------------------------------

// F082 统一奖励入口：所有 XP 来源（每日任务/主线奖励/战斗击杀）都走这里，
// 经 progression.applyXp 结算（跨多级循环、60 封顶）后落库 level/xp/
// free_points/max_hp/max_mp（升级时 HP/MP 自动回满，与 applyXp 语义一致）。
// 返回播报行数组；没有可入账内容时返回空数组。
function grantRewards(saveId, reward) {
  const r = reward && typeof reward === "object" ? reward : {};
  const xp = Math.max(0, Math.trunc(Number(r.xp) || 0));
  const gold = Math.max(0, Math.trunc(Number(r.gold) || 0));
  const items = Array.isArray(r.items) ? r.items : [];
  const save = store.getSave(saveId);
  if (!save) return [];

  const patch = {};
  const lines = [];
  if (xp > 0) {
    const { state, events } = progression.applyXp(save, xp);
    patch.xp = state.xp;
    patch.level = state.level;
    patch.free_points = state.free_points;
    patch.max_hp = state.max_hp;
    patch.max_mp = state.max_mp;
    patch.hp = state.hp;
    patch.mp = state.mp;
    if (state.rank && state.rank !== save.rank) patch.rank = state.rank;
    for (const e of events) {
      if (e.type === "levelup") {
        lines.push(
          `【升级】Lv.${e.level - 1} → Lv.${e.level} · 自由属性点 +${e.freePoints} · HP/MP 上限提升`
        );
      } else if (e.type === "rankup") {
        lines.push(`【晋升】猎人等级提升——你已突破界限，晋升为 ${e.rank} 级猎人。`);
      }
    }
  }
  if (gold > 0) patch.gold = (Number(save.gold) || 0) + gold;
  if (Object.keys(patch).length) store.updateSave(saveId, patch);
  for (const item of items) {
    if (item && item.id && Math.trunc(Number(item.qty)) > 0) {
      invStmts.add.run(saveId, item.id, Math.trunc(Number(item.qty)));
    }
  }
  return lines;
}

// 主线奖励（quests.json main_rewards）：抵达本章主线链尾时入账，一次且仅
// 一次——save.rewards 记已领章节 id，重复通关同一章不重复发。
function claimMainReward(saveId, chapterId) {
  const save = store.getSave(saveId);
  if (!save) return [];
  const claimed = Array.isArray(save.rewards) ? save.rewards : [];
  if (claimed.includes(chapterId)) return [];
  const chapter = chaptersEngine.getChapter(chapterId);
  if (!chapter) return [];
  const reward = (QUESTS.main_rewards && QUESTS.main_rewards[chapterId]) || {
    xp: 100 * chapter.index,
    gold: 50 * chapter.index,
  };
  const lines = grantRewards(saveId, reward);
  store.updateSave(saveId, { rewards: [...claimed, chapterId] });
  const parts = [`XP +${reward.xp || 0}`, `金币 +${reward.gold || 0}`];
  if (Array.isArray(reward.items) && reward.items.length) {
    parts.push(reward.items.map((i) => `${i.name} ×${i.qty}`).join("、"));
  }
  return [`【主线】第${chapter.index}章主线达成，奖励入账 ${parts.join(" · ")}。`, ...lines];
}

// F077 死亡结算：HP ≤ 0 触发系统回溯——清交战态、回溯至本章起点、
// HP/MP 恢复至上限一半、deaths+1。返回播报行，未死返回 null。
function settleDeath(saveId) {
  const save = store.getSave(saveId);
  if (!save || save.hp > 0) return null;
  const chapter = chaptersEngine.getChapter(save.chapter) || chaptersEngine.getChapter(1);
  const first = chapter ? chaptersEngine.firstSceneOf(chapter) : null;
  store.updateSave(saveId, {
    hp: Math.max(1, Math.round(save.max_hp * 0.5)),
    mp: Math.max(0, Math.round(save.max_mp * 0.5)),
    chapter: chapter ? chapter.index : 1,
    scene: first ? first.id : null,
    deaths: (Number(save.deaths) || 0) + 1,
    encounter_clock: 0,
  });
  store.clearCombat(saveId);
  const title = chapter ? `「${chapter.title}」` : "";
  return [
    "【系统】你倒下了……视野在尖锐的警报声里碎成一片黑雪。",
    `【系统】你被系统回溯至第${chapter ? chapter.index : 1}章${title}的起点，伤势被时间抚平了一部分（HP/MP 恢复至上限的一半）。`,
  ];
}

// F088 遭遇判定：boss 场景必遇本章 boss；否则按保底计数/章节遭遇率掷点
// （种子 = 存档 + 场景 + 落空计数，确定性可复现）。
function tryEncounter(save, sceneId) {
  const scene = chaptersEngine.getScene(sceneId);
  const chapter = chaptersEngine.getChapter(save.chapter);
  if (!scene || !chapter) return null;
  const clock = Math.max(0, Math.trunc(Number(save.encounter_clock) || 0));
  const seed = `${save.id}:${scene.id}:${clock}`;
  return encounterEngine.roll({ chapterIndex: chapter.index, scene, clock, seed });
}

// 「前进」结算 + 交战态收敛 + 遭遇判定（F074/F077/F088 交汇点）：
//   1) 交战中前进 = 强行脱离：先甩开敌人再正常推进，撤离中不再掷遭遇；
//   2) 正常推进落到新场景 → boss 场景必遇本章 boss，否则按保底/遭遇率掷点；
//   3) 落到主线链尾 → grantMain，由调用方统一发章节奖励；
//   4) 场景真正移动才产出 advance 事件喂每日任务，原地踏步不计。
function advanceWithEncounter(save) {
  const cbt = store.getCombat(save.id);
  const out = advanceOutcome(save);
  const patch = out.patch ? { ...out.patch } : null;
  const moved = Boolean(patch && typeof patch.scene === "string");
  const res = {
    patch,
    content: out.content,
    events: moved ? ["advance"] : [],
    combat: null,
    rewards: null,
    grantMain: null,
  };
  if (!moved) return res;

  // 主线链尾 = 本章主线完成：无论是否带着敌人逃进来，奖励都照常入账。
  const chapter = chaptersEngine.getChapter(patch.chapter || save.chapter);
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  if (chapter && path.length && patch.scene === path[path.length - 1].id) {
    res.grantMain = chapter.id;
  }

  if (cbt) {
    // 撤离推进：清掉旧交战态，落点不再掷遭遇（否则永远走不出战斗）。
    res.combat = { op: "clear" };
    res.content = `你且战且退，甩开了${cbt.enemy.name}的纠缠。\n${out.content}`;
    return res;
  }

  const enemy = tryEncounter({ ...save, chapter: patch.chapter || save.chapter }, patch.scene);
  if (enemy) {
    res.combat = { op: "set", enemy, turn: 1 };
    res.patch.encounter_clock = 0;
    res.content += `\n【遭遇】${enemy.name} Lv.${enemy.level} 拦住了去路——它的 HP ${enemy.maxHp}/${enemy.maxHp}。`;
  } else {
    res.patch.encounter_clock = (Math.max(0, Math.trunc(Number(save.encounter_clock) || 0))) + 1;
  }
  return res;
}

// 「释放技能 X」前置校验：名字解析、已习得、MP 足够（按 skills.json 的
// mp_cost 口径，与技能面板按钮的 disabled 判定一致）。校验不过时返回
// 一条诚实文案——不扣 MP、不占回合、不产生 skill 结算事件。
function skillGate(save, input) {
  const m = String(input || "").match(
    /释放技能\s*[:：]?\s*(.+)$|施放技能\s*[:：]?\s*(.+)$|使用技能\s*[:：]?\s*(.+)$|施放\s*[:：]?\s*(.+)$|释放\s*[:：]?\s*(.+)$/
  );
  const name = m ? (m.slice(1).find((g) => g) || "").trim() : "";
  if (!name) {
    const learned = SKILLS.filter((s) => s.learn_level <= save.level).map((s) => `「${s.name}」`).join("、");
    return {
      ok: false,
      content: `【系统】要释放哪个技能？${learned ? `已习得：${learned}。` : "你还没有习得任何技能。"}`,
    };
  }
  const skill = SKILLS.find((s) => s.name === name || s.id === name);
  if (!skill) return { ok: false, content: `【系统】不存在名为「${name}」的技能。` };
  if (skill.learn_level > save.level) {
    return { ok: false, content: `【系统】等级不足——「${skill.name}」需要 Lv.${skill.learn_level}。` };
  }
  if (save.mp < skill.mp_cost) {
    return { ok: false, content: `【系统】魔力不足——「${skill.name}」需要 ${skill.mp_cost} MP（当前 ${save.mp}）。` };
  }
  return { ok: true, skill };
}

// 交战中统一走 engine/combat.js resolveTurn 结算一回合。种子由存档 +
// 开战时间 + 回合数构成，确定性可复现；事件文案全部由引擎产出，本函数
// 只做落库参数与播报拼装（HP/MP 变化如实写出，不变不写）。
function combatTurn(save, cbt, action, input) {
  let itemNote = "";
  if (action === "item") {
    if (save.hp >= save.max_hp) {
      return { patch: null, content: "【系统】生命值已满，无需使用补给。", events: [] };
    }
    // 道具必须真实消耗：玩家点名（「使用道具 低级治疗药水」）优先，
    // 否则挑背包里回复量最低的一瓶可用补给先喝。
    const usable = store
      .getInventory(save.id)
      .map((row) => ({ row, item: ITEMS.get(row.item_id) }))
      .filter((x) => x.item && x.item.category === "consumable" && x.row.qty > 0);
    if (!usable.length) {
      return { patch: null, content: "【系统】背包里已没有可用的补给。", events: [] };
    }
    const named = String(input || "").match(/使用道具\s*[:：]?\s*(.+)$|道具\s*[:：]?\s*(.+)$/);
    const want = named ? (named.slice(1).find((g) => g) || "").trim() : "";
    let picked = want
      ? usable.find((x) => x.item.name === want || x.item.id === want)
      : null;
    if (want && !picked) {
      return { patch: null, content: `【系统】背包里没有名为「${want}」的可用补给。`, events: [] };
    }
    if (!picked) {
      picked = usable.sort(
        (a, b) => (a.item.heal || 0) + (a.item.mp || 0) - ((b.item.heal || 0) + (b.item.mp || 0))
      )[0];
    }
    if (picked.row.qty <= 1) invStmts.remove.run(save.id, picked.item.id);
    else invStmts.setQty.run(picked.row.qty - 1, save.id, picked.item.id);
    itemNote = `你喝下「${picked.item.name}」。`;
  }

  const equip = equipView(save.id);
  // 装备加成折算进五项属性，与 stats.js 公式严格互逆：+攻按 1.6/点 折
  // 力量，+防按 0.8/点 折体力——不新造一套属性算法。
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.strength += (equip.atk || 0) / 1.6;
  stats.vitality += (equip.def || 0) / 0.8;

  const seed = `combat:${save.id}:${cbt.started_at || "?"}:${cbt.turn}`;
  const { state, events } = combatEngine.resolveTurn(
    {
      turn: cbt.turn,
      player: {
        name: save.player_name,
        level: save.level,
        rank: save.rank,
        hp: save.hp,
        maxHp: save.max_hp,
        mp: save.mp,
        maxMp: save.max_mp,
        stats,
      },
      enemy: cbt.enemy,
    },
    action,
    seed
  );

  const p = state.player;
  const e = state.enemy;
  const patch = {
    hp: clamp(p.hp, 0, save.max_hp),
    mp: clamp(p.mp, 0, save.max_mp),
  };

  const enemyHpBefore = Math.max(0, Math.trunc(Number(cbt.enemy.hp) || 0));
  const vitals = [];
  const enemyHpAfter = Math.max(0, Math.trunc(Number(e.hp) || 0));
  if (enemyHpAfter !== enemyHpBefore) vitals.push(`${e.name} HP ${enemyHpBefore}→${enemyHpAfter}`);
  if (patch.hp !== save.hp) vitals.push(`你 HP ${save.hp}→${patch.hp}`);
  if (patch.mp !== save.mp) vitals.push(`MP ${save.mp}→${patch.mp}`);

  let content =
    `【战斗】第${cbt.turn}回合 · ` +
    (itemNote ? `${itemNote} ` : "") +
    events.map((ev) => ev.text).join(" · ");
  if (vitals.length) content += `\n【战斗】${vitals.join(" · ")}`;

  const res = { patch, content, events: [], combat: null, rewards: null, grantMain: null };
  if (action === "skill" && patch.mp < save.mp) res.events.push("skill");

  const fled = events.some((ev) => ev.type === "flee" && ev.side === "player");
  if (e.hp <= 0) {
    // 击杀：kills+1、掉落（loot 引擎同种子掷点）与 XP 入账，交战态收敛。
    res.events.push("kill");
    patch.kills = (Number(save.kills) || 0) + 1;
    res.combat = { op: "clear" };
    const loot = lootEngine.rollLoot(cbt.enemy.id, cbt.enemy.rank, `${seed}:loot`);
    const xp = Math.max(0, Math.trunc(Number(cbt.enemy.xp) || 0));
    res.rewards = {
      xp,
      gold: loot.gold,
      items: loot.items.map((i) => ({ id: i.item_id, qty: i.qty })),
    };
    const parts = [`XP +${xp}`, `金币 +${loot.gold}`];
    if (loot.items.length) {
      parts.push(loot.items.map((i) => `${lootName(i.item_id)} ×${i.qty}`).join("、"));
    }
    res.content += `\n【战斗】击败 ${e.name}，获得 ${parts.join(" · ")}。`;
  } else if (fled || patch.hp <= 0) {
    // 逃跑成功 / 玩家倒下：交战态都必须收敛。死亡由 settleDeath 统一结算。
    res.combat = { op: "clear" };
  } else {
    res.combat = { op: "turn", enemy: e, turn: state.turn };
  }
  return res;
}

// 无交战时的战斗意图：attack/skill 先过遭遇表（命中即开战），miss 则
// 诚实播报「周围没有可攻击的目标」——不扣血、不加击杀、不占资源。
// defend/item/flee 在非战斗场景同样只给诚实提示。
function peacefulCombatIntent(save, input, action) {
  if (action === "attack" || action === "skill") {
    if (action === "skill") {
      const gate = skillGate(save, input);
      if (!gate.ok) return { patch: null, content: gate.content, events: [] };
    }
    const scene = chaptersEngine.currentScene(save);
    const enemy = tryEncounter(save, scene ? scene.id : null);
    if (enemy) {
      return {
        patch: { encounter_clock: 0 },
        content: `【遭遇】${enemy.name} Lv.${enemy.level} 应声现身，拦住了去路——它的 HP ${enemy.maxHp}/${enemy.maxHp}。`,
        events: [],
        combat: { op: "set", enemy, turn: 1 },
      };
    }
    return {
      patch: {
        encounter_clock: Math.max(0, Math.trunc(Number(save.encounter_clock) || 0)) + 1,
      },
      content: "【系统】你摆出战斗架势，四周却空无一物——周围没有可攻击的目标。",
      events: [],
    };
  }
  const lines = {
    defend: "【系统】你架起防御姿态，四周却空无一人——周围没有可攻击的目标。",
    item: "【系统】周围没有可攻击的目标——补给留到真正的战斗时再用。",
    flee: "【系统】四周并没有需要逃离的敌人。",
  };
  return { patch: null, content: lines[action], events: [] };
}

function combatIntent(save, input, action) {
  const cbt = store.getCombat(save.id);
  if (!cbt) return peacefulCombatIntent(save, input, action);
  if (action === "skill") {
    const gate = skillGate(save, input);
    if (!gate.ok) return { patch: null, content: gate.content, events: [] };
  }
  return combatTurn(save, cbt, action, input);
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
    id: "attack",
    role: "system",
    build: (save, input) => combatIntent(save, input, "attack"),
  },
  {
    id: "skill",
    role: "system",
    build: (save, input) => combatIntent(save, input, "skill"),
  },
  {
    id: "defend",
    role: "system",
    build: (save, input) => combatIntent(save, input, "defend"),
  },
  {
    id: "item",
    role: "system",
    build: (save, input) => combatIntent(save, input, "item"),
  },
  {
    id: "flee",
    role: "system",
    build: (save, input) => combatIntent(save, input, "flee"),
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
        "遭遇战中：「攻击」「释放技能 <名字>」「防御」「使用道具」「逃跑」或「前进」强行撤离\n" +
        "其余自由输入将交由叙事层判定，未识别的动作不会改变状态。",
    }),
  },
  {
    id: "observe",
    role: "narrator",
    build: (save) => {
      const chapter = chaptersEngine.getChapter(save.chapter);
      const scene = chapter ? chaptersEngine.currentScene(save) : null;
      if (!scene) {
        return { patch: null, content: "你环顾四周，只有浓得化不开的黑暗。" };
      }
      // 「观察」是免费环顾：只重读当前场景输出观察叙述，不写 save.scene、
      // 不扣 HP/MP。分支推进留给显式 choice_id 指令，绝不按 label 猜测。
      return {
        patch: null,
        content: `你放慢呼吸，重新审视「${scene.title}」。\n${scene.text}`,
      };
    },
  },
  {
    id: "advance",
    role: "narrator",
    build: (save) => advanceWithEncounter(save),
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
          (mp !== save.mp ? `（魔力消耗 MP ${save.mp}→${mp}）` : "（魔力已见底）"),
      };
    },
  },
  {
    id: "rest",
    role: "narrator",
    build: (save) => {
      const hp = clamp(save.hp + 15, 0, save.max_hp);
      const mp = clamp(save.mp + 8, 0, save.max_mp);
      const deltas = [];
      if (hp !== save.hp) deltas.push(`HP ${save.hp}→${hp}`);
      if (mp !== save.mp) deltas.push(`MP ${save.mp}→${mp}`);
      return {
        patch: { hp, mp },
        content:
          `你背靠石柱坐下，闭上眼调整呼吸。系统在视野边缘安静地跳动着，体力与魔力一点点回流。\n` +
          (deltas.length ? `（恢复 ${deltas.join(" · ")}）` : "（状态已是满值）"),
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
// build 出参的 events/combat/rewards/grantMain 是真实结算事件与副作用
// 描述，由 applyOutcome 统一落库（战斗态写删、奖励入账、死亡回溯、
// 每日任务推进）。
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
    events: built.events || [],
    combat: built.combat || null,
    rewards: built.rewards || null,
    grantMain: built.grantMain || null,
  };
}

// 结算副作用统一管线（/action 与 /ai-action 共用）：
//   patch → 战斗态写/删 → 死亡回溯 → 击杀/杂项奖励 → 主线奖励 → 每日任务。
// 死亡优先于发奖：HP 归零先复活再走 XP 结算，「倒下」播报不被升级覆盖。
function applyOutcome(saveId, outcome) {
  if (outcome.patch) store.updateSave(saveId, outcome.patch);
  if (outcome.combat) {
    if (outcome.combat.op === "set") {
      store.setCombat(saveId, outcome.combat.enemy, outcome.combat.turn || 1);
    } else if (outcome.combat.op === "turn") {
      store.setCombatTurn(saveId, outcome.combat.enemy, outcome.combat.turn);
    } else if (outcome.combat.op === "clear") {
      store.clearCombat(saveId);
    }
  }
  const lines = [];
  const death = settleDeath(saveId);
  if (death) lines.push(...death);
  if (outcome.rewards) lines.push(...grantRewards(saveId, outcome.rewards));
  if (outcome.grantMain) lines.push(...claimMainReward(saveId, outcome.grantMain));
  const questNote = settleDailyQuests(saveId, outcome.events);
  if (questNote) lines.push(questNote);
  return lines;
}

function resolveAction(save, input) {
  const intentId = intentRules.resolveIntent(input);
  if (intentId) {
    return executeIntent(save, intentId, input);
  }
  // 交战中收到无法解析的输入：给战斗指令提示而不是通用占位句。
  const cbt = store.getCombat(save.id);
  return {
    intent: "unknown",
    role: PLACEHOLDER.role,
    patch: null,
    events: [],
    content: cbt
      ? `【系统】你正与${cbt.enemy.name}交战——「攻击」「释放技能 X」「防御」「使用道具」「逃跑」，或「前进」强行撤离。`
      : `【系统】指令已接收：「${input}」。命运之线仍在编织中……（叙事引擎尚未接入，此处为占位回应。输入「帮助」查看当前可用指令。）`,
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
    // F088：交战中补给必须占一回合（敌人会反击），走 /action 的
    // 「使用道具」战斗指令，不走这条免回合的直接补给通道。
    if (store.getCombat(save.id)) {
      return res.status(400).json({ error: "交战中请用「使用道具」战斗指令" });
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

// 每日任务结算（F080/F088）：只消费真实结算事件——advance/kill/skill
// 由白名单意图与战斗结算产出，不再对玩家输入文本跑正则，空挥攻击、
// 占位技能一律不计数。完成的任务当场经 grantRewards 入账（XP 达标
// 即触发升级），完成播报与升级播报一起并进本条回复。
function settleDailyQuests(saveId, events) {
  const list = Array.isArray(events)
    ? events.filter((e) => questEngine.VALID_EVENTS.includes(e))
    : [];
  if (!list.length) return null;
  const key = questEngine.dayKey(new Date());
  const { updates, completed } = questEngine.applyDailyEvents(
    QUESTS.daily,
    store.getDailyQuests(saveId, key),
    list
  );
  for (const u of updates) {
    store.setDailyQuest(saveId, key, u.quest_id, u.progress, u.done);
  }
  if (!completed.length) return null;

  const total = questEngine.mergeRewards(completed);
  const rewardLines = grantRewards(saveId, total);
  const names = completed.map((q) => `「${q.title}」`).join("、");
  const parts = [`XP +${total.xp}`, `金币 +${total.gold}`];
  if (total.items.length) parts.push(total.items.map((i) => `${i.name} ×${i.qty}`).join("、"));
  return [`【任务】每日任务完成：${names}。奖励已入账 ${parts.join(" · ")}。`, ...rewardLines].join("\n");
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
  // 真实结算事件随动作入账：战斗态/奖励/死亡回溯/每日任务都在
  // applyOutcome 里收敛，播报并进本条回复，不重开日志行。
  const extra = applyOutcome(save.id, outcome);
  const reply = store.appendLog(
    save.id,
    outcome.role,
    extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content
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

    // F025：await AI 期间存档可能已被其它写入改动——先重读最新存档再结算，
    // outcome.patch 基于新快照产出，不再做旧快照增量回算。
    const fresh = store.getSave(save.id) || save;
    const outcome = executeIntent(fresh, intentId, input) || executeIntent(fresh, "observe", input);
    const extra = applyOutcome(save.id, outcome);
    const reply = store.appendLog(
      save.id,
      outcome.role,
      extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content
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

// 集成测试需要 in-process 拉起 app（临时端口），因此只在作为入口直接
// 运行时才监听端口。node --test server/ 会把包 main（本文件）当测试子
// 进程拉起——此时 NODE_TEST_CONTEXT 存在，也不许占端口。
if (require.main === module && !process.env.NODE_TEST_CONTEXT) {
  app.listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`solo-leveling listening on http://${HOST}:${PORT}${BASE}`);
  });
}

module.exports = { app, saveView, grantRewards };
