const fs = require("fs");
const path = require("path");
const express = require("express");
const store = require("./db");
const progression = require("./engine/progression");
const chaptersEngine = require("./engine/chapters");
const questEngine = require("./engine/quests");
const shadowEngine = require("./engine/shadow");
const endingEngine = require("./engine/ending");
const combatEngine = require("./engine/combat");
const encounterEngine = require("./engine/encounter");
const lootEngine = require("./engine/loot");
const proseEngine = require("./engine/prose");
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
    next_chapter: null,
    next_choices: [],
  };
  if (!chapter || !scene) return base;
  const total = chaptersEngine.chapterPath(chapter).length;
  const idx = chaptersEngine.pathIndexOf(chapter, scene.id);
  // F114 单一事实源：chapter_steps 只由当前场景在主线链上的位置推导
  // （站位 + 1；站位不在链上记 0）——不再叠加 main_steps 高水位，
  // 位置与进度是一本账：回溯退几幕，计数就退几幕。
  const steps = Math.min(total, Math.max(0, idx + 1));
  // F117 章尾入口数据：下一章的章号/章名随存档下发，主按钮
  // 「进入第N章 · 章名」按字段渲染——章名取自数据，前端不写死。
  const nextChapter = chaptersEngine.getChapter(chapter.index + 1);
  return {
    scene: scene.id,
    scene_title: scene.title,
    scene_index: idx,
    chapter_steps: steps,
    chapter_total: total,
    chapter_progress: `${steps}/${total}`,
    chapter_completed: total > 0 && steps >= total,
    // F116 单一事实源：软门三态（locked/soft/open）+ 未达前置 +
    // 服务端文案与 /api/chapters 同出自 chaptersEngine.unlockView。
    chapter_unlock: chaptersEngine.unlockView(save, chapter),
    next_chapter: nextChapter
      ? {
          index: nextChapter.index,
          id: nextChapter.id,
          title: nextChapter.title,
          subtitle: nextChapter.subtitle,
        }
      : null,
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
      boss: Boolean(e.boss),
    },
    turn: Math.max(1, Math.trunc(Number(combat.turn) || 1)),
    started_at: combat.started_at || null,
    // 开战盐：连续两场战斗的 seq 必不同（断言可直接比对）。
    seq: Number.isFinite(e.seq) ? e.seq : null,
  };
}

// F089 终章收束：一次性拒绝文案。/action、/ai-action 的入口短路与
// advanceOutcome 的兜底共用同一句——无论连点多少次，玩家看到的永远是
// 这同一条指引，且（经入口短路时）一行日志都不产生。
const EPILOGUE_REFUSAL =
  "【系统】已抵达故事的终章，前路已尽。打开「结算」面板，回看这一路的战绩。";

// 终章拒绝回复不落库，拿不到真实日志行号——用递减负数占位作前端渲染
// key，与真实行号域（>=1）天然不撞。
let epilogueReplySeq = 0;

// 出参统一带派生字段：xp_to_next 由等级曲线算出，free_points 兜底 0。
// cleared 是通关唯一判定（endingEngine.hasCleared：当前场景为 ch8_epilogue），
// 前端「结算」tab 与 /saves/:id/ending 门禁共用同一结论，不各自推导。
// F086 休息配额：每章 REST_LIMIT 次，跨章重置；可用性与剩余次数随
// saveView 暴露给前端（按钮 disabled + 原因文案都由这里给，前端不
// 硬编码口径）。reason 为 null 表示可休息。
const REST_LIMIT = 3;

function restStatus(save, combat) {
  const used = Math.max(0, Math.trunc(Number(save && save.rest_used) || 0));
  const remaining = Math.max(0, REST_LIMIT - used);
  let reason = null;
  if (combat) reason = "交战中无法休息";
  else if (save.hp >= save.max_hp && save.mp >= save.max_mp)
    reason = "体力与魔力俱满，无需休息";
  else if (remaining <= 0) reason = `本章休息次数已用完（0/${REST_LIMIT}）`;
  return { available: reason === null, remaining, reason };
}

// F096 收尾：守关者未击杀时玩家位置不得越过 boss 场景——人站在守关者
// 身后（含主线链尾，多为旧档冷却期穿房的落点）时，「前进」的真实语义是
// 折返回守关房再战而非继续推进。主按钮据此换标「折返守关者」：模式由
// 服务端按主线链位置下发，前端不猜场景。
// F106/F121：人站在守关房内且无交战时出口被门封死（房内「前进」是零
// 消耗拒绝），主按钮的真实语义是「叫阵」——就地发起「攻击」逼守关者
// 现形再战（peacefulCombatIntent 的 bossChallenge 分支压过再入冷却）。
// 房内仍显示「折返守关者」是自相矛盾的软锁：人已在房内、战斗键又无
// 交战目标全灭，玩家没有任何可点的下一步。
function advanceMode(save) {
  const chapter = chaptersEngine.getChapter(save && save.chapter);
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  const idxBoss = path.findIndex((s) => s && s.kind === "boss");
  const idx = chapter ? chaptersEngine.pathIndexOf(chapter, save && save.scene) : -1;
  if (idxBoss >= 0 && idx >= idxBoss && !bossCleared(save, chapter.id)) {
    if (idx === idxBoss && !store.getCombat(save.id)) return "challenge_boss";
    return "retreat_to_boss";
  }
  // F117：站在主线链尾（chapter_completed）且守关者已击杀时，主按钮的
  // 真实语义是「进入下一章」——过门零消耗、不掷遭遇、不计步。章号/章名
  // 经 save.next_chapter 下发，前端按字段换标，不自行推断完成态。
  if (
    idx >= 0 &&
    idx === path.length - 1 &&
    chaptersEngine.getChapter(chapter.index + 1)
  ) {
    return "next_chapter";
  }
  return "advance";
}

// at_epilogue 与 cleared 同值，是 F089 给前端的显式终章态信号——前端按
// 字段渲染「查看结算」入口，不做任何文本匹配。
function saveView(save) {
  if (!save) return save;
  const combat = store.getCombat(save.id);
  const cleared = endingEngine.hasCleared(save);
  const view = {
    ...save,
    ...sceneView(save),
    free_points: Number(save.free_points) || 0,
    kills: Number(save.kills) || 0,
    deaths: Number(save.deaths) || 0,
    combat: combatView(combat),
    // F081：技能可释放性由服务端随存档下发（mp_cost/冷却剩余/解锁/交战
    // 前提），前端只渲染不自行推导——按钮 disabled 与 /action 门禁同一口径。
    skills: skillViews(save, combat),
    rest: restStatus(save, combat),
    advance_mode: advanceMode(save),
    cleared,
    at_epilogue: cleared,
    xp_to_next: progression.xpToNext(save.level),
  };
  // main_steps 是 F114 起不再读写的遗留高水位列（chapter_steps 改由
  // 场景位置单源推导）——不再随视图下发，避免第三方把陈旧高水位当成
  // 第二套进度账与 chapter_steps 对不上。
  delete view.main_steps;
  return view;
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

// 库存/奖励写操作必须与 store（db.js）共用同一条 better-sqlite3 连接：
// applyOutcome 的事务只对单连接生效，另开连接会把发奖写出事务外
// （且 WAL 下单写者会让事务内写互撞 SQLITE_BUSY）。
const db = store.db;

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

// F092 动作文案计数：同一句式的重复动作（观察/潜行）按已产出的叙述行数
// 轮转到池内下一条——确定性可复现（同一日志序列必得同一文本），且同场景
// 连续两次「观察」绝不重文。
const proseStmts = {
  observeCount: db.prepare(
    "SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'narrator' AND content LIKE '你放慢呼吸，重新审视%'"
  ),
  sneakCount: db.prepare(
    "SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'user' AND content = '潜行'"
  ),
  // F125：守关房再入播报的轮转计数——同一句式按已产出行数取池内下一条，
  // 连续两次重入不重文（与 observe 同口径）。
  bossReentryCount: db.prepare(
    "SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'narrator' AND content LIKE '你重新回到「%'"
  ),
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

// F125 守关房再入播报池（守关者未倒下、冷却期落地没有开战）：中性的
// 「回到守关房」一句话，含守关者真名与「仍未倒下」的事实。场景正文里的
// 开场战叙述只属于落地开打/叫阵那一刻，「残骸」只属于已被击杀的守关
// 者——两者都不许出现在再入播报里。≥2 条按已产出行数轮转。
const BOSS_REENTRY_LINES = [
  (sceneTitle, bossName) =>
    `你重新回到「${sceneTitle}」——「${bossName}」仍未倒下，威压隔着殿门沉沉地压过来。`,
  (sceneTitle, bossName) =>
    `你重新回到「${sceneTitle}」。「${bossName}」还立在原地没有倒下——要打，就先叫阵。`,
];

// 本章守关者真名：遭遇表 boss 模板为准（玩家实际交手的实体），兜底主线
// 链上 kind="boss" 场景的标题；都拿不到才回退到通用称谓——数据上 8 章
// 的守关者都有真名，占位串永远不写出。
function chapterBossName(chapter) {
  if (!chapter) return "守关者";
  const boss = encounterEngine.spawnBoss(chapter.index);
  if (boss && boss.name) return boss.name;
  const path = chaptersEngine.chapterPath(chapter);
  const scene = path.find((s) => s && s.kind === "boss");
  return scene && scene.title ? scene.title : "守关者";
}

// 章节门（F075）：站在本章主线链尾再前进 = 本章主线完成，结算准入。
// 准入通过 → chapter+1 并落到下一章主线链首场景，同时写入一行主线播报；
// 准入失败 → 留在当前场景，仅提示门槛。等级门当前是软门：等级不足也放行，
// 但播报必须显性写出压制提示，不得静默（见 chapters.js 的 TODO(F088)）。
// F096 守关者硬门：unlockedFor 通过之后，本章守关者还必须已被击杀
// （bossRequirementMet —— 与主线奖励同一口径：链上无 boss 场景的章
// 自动满足）。未击杀时 patch 不动 chapter/scene，正文给出可执行的
// 下一步（击败守关者，附当前进度）。
// F096 收尾补丁：两条拒绝分支一律零消耗——patch 为 null（HP/MP 原样），
// 正文显性写「本次没有消耗体力」，并挂 refused 标记让路由短路：
// 用户输入与播报都不进日志、不产 advance 事件（账本不写没发生的事）。
// 否则章尾连点「前进」会把玩家原地耗死——门锁了还扣血是死路。
function chapterGate(save, chapter, nextChapter) {
  const gate = chaptersEngine.unlockedFor(save, nextChapter);
  if (!gate.ok) {
    const need =
      gate.level !== null ? `需 Lv.${gate.level}` : `需先抵达第${gate.chapter}章`;
    return {
      patch: null,
      refused: true,
      content:
        `【主线】通往第${nextChapter.index}章的门没有开启——${need} 才能进入第${nextChapter.index}章。\n` +
        `（本次没有消耗体力）`,
    };
  }
  if (!bossRequirementMet(save, chapter)) {
    const path = chaptersEngine.chapterPath(chapter);
    const steps = Math.max(0, chaptersEngine.pathIndexOf(chapter, save.scene) + 1);
    return {
      patch: null,
      refused: true,
      content:
        `【主线】第${chapter.index}章的守关者仍守在那扇门前——` +
        `必须击败「${chapterBossName(chapter)}」才能通过（当前进度 ${steps}/${path.length}）。\n` +
        `（本次没有消耗体力）`,
    };
  }
  const first = chaptersEngine.firstSceneOf(nextChapter);
  const suppressed =
    gate.level_ok === false && gate.level !== null
      ? `（等级未达 Lv.${gate.level}，系统压制了传送门——继续任务/战斗提升等级）`
      : "";
  // F117：过门是章节切换不是一次「前进」——零消耗（patch 不写 HP/MP）、
  // scripted 标记让 advanceWithEncounter 跳过遭遇判定与 advance 事件，
  // 落点 = 下一章主线链首（下一幕才重新开始计步与掷怪）。
  return {
    patch: { scene: first.id, chapter: nextChapter.index },
    scripted: true,
    content:
      `【主线】第${nextChapter.index}章「${nextChapter.title}」开启${suppressed}。\n` +
      `${first.text}\n（本次没有消耗体力）`,
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
    // 断路同样是门拒绝：零消耗、零位移、零日志——与章节门/终章同口径。
    return { patch: null, refused: true, content: "【系统】前路在此断裂，暂无可以踏足之地。" };
  }
  const vit = vitalsCost(save);
  const idx = chaptersEngine.pathIndexOf(chapter, save.scene);

  // 自愈落点：save.scene 为空、悬空、错章或落在主线链之外（支线场景，
  // 支线只能通过 choice 进入、不占主线步序）→ 一律落到主线链首场景。
  // F124：这是异常路径自愈，不是真实推进——scripted 零消耗、不掷遭遇、
  // 不产 advance 事件（账本不写没发生的步数；新档建档即写入链首，
  // 正常玩家不会走到这里）。
  if (idx < 0) {
    return {
      patch: { scene: path[0].id },
      scripted: true,
      content: `${path[0].text}\n（本次没有消耗体力）`,
    };
  }

  const nextChapter = chaptersEngine.getChapter(chapter.index + 1);

  // F096 收尾硬门：守关者未击杀时，玩家位置不得越过本章 boss 场景。
  // 冷却期撤离只换来「不被迫打」，不换来「穿房」——等价口径堵死两条旧
  // 死路（冷却期内一路推进到链尾干等、站在房内再前进直接越过去）：
  const idxBoss = path.findIndex((s) => s && s.kind === "boss");
  const bossAlive = idxBoss >= 0 && !bossCleared(save, chapter.id);
  if (bossAlive && idx === idxBoss) {
    //   a) 人就站在守关房里（F095 逃生阀放进来的，或守关房即链尾）：
    //      「前进」是门拒绝——守关者封着出口，一律 refused 短路：
    //      零 HP/MP、零位移、零日志、零事件（与章节门/终章同口径）。
    //      F106：旧口径「退回上一景并扣体力」是顺序倒置——位移结算
    //      先于门禁成立，线上玩家在房内连点被原地耗死。现在拒绝不改
    //      落点，出路只剩击败守关者（F121：房内主按钮已换标「叫阵守关
    //      者」、点击即发起「攻击」逼它现形；守关战里的逃跑/阵亡仍按
    //      战斗结算位移），不再由「前进」代劳。文案必须指向玩家真实
    //      可点的按钮名——指向自由输入框手打指令是不可发现的死路。
    return {
      patch: null,
      refused: true,
      content:
        `【主线】「${chapterBossName(chapter)}」的威压仍封着出口——` +
        `你无法越过守关者，唯有击败它才能前行（点「叫阵守关者」逼它现形再战）。\n` +
        `（本次没有消耗体力）`,
    };
  }
  if (bossAlive && idx > idxBoss) {
    //   b) 人站在 boss 场景之后（旧档冷却期穿房的落点、含主线链尾）：
    //      「前进」不再干拒绝——折返回守关房。清掉 boss 房再入冷却
    //      （patch.encounter_clock = 0），落地经 tryEncounter 的 boss
    //      分支强制真打（advanceWithEncounter 按 retreatToBoss 传
    //      forceBoss，负冷却挡不住这场再战）。
    return {
      patch: { ...vit.patch, scene: path[idxBoss].id, encounter_clock: 0 },
      retreatToBoss: true,
      content:
        `【主线】守关者还守在那扇门前——你原路折返，回到「${path[idxBoss].title}」。\n` +
        `${vit.note}`,
    };
  }

  // 已站在主线链尾：再前进即过门穿章；没有下一章 = 全篇终点。
  // F089：终章拒绝推进——零体力消耗、零落点改动；正常入口在路由层短路
  // （连日志都不写），这里只是 ai-action 非常规输入映射到 advance 时的
  // 兜底，保证任何路径都扣不到血。
  if (idx === path.length - 1) {
    if (!nextChapter) {
      return { patch: null, refused: true, content: EPILOGUE_REFUSAL };
    }
    return chapterGate(save, chapter, nextChapter);
  }

  // F124 章首铺陈步：人站在本章主线链首（建档落点 / 过门落点 / 死亡
  // 回溯落点）时，「前进」是踏入本章的第一幕剧情推进——零消耗、不掷
  // 遭遇、不产 advance 事件。修法选型：建档即写入真实链首（见 POST
  // /saves），让「1/7」点击前后都是真站位；这一步的免费化则消掉
  // 「开场白同一回包内掉血开战、每日任务空结算」的旧毛病。
  if (idx === 0) {
    const nextScene = path[1];
    return {
      patch: { scene: nextScene.id },
      scripted: true,
      content: `${nextScene.text}\n（本次没有消耗体力）`,
    };
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

// F077 死亡结算：HP ≤ 0 触发系统回溯——清交战态、回溯至本章入口、
// HP/MP 恢复至上限一半、deaths+1。返回播报行，未死返回 null。
// F095：第 1 章「首次」死亡是剧情事件——接入 ch1_death 濒死支线，
// 系统提前完成绑定，一次性补满升级差额（实质 +1 级：满血上限、
// 自由属性点入账），让死亡成为推进而不是零收益循环。触发条件
// chapter===1 && deaths===0，终生只此一次；第 2 章起死亡仍是纯回溯。
// F114：位置与主线计数一本账——chapter_steps 一律由场景位置推导，
// 落回入口计数就回 1，不再有「场景在第 2 幕、计数在第 4 步」的
// 双账态；落点文案取回写后的真实存档场景（是入口写入口），不写死。
// 首死另发一次性保底 XP（DEATH_CONSOLATION_XP，终生一次，deaths>0 后不再
// 发）——死亡给一条出路，但不是刷经验的门。
const DEATH_CONSOLATION_XP = 30;

function settleDeath(saveId) {
  const save = store.getSave(saveId);
  if (!save || save.hp > 0) return null;
  const chapter = chaptersEngine.getChapter(save.chapter) || chaptersEngine.getChapter(1);
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  // F095 入口回溯契约：落点恒为本章主线链首入口；站位不在链上
  // （支线/悬空）时同样落链首——与「前进」的自愈落点同一口径。
  const landing = chapter ? chaptersEngine.firstSceneOf(chapter) : null;
  const patch = {
    chapter: chapter ? chapter.index : 1,
    scene: landing ? landing.id : null,
    deaths: (Number(save.deaths) || 0) + 1,
    encounter_clock: 0,
    encounter_cd: 0,
  };
  const lines = ["【系统】你倒下了……视野在尖锐的警报声里碎成一片黑雪。"];
  const firstDeath = (Number(save.deaths) || 0) === 0;

  let halfOfHp = Number(save.max_hp) || 1;
  let halfOfMp = Number(save.max_mp) || 0;
  if (chapter && chapter.index === 1 && firstDeath) {
    const nearDeath = chaptersEngine.getScene("ch1_death");
    if (nearDeath && nearDeath.text) lines.push(nearDeath.text);
    // 补满距下一级的 XP 差额 → applyXp 结算恰好 +1 级。
    const before = Math.max(1, Math.trunc(Number(save.level) || 1));
    const need = Math.max(1, (Number(progression.xpToNext(before)) || 0) - (Number(save.xp) || 0));
    const { state } = progression.applyXp(save, need);
    if (state.level > before) {
      const gained = Math.max(0, (Number(state.free_points) || 0) - (Number(save.free_points) || 0));
      patch.level = state.level;
      patch.xp = state.xp;
      patch.free_points = state.free_points;
      patch.max_hp = state.max_hp;
      patch.max_mp = state.max_mp;
      halfOfHp = state.max_hp;
      halfOfMp = state.max_mp;
      lines.push(
        `【觉醒】濒死之际，那面蓝色光幕再度展开——【检测到适格个体，「系统」提前完成绑定。】` +
        `等级提升 Lv.${before} → Lv.${state.level} · 自由属性点 +${gained} · HP/MP 上限提升。`
      );
    }
  }

  // F098 首死保底 XP：在觉醒结算之上叠加（无觉醒则单独入账）。只在确实
  // 带来收益（XP 增加或跨级）时写播报——满级档 applyXp 会把 XP 归零，
  // 那种情况不发也不说，文案永远只写真实发生的数值。
  if (firstDeath) {
    const base = { ...save, ...patch };
    const { state } = progression.applyXp(base, DEATH_CONSOLATION_XP);
    const leveled = state.level > (Number(base.level) || 1);
    const gained = state.xp > (Number(base.xp) || 0);
    if (leveled || gained) {
      patch.xp = state.xp;
      patch.level = state.level;
      patch.free_points = state.free_points;
      patch.max_hp = state.max_hp;
      patch.max_mp = state.max_mp;
      if (state.rank && state.rank !== save.rank) patch.rank = state.rank;
      if (leveled) {
        halfOfHp = state.max_hp;
        halfOfMp = state.max_mp;
      }
      lines.push(
        `【系统】初次倒下，系统把逸散的经验重新凝结给你——XP +${DEATH_CONSOLATION_XP}` +
          (leveled ? `，等级提升 Lv.${base.level} → Lv.${state.level}` : "") +
          `。（仅此一次，之后的回溯不再补发）`
      );
    }
  }

  patch.hp = Math.max(1, Math.round(halfOfHp * 0.5));
  patch.mp = Math.max(0, Math.round(halfOfMp * 0.5));
  store.updateSave(saveId, patch);
  store.clearCombat(saveId);
  // 落点文案取回写后的真实存档场景：落在链首才说「入口」，落在第几幕
  // 就写第几幕——播报与 save.scene 永远一致。
  const landed = store.getSave(saveId);
  const landedScene = landed ? chaptersEngine.currentScene(landed) : null;
  const landedIdx = chapter && landedScene ? chaptersEngine.pathIndexOf(chapter, landedScene.id) : -1;
  lines.push(
    `【系统】你被系统回溯至第${chapter ? chapter.index : 1}章` +
      `${landedIdx === 0 ? "的入口" : ""}` +
      `${landedScene ? `「${landedScene.title}」` : ""}，` +
      `伤势被时间抚平了一部分（HP/MP 恢复至上限的一半）。`
  );
  if (chapter && path.length && landedIdx >= 0) {
    lines.push(
      `【系统】回溯后本章主线停驻在 ${landedIdx + 1}/${path.length}` +
        `「${landedScene.title}」——位置与进度同退，重走的路会重新计数。`
    );
  }
  return lines;
}

// 击杀冷却：击杀后至少移动这么多次（换场景）才会再掷遭遇——原地连点
// 「攻击」不再重复刷怪，刷怪必须付出移动成本。
const KILL_COOLDOWN = 2;

// 本章守关 boss 是否已被击杀（按章节 id 记档，死亡回溯不剥夺该标记——
// 玩家已经证明过自己能赢，回溯只罚进度不没收战绩）。
function bossCleared(save, chapterId) {
  const cleared = Array.isArray(save && save.boss_cleared) ? save.boss_cleared : [];
  return cleared.includes(chapterId);
}

// 主线奖励门槛：本章主线链上若带 boss 场景，守关者必须先被击杀；
// 链上无 boss 时自动满足（数据上 8 章都带，逻辑仍按通用口径写）。
function bossRequirementMet(save, chapter) {
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  if (!path.some((s) => s && s.kind === "boss")) return true;
  return bossCleared(save, chapter.id);
}

// 遭遇种子盐：存档上单调递增的 encounter_seq，每次开战 +1——同档连续两场
// 战斗的敌人与伤害 RNG 流必然不同（不再只由 存档+场景+落空计数 决定）。
function nextEncounterSeq(save) {
  return Math.max(0, Math.trunc(Number(save && save.encounter_seq) || 0)) + 1;
}

// 击杀冷却中的场景判定：cd 未归零且场景非 boss 时，随机遭遇被压制
// （boss 是剧情编排的守关战，不吃小怪冷却——走到门口就必须打；
// 但守关者已击杀的 boss 房按普通场景处理，照旧吃冷却）。
function encounterBlockedByCooldown(save, scene) {
  const cd = Math.max(0, Math.trunc(Number(save && save.encounter_cd) || 0));
  if (cd <= 0 || !scene) return false;
  if (scene.kind !== "boss") return true;
  const sceneChapter = chaptersEngine.getChapterOfScene(scene.id);
  return bossCleared(save, sceneChapter && sceneChapter.id);
}

// F088 遭遇判定：boss 场景必遇本章 boss（已击杀过的守关房按普通场景掷
// 小怪，防止原地无限刷 boss 吃经验）；否则按保底计数/章节遭遇率掷点。
// 种子 = 存档 + 场景 + 落空计数 + 开战盐 seq，确定性可复现但场场不同。
function tryEncounter(save, sceneId, opts) {
  const scene = chaptersEngine.getScene(sceneId);
  const chapter = chaptersEngine.getChapter(save.chapter);
  if (!scene || !chapter) return null;
  // 结局场景（ch8_epilogue）永不掷遭遇：落地、休息、原地叫阵三条掷点路径
  // 共用本漏斗，一处拦截全部覆盖——终章是收束时刻，不该被怪缠住；
  // 只有既存交战态（旧档）还能经「前进」撤离掷逃收尾。
  if (scene.id === endingEngine.EPILOGUE_SCENE_ID) return null;
  const sceneChapter = chaptersEngine.getChapterOfScene(scene.id);
  const effective =
    scene.kind === "boss" && sceneChapter && bossCleared(save, sceneChapter.id)
      ? { ...scene, kind: "dungeon" }
      : scene;
  // F095 逃生阀：从守关战「逃跑」成功会挂上 boss 房再入冷却——
  // encounter_clock 负值即「残骸重新凝聚中」，两步移动内再进同一
  // boss 房不再强制开战（已击杀的守关房本就不走 boss 判定，不受影响）。
  // opts.forceBoss：玩家在冷却期内原地「攻击」= 主动挑战守关者，
  // 显式叫阵压过冷却——逃生阀只保证「不被迫打」，不没收「想打」的权利。
  const rawClock = Math.trunc(Number(save.encounter_clock) || 0);
  if (effective.kind === "boss" && rawClock < 0 && !(opts && opts.forceBoss)) return null;
  const clock = Math.max(0, rawClock);
  const seq = nextEncounterSeq(save);
  const seed = `${save.id}:${scene.id}:${clock}:${seq}`;
  const enemy = encounterEngine.roll({ chapterIndex: chapter.index, scene: effective, clock, seed });
  if (enemy) enemy.seq = seq;
  return enemy;
}

// 「前进」结算 + 交战态收敛 + 遭遇判定（F074/F077/F088 交汇点）：
//   1) 交战中前进 = 撤离尝试：与「逃跑」同一判定（resolveTurn 的 flee
//      回合 + retreatOnFlee 撤退），失败白挨一回合敌人反击、原地不动；
//      成功只脱离交战（守关战撤回上一主线场景），不产生任何主线推进；
//   2) 正常推进落到新场景 → boss 场景必遇本章 boss，否则按保底/遭遇率掷点；
//      击杀冷却（encounter_cd）随每次真实移动递减，未归零不掷怪；
//   3) 落到主线链尾 → grantMain，但本章守关 boss 未击杀时只给提示不发奖；
//   4) 场景真正移动（patch.scene 与原 scene 不同）才产出 advance 事件喂
//      每日任务，原地踏步不计；跨章时遭遇保底计数随地图归零。
function advanceWithEncounter(save) {
  const cbt = store.getCombat(save.id);
  const enemyName = cbt && cbt.enemy ? cbt.enemy.name : "敌人";

  // 落到主线链尾时的奖励门槛：守关 boss 未击杀则只提示不结算；
  // 本次落点本身开战（boss/小怪）时提示被遭遇播报盖过，不重复啰嗦。
  const applyTailGate = (res, chapter, spawnedBoss) => {
    const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
    if (!chapter || !path.length || res.patch.scene !== path[path.length - 1].id) return;
    if (bossRequirementMet(save, chapter)) {
      res.grantMain = chapter.id;
    } else if (!spawnedBoss) {
      res.content += `\n【主线】本章守关者仍未倒下，主线奖励未结算。`;
    }
  };

  if (cbt) {
    // F096：交战中「前进」= 撤离掷逃，与「逃跑」按钮同一结算（combatTurn
    // 的 retreatOnFlee）：失败回合照推（吃反击、turn+1、原地不动），死亡
    // 交由 settleDeath；成功只脱离交战——守关战撤回上一主线场景并挂
    // boss 房再入冷却（F095 逃生阀），普通遭遇原地脱离，链首场景则原地
    // 脱离。绝不调用 advanceOutcome——同一次点击不得白嫖一次落点/穿章。
    const fleeRes = combatTurn(save, cbt, "flee", "前进", null, { retreatOnFlee: true });
    // F103 死亡即收束：撤离掷逃把人打倒时，回合战报已被 combatTurn 清空，
    // settleDeath 的「倒下/回溯」播报是唯一收尾——绝不能再拼「撤离失败」。
    if (fleeRes.patch && fleeRes.patch.hp <= 0) {
      return {
        patch: fleeRes.patch,
        content: fleeRes.content,
        events: fleeRes.events || [],
        combat: fleeRes.combat,
        rewards: null,
        grantMain: null,
      };
    }
    const fledOk =
      fleeRes.combat &&
      fleeRes.combat.op === "clear" &&
      fleeRes.patch &&
      fleeRes.patch.hp > 0;
    if (!fledOk) {
      return {
        patch: fleeRes.patch,
        content: `${fleeRes.content}\n【战斗】撤离失败，${enemyName}仍堵在面前——你寸步未移。`,
        events: fleeRes.events || [],
        combat: fleeRes.combat,
        rewards: null,
        grantMain: null,
      };
    }
    const retreated =
      typeof fleeRes.patch.scene === "string" && fleeRes.patch.scene !== save.scene;
    return {
      patch: fleeRes.patch,
      content:
        `${fleeRes.content}\n` +
        (retreated
          ? `【战斗】撤离成功——你退离了战场，这次撤离没有推进主线。`
          : `【战斗】撤离成功——你甩开了${enemyName}的纠缠，守在原地没有推进。`),
      events: fleeRes.events || [],
      combat: { op: "clear" },
      rewards: null,
      grantMain: null,
    };
  }

  const out = advanceOutcome(save);
  const patch = out.patch ? { ...out.patch } : null;
  const moved = Boolean(patch && typeof patch.scene === "string" && patch.scene !== save.scene);
  // F117/F124 scripted 步（自愈落点 / 章首铺陈 / 过门穿章）：有真实位移
  // 但不是一次探索推进——不产 advance 事件（每日「推进战线」不空结算），
  // 不掷遭遇（开场白同一回包内开战是旧毛病），体力已在 advanceOutcome
  // 层剥离。
  const scripted = out.scripted === true;
  const res = {
    patch,
    content: out.content,
    events: moved && !scripted ? ["advance"] : [],
    combat: null,
    rewards: null,
    grantMain: null,
    refused: out.refused === true,
  };
  // F114 无位移零消耗：结算出参没把玩家挪到新场景（patch.scene 缺省或
  // 与原地相同）时，体力扣点必须剥掉、并把「（体力消耗…）」注脚改写为
  // 「（本次没有消耗体力）」——「原地看旧文还掉血」不得在回溯态下复活。
  // （F106 负责的门禁拒绝分支走 refused 短路，不在本车道动；这里只罩
  // 「无位移⇒不扣费」这一层不变量。）
  if (patch && !moved) {
    let stripped = false;
    if (patch.hp !== undefined && patch.hp !== save.hp) {
      delete patch.hp;
      stripped = true;
    }
    if (patch.mp !== undefined && patch.mp !== save.mp) {
      delete patch.mp;
      stripped = true;
    }
    if (stripped) {
      res.content = res.content.replace(/（体力消耗 [^）]*）/g, "（本次没有消耗体力）");
    }
  }
  if (!moved) return res;

  // 跨章换地图：遭遇保底计数随地图归零；击杀冷却每次真实移动递减一格。
  if (patch.chapter && patch.chapter !== save.chapter) patch.encounter_clock = 0;
  const cdNext = Math.max(0, Math.trunc(Number(save.encounter_cd) || 0) - 1);
  patch.encounter_cd = cdNext;

  if (scripted) {
    // scripted 步不掷遭遇、不计保底——落点永远是链首/次幕，applyTailGate
    // 对链首天然空转，但守关提示等兜底仍走同一出口，保持一致。
    applyTailGate(res, chaptersEngine.getChapter(patch.chapter || save.chapter), false);
    return res;
  }

  const nextChapter = chaptersEngine.getChapter(patch.chapter || save.chapter);
  const landedScene = chaptersEngine.getScene(patch.scene);
  let enemy = null;
  if (!encounterBlockedByCooldown({ ...save, encounter_cd: cdNext }, landedScene)) {
    enemy = tryEncounter(
      { ...save, chapter: patch.chapter || save.chapter, encounter_cd: cdNext },
      patch.scene,
      // 折返落地的是本章守关房：这场再战是折返的目的——负冷却
      // （F095 逃生阀）不得把它挡掉，forceBoss 显式压过再入冷却。
      out.retreatToBoss ? { forceBoss: true } : undefined
    );
  }
  const rawClock = Math.trunc(Number(save.encounter_clock) || 0);
  if (enemy) {
    res.combat = { op: "set", enemy, turn: 1 };
    // 开战清零保底；守关者当面成形时残余再入冷却一并作废（残骸已成军），
    // 普通遭遇落地则逃跑冷却未走完继续倒数（不互相吞掉）。
    patch.encounter_clock = enemy.boss ? 0 : rawClock < 0 ? Math.min(0, rawClock + 1) : 0;
    patch.encounter_seq = enemy.seq;
    res.content += `\n【遭遇】${enemy.name} Lv.${enemy.level} 拦住了去路——它的 HP ${enemy.maxHp}/${enemy.maxHp}。`;
  } else if (!out.retreatToBoss) {
    // 折返落点是守关房、开战有兜底——上面没掷出敌人时也不得把
    // advanceOutcome 已清零的再入冷却改回倒数。
    if (rawClock < 0) {
      patch.encounter_clock = Math.min(0, rawClock + 1);
    } else if (!(patch.chapter && patch.chapter !== save.chapter)) {
      patch.encounter_clock = rawClock + 1;
    }
  }

  // F125 守关房再入：守关者未击杀、落地没有开战（再入冷却压住了强制
  // 遭遇）时，场景正文是开打时的开场战叙述、探索扣费也是错账——换成
  // 中性的「回到守关房」播报并剥掉这一步的 HP/MP 代价。房内的真仗只能
  // 由叫阵（forceBoss）或冷却走尽后的落地遭遇发起。
  const landedGuardianAlive =
    !enemy &&
    !out.retreatToBoss &&
    landedScene &&
    landedScene.kind === "boss" &&
    !bossCleared(save, (chaptersEngine.getChapterOfScene(landedScene.id) || {}).id);
  if (landedGuardianAlive) {
    delete patch.hp;
    delete patch.mp;
    const n = (proseStmts.bossReentryCount.get(save.id) || {}).n || 0;
    const line = BOSS_REENTRY_LINES[Math.abs(Math.trunc(n)) % BOSS_REENTRY_LINES.length](
      landedScene.title,
      chapterBossName(chaptersEngine.getChapterOfScene(landedScene.id))
    );
    res.content = `${line}\n（本次没有消耗体力）`;
  }

  applyTailGate(res, nextChapter, Boolean(enemy && enemy.boss));
  return res;
}

// ── F081 技能冷却：{ skill_id: 剩余回合数 } 存在存档上，只随已结算的
// 战斗回合衰减（任何真实推进的回合 -1，归零除名）；门禁拒绝不耗回合，
// 因此冷却也不会被「连点」刷掉。
function skillCdLeft(save, skillId) {
  const raw = save && save.skill_cds && typeof save.skill_cds === "object" ? save.skill_cds : {};
  const n = Math.trunc(Number(raw[skillId]) || 0);
  return n > 0 ? n : 0;
}

function decaySkillCds(save) {
  const raw = save && save.skill_cds && typeof save.skill_cds === "object" ? save.skill_cds : {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const n = Math.trunc(Number(v) || 0) - 1;
    if (n > 0) out[k] = n;
  }
  return out;
}

function engagedTarget(cbt) {
  return Boolean(cbt && cbt.enemy && Math.max(0, Number(cbt.enemy.hp) || 0) > 0);
}

// F111 预计伤害区间：由 combat.js damageRange 产出——与 resolveTurn
// 结算同一条 computeDamage（力量含装备折算、暴击上下限、rank 压制、
// 目标减伤），面板与「造成 X 点伤害」回包同一事实源，前端不再按
// 「威力」猜伤害。目标池 = 本章小怪模板 + 守关 boss + 当前交战敌人
// （如有）：区间覆盖玩家在本章真正会打到的 def/rank 谱系。
function skillDamagePreview(save, skill, cbt) {
  // 与 combatTurn 注入引擎的玩家实体同一口径（stats + 装备折算）。
  const equip = equipView(save.id);
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.strength += (equip.atk || 0) / 1.6;
  stats.vitality += (equip.def || 0) / 0.8;
  const attacker = { rank: save.rank, stats };
  const ch = Math.max(1, Math.trunc(Number(save.chapter) || 1));
  const table = encounterEngine.CHAPTER_ENEMIES[ch] || encounterEngine.CHAPTER_ENEMIES[8];
  const baseLv = encounterEngine.mobLevel(ch);
  const targets = (table.mobs || []).map((m) =>
    encounterEngine.makeEnemy({
      ...m,
      level: baseLv + Math.max(0, Math.trunc(Number(m.levelBonus) || 0)),
      hp: m.hp || 1,
      xp: m.xp || 1,
    })
  );
  if (table.boss) targets.push(encounterEngine.spawnBoss(ch));
  if (cbt && cbt.enemy && typeof cbt.enemy === "object") targets.push(cbt.enemy);
  return combatEngine.damageRange(attacker, skill, targets);
}

// 单个技能的可释放视图：unlocked/cooldown_remaining/mp_enough/engaged/
// can_cast/reason 全部服务端结算，与 skillGate 的判定顺序严格一致——
// 前端按钮 disabled + 提示文案只读这些字段，不再本地复刻规则。
function skillCastView(save, skill, engaged, cbt) {
  const unlocked = skill.learn_level <= save.level;
  const cooldown_remaining = skillCdLeft(save, skill.id);
  const mp_enough = Number(save.mp) >= skill.mp_cost;
  const reason = !unlocked
    ? "等级不足"
    : cooldown_remaining > 0
      ? "冷却中"
      : !mp_enough
        ? "MP 不足"
        : !engaged
          ? "无交锋目标"
          : null;
  return {
    ...skill,
    unlocked,
    cooldown_remaining,
    mp_enough,
    engaged,
    can_cast: reason === null,
    reason,
    damage_preview: skillDamagePreview(save, skill, cbt),
  };
}

function skillViews(save, cbt) {
  const engaged = engagedTarget(cbt);
  return SKILLS.map((s) => skillCastView(save, s, engaged, cbt));
}

// 「释放技能 X」前置校验：名字解析、已习得、冷却走完、MP 足够（按
// skills.json 的 mp_cost 口径，与技能面板按钮的 disabled 判定一致）。
// 校验不过时返回一条诚实文案——不扣 MP、不占回合、不产生 skill 结算事件。
// 判定顺序与 skillCastView 相同：未知技能 → 等级不足 → 冷却 → MP → 目标。
function skillGate(save, input, engaged) {
  const m = String(input || "").match(
    /释放技能\s*[:：]?\s*(.*)$|施放技能\s*[:：]?\s*(.*)$|使用技能\s*[:：]?\s*(.*)$|施放\s*[:：]?\s*(.*)$|释放\s*[:：]?\s*(.*)$/
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
  if (!skill) return { ok: false, content: `【系统】未知技能「${name}」。` };
  if (skill.learn_level > save.level) {
    return { ok: false, content: `【系统】等级不足——「${skill.name}」需要 Lv.${skill.learn_level}。` };
  }
  const cdLeft = skillCdLeft(save, skill.id);
  if (cdLeft > 0) {
    return { ok: false, content: `【系统】「${skill.name}」冷却中，还需 ${cdLeft} 回合。` };
  }
  if (save.mp < skill.mp_cost) {
    return { ok: false, content: `【系统】MP 不足——「${skill.name}」需要 ${skill.mp_cost} MP（当前 ${save.mp}）。` };
  }
  if (!engaged) {
    return { ok: false, content: `【系统】当前没有交锋目标——「${skill.name}」只能对交战中的敌人释放。` };
  }
  return { ok: true, skill };
}

// boss 房逃跑再入冷却步数：从守关战「逃跑」撤回上一场景后，这么多次
// 真实移动内再进同一 boss 房不会强制重遇同一守关者。
const BOSS_FLEE_COOLDOWN = 2;

// 交战中统一走 engine/combat.js resolveTurn 结算一回合。种子由存档 +
// 开战盐（enemy.seq，每场战斗唯一）+ 回合数构成，确定性可复现且场场
// 不同；事件文案全部由引擎产出，本函数只做落库参数与播报拼装
// （HP/MP 变化如实写出，不变不写）。
// opts.retreatOnFlee：逃跑判定成功时允许撤退回上一主线场景
// （守关 boss 专用逃生阀）；「逃跑」指令与交战中「前进」撤离都走此路。
function combatTurn(save, cbt, action, input, skill, opts) {
  let itemUse = null;
  if (action === "item") {
    // 道具必须真实消耗且药效对版：玩家点名（「使用道具 低级治疗药水」）
    // 优先；否则挑背包里对当前伤势/魔力真有帮助、回复量最低的一瓶先喝。
    // 选中物的真实 { name, heal, mp } 会传进回合结算——MP 药剂真回 MP、
    // 圣水真按 300 回，播报一律用物品本名。
    const usable = store
      .getInventory(save.id)
      .map((row) => ({ row, item: ITEMS.get(row.item_id) }))
      .filter((x) => x.item && x.item.category === "consumable" && x.row.qty > 0);
    if (!usable.length) {
      return { patch: null, content: "【系统】背包里已没有可用的补给。", events: [], refused: true };
    }
    const needHp = save.hp < save.max_hp;
    const needMp = save.mp < save.max_mp;
    const helps = (it) => (needHp && (it.heal || 0) > 0) || (needMp && (it.mp || 0) > 0);
    const named = String(input || "").match(/使用道具\s*[:：]?\s*(.+)$|道具\s*[:：]?\s*(.+)$/);
    const want = named ? (named.slice(1).find((g) => g) || "").trim() : "";
    let picked = want
      ? usable.find((x) => x.item.name === want || x.item.id === want)
      : null;
    if (want && !picked) {
      return { patch: null, content: `【系统】背包里没有名为「${want}」的可用补给。`, events: [], refused: true };
    }
    if (picked && !helps(picked.item)) {
      return {
        patch: null,
        content: `【系统】「${picked.item.name}」此刻派不上用场——伤势与魔力都不需要它。`,
        events: [],
        refused: true,
      };
    }
    if (!picked) {
      const helpful = usable.filter((x) => helps(x.item));
      if (!helpful.length) {
        return { patch: null, content: "【系统】背包里的补给此刻都派不上用场。", events: [], refused: true };
      }
      picked = helpful.sort(
        (a, b) => (a.item.heal || 0) + (a.item.mp || 0) - ((b.item.heal || 0) + (b.item.mp || 0))
      )[0];
    }
    if (picked.row.qty <= 1) invStmts.remove.run(save.id, picked.item.id);
    else invStmts.setQty.run(picked.row.qty - 1, save.id, picked.item.id);
    itemUse = { name: picked.item.name, heal: picked.item.heal || 0, mp: picked.item.mp || 0 };
  }

  const equip = equipView(save.id);
  // 装备加成折算进五项属性，与 stats.js 公式严格互逆：+攻按 1.6/点 折
  // 力量，+防按 0.8/点 折体力——不新造一套属性算法。
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.strength += (equip.atk || 0) / 1.6;
  stats.vitality += (equip.def || 0) / 0.8;

  // 回合种子：enemy.seq 是开战盐（每场唯一），旧战斗无 seq 时退回
  // started_at。同一存档连续两场战斗的 RNG 流必然不同。
  const seed = `combat:${save.id}:${cbt.enemy && cbt.enemy.seq !== undefined ? cbt.enemy.seq : cbt.started_at || "?"}:${cbt.turn}`;
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
    seed,
    {
      item: itemUse,
      skill:
        action === "skill" && skill
          ? { name: skill.name, mp_cost: skill.mp_cost, power: skill.power }
          : null,
    }
  );

  const p = state.player;
  const e = state.enemy;
  const patch = {
    hp: clamp(p.hp, 0, save.max_hp),
    mp: clamp(p.mp, 0, save.max_mp),
  };

  // F081 冷却记账：本回合已结算 → 全表 -1；本回合新放出的技能按
  // skills.json cooldown 重新挂表。只有 MP 真被扣掉才算放出——引擎内
  // 魔力不足的错误路径不挂冷却，与 skillGate 口径一致。
  const cdsNext = decaySkillCds(save);
  if (action === "skill" && skill && patch.mp < save.mp) {
    cdsNext[skill.id] = Math.max(1, Math.trunc(Number(skill.cooldown) || 1));
  }
  patch.skill_cds = cdsNext;

  const enemyHpBefore = Math.max(0, Math.trunc(Number(cbt.enemy.hp) || 0));
  const vitals = [];
  const enemyHpAfter = Math.max(0, Math.trunc(Number(e.hp) || 0));
  if (enemyHpAfter !== enemyHpBefore) vitals.push(`${e.name} HP ${enemyHpBefore}→${enemyHpAfter}`);
  if (patch.hp !== save.hp) vitals.push(`你 HP ${save.hp}→${patch.hp}`);
  if (patch.mp !== save.mp) vitals.push(`MP ${save.mp}→${patch.mp}`);

  let content =
    `【战斗】第${cbt.turn}回合 · ` +
    events.map((ev) => ev.text).join(" · ");
  if (vitals.length) content += `\n【战斗】${vitals.join(" · ")}`;

  const res = { patch, content, events: [], combat: null, rewards: null, grantMain: null };
  if (action === "skill" && patch.mp < save.mp) res.events.push("skill");

  const fled = events.some((ev) => ev.type === "flee" && ev.side === "player");
  if (e.hp <= 0) {
    // 击杀：kills+1、掉落（loot 引擎同种子掷点）与 XP 入账，交战态收敛。
    // 击杀后挂遭遇冷却（KILL_COOLDOWN 次真实移动内不再掷怪）——原地
    // 连点「攻击」刷不出下一只；boss 击杀记 boss_cleared，解锁本章主线
    // 奖励结算资格（走到链尾才发，见 advanceWithEncounter）。
    res.events.push("kill");
    patch.kills = (Number(save.kills) || 0) + 1;
    patch.encounter_cd = KILL_COOLDOWN;
    res.combat = { op: "clear" };
    const chapter = chaptersEngine.getChapter(save.chapter);
    if (cbt.enemy.boss && chapter && !bossCleared(save, chapter.id)) {
      patch.boss_cleared = [...(Array.isArray(save.boss_cleared) ? save.boss_cleared : []), chapter.id];
      // boss 场景恰好是主线链尾（如 ch2 毒牙蛇）：击杀这一刻即完成主线，
      // 就地发奖——否则玩家永远少一次「落点」触发。
      const path = chaptersEngine.chapterPath(chapter);
      if (path.length && save.scene === path[path.length - 1].id) {
        res.grantMain = chapter.id;
      }
    }
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
    if (cbt.enemy.boss) {
      res.content += `\n【主线】守关者已被击杀，本章主线奖励资格解锁。`;
    }
  } else if (fled || patch.hp <= 0) {
    // 逃跑成功 / 玩家倒下：交战态都必须收敛。死亡由 settleDeath 统一结算。
    res.combat = { op: "clear" };
    if (patch.hp <= 0) {
      // F103 死亡即收束：回合战报/撤离句整体让位——applyOutcome 里
      // settleDeath 的「倒下/回溯」播报是死亡回包的唯一收尾，攻击、
      // 技能、前进撤离、遭遇与守关战五类致死路径由此统一形态。
      res.content = "";
    }
    // F095 逃生阀：守关 boss 房里的显式「逃跑」成功 = 真的脱离 boss 房，
    // 撤回本章主线链上一场景（没有上一场景则原地脱离），并挂 2 步再入
    // 冷却——冷却期重进 boss 房不会立刻重遇同一守关者，玩家永远有
    // 「退出去练级再打回来」的余地，不会被锁死在守关战里。
    if (fled && patch.hp > 0 && cbt.enemy.boss && opts && opts.retreatOnFlee) {
      patch.encounter_clock = -BOSS_FLEE_COOLDOWN;
      const bossChapter =
        chaptersEngine.getChapterOfScene(save.scene) || chaptersEngine.getChapter(save.chapter);
      const idx = bossChapter ? chaptersEngine.pathIndexOf(bossChapter, save.scene) : -1;
      const prev =
        idx > 0 ? chaptersEngine.chapterPath(bossChapter)[idx - 1] : null;
      if (prev) {
        patch.scene = prev.id;
        res.content +=
          `\n【战斗】你且战且退，撤回了「${prev.title}」——` +
          `${e.name}仍守在门后没有追出来，两步之内它不会立刻再度拦路。`;
      } else {
        res.content += `\n【战斗】你摆脱了${e.name}的纠缠——它需要时间重新凝聚成形。`;
      }
    }
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
    // F089 终章守卫：已抵结局场景（endingEngine.hasCleared，与
    // save.cleared / at_epilogue 同口径）——此地无可战之敌，叫阵
    // 不开战、不占回合、不消耗任何资源。
    if (endingEngine.hasCleared(save)) {
      return {
        patch: null,
        content: "【系统】此处已无可战之敌——硝烟散尽，只余归途的安静。",
        events: [],
        refused: true,
      };
    }
    if (action === "skill") {
      // 技能必须有真实交战目标：无交战时一律诚实拒绝（含冷却/MP/等级
      // 门禁顺序），不再用技能掷遭遇——不扣 MP、不占回合、不开战。
      // F106：门禁失败挂 refused——零消耗、零日志、零事件。
      const gate = skillGate(save, input, false);
      if (!gate.ok) return { patch: null, content: gate.content, events: [], refused: true };
    }
    const scene = chaptersEngine.currentScene(save);
    // 击杀冷却未走完：原地连点「攻击」刷不出怪——落空计数不涨
    // （被冷却压制的空挥不该喂保底），只给诚实播报。
    // F106：冷却压制也是门拒绝——挂 refused 让路由短路、不入账本。
    if (encounterBlockedByCooldown(save, scene)) {
      return {
        patch: null,
        content: "【系统】刚结束的战斗把附近的魔物惊散了——这片区域暂时没有敌人敢靠近，往前走走再试。",
        events: [],
        refused: true,
      };
    }
    // boss 房逃跑冷却是负值 encounter_clock：原地出招不算「移动」，
    // 既不倒数也不清零——冷却只随真实移动推进。但冷却期的 boss 房里
    // 原地「攻击」= 主动叫阵，守关者被提前惊动成形——压过冷却直接开战。
    const rawClock = Math.trunc(Number(save.encounter_clock) || 0);
    const bossChallenge =
      scene && scene.kind === "boss" && rawClock < 0 &&
      !bossCleared(save, (chaptersEngine.getChapterOfScene(scene.id) || {}).id);
    const enemy = tryEncounter(save, scene ? scene.id : null, bossChallenge ? { forceBoss: true } : undefined);
    if (enemy) {
      return {
        patch: { encounter_clock: rawClock < 0 ? rawClock : 0, encounter_seq: enemy.seq },
        content: bossChallenge
          ? `【遭遇】你主动向仍未倒下的守关者叫阵——${enemy.name} Lv.${enemy.level} 被惊动，提前拦在出口前，它的 HP ${enemy.maxHp}/${enemy.maxHp}。`
          : `【遭遇】${enemy.name} Lv.${enemy.level} 应声现身，拦住了去路——它的 HP ${enemy.maxHp}/${enemy.maxHp}。`,
        events: [],
        combat: { op: "set", enemy, turn: 1 },
      };
    }
    return {
      patch: {
        encounter_clock: rawClock < 0 ? rawClock : rawClock + 1,
      },
      content: `【系统】${proseEngine.poolFor(save.chapter).attack}`,
      events: [],
    };
  }
  const pool = proseEngine.poolFor(save.chapter);
  const lines = {
    defend: `【系统】${pool.defend}`,
    item: `【系统】${pool.item}`,
    flee: `【系统】${pool.flee}`,
  };
  return { patch: null, content: lines[action], events: [] };
}

function combatIntent(save, input, action) {
  const cbt = store.getCombat(save.id);
  if (!cbt) return peacefulCombatIntent(save, input, action);
  let skill = null;
  if (action === "skill") {
    const gate = skillGate(save, input, engagedTarget(cbt));
    // F106：门禁失败挂 refused——不扣 MP、不占回合、不写日志。
    if (!gate.ok) return { patch: null, content: gate.content, events: [], refused: true };
    skill = gate.skill;
  }
  return combatTurn(save, cbt, action, input, skill, { retreatOnFlee: action === "flee" });
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
        "「休息」恢复体力与魔力（每章 3 次，休憩会推进时间、可能惊动敌人） · 「存档」写入当前进度\n" +
        "「影子」查看编队 · 「影子出战 <名字>」遣影入阵 · 「影子撤回 <名字>」令其归队\n" +
        "遭遇战中：「攻击」「释放技能 <名字>」「防御」「使用道具」「逃跑」或「前进」尝试撤离（不推进主线）\n" +
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
      // 「观察」是免费环顾：不写 save.scene、不扣 HP/MP。分支推进留给
      // 显式 choice_id 指令，绝不按 label 猜测。
      // F092/F101 新口径：不再整段复读场景正文——短句观察取本章 prose 池，
      // 按本档已产出的观察行数轮转，同场景连点两次必然不同文。
      const n = (proseStmts.observeCount.get(save.id) || {}).n || 0;
      const line = proseEngine.pick(proseEngine.poolFor(chapter.index).observe, n);
      return {
        patch: null,
        content: `你放慢呼吸，重新审视「${scene.title}」。${line}`,
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
      // F106：MP 不足是门拒绝——潜行需 5 MP，不足时 refused 短路
      // （零消耗、零日志），不再按残量扣费放行。
      if (save.mp < 5) {
        return {
          patch: null,
          refused: true,
          content: `【系统】MP 不足——「潜行」需要 5 MP（当前 ${save.mp}）。`,
        };
      }
      const mp = clamp(save.mp - 5, 0, save.max_mp);
      const n = (proseStmts.sneakCount.get(save.id) || {}).n || 0;
      const line = proseEngine.pick(
        proseEngine.poolFor(save.chapter).stealth,
        n
      );
      return {
        patch: { mp },
        content:
          `${line}\n` +
          (mp !== save.mp ? `（魔力消耗 MP ${save.mp}→${mp}）` : "（魔力已见底）"),
      };
    },
  },
  {
    id: "rest",
    role: "narrator",
    build: (save) => {
      const status = restStatus(save, store.getCombat(save.id));
      // 满血满蓝或配额耗尽：诚实拒绝，不产收益、不耗次数、不写虚构数值。
      // F106：门拒绝挂 refused——零消耗、零日志、零事件。
      if (!status.available) {
        return {
          patch: null,
          refused: true,
          content:
            `【系统】${status.reason}。` +
            (status.remaining > 0 ? `本章还可休息 ${status.remaining}/${REST_LIMIT} 次。` : ""),
        };
      }
      // 回复量与上限成比例：ceil(35% max HP) / ceil(40% max MP)。血池随
      // 等级放大后固定小额回复会让配额等于死路——3 次 × 35% 必把任意
      // 残血拉回 ≥80% 安全线，低章也不会一觉回满失去代价感。
      const hp = clamp(save.hp + Math.ceil(save.max_hp * 0.35), 0, save.max_hp);
      const mp = clamp(save.mp + Math.ceil(save.max_mp * 0.40), 0, save.max_mp);
      const deltas = [];
      if (hp !== save.hp) deltas.push(`HP ${save.hp}→${hp}`);
      if (mp !== save.mp) deltas.push(`MP ${save.mp}→${mp}`);
      const patch = {
        hp,
        mp,
        rest_used: Math.max(0, Math.trunc(Number(save.rest_used) || 0)) + 1,
      };
      let content =
        `${proseEngine.pick(proseEngine.poolFor(save.chapter).rest, save.rest_used)}` +
        `体力与魔力一点点回流，但休憩并非免费——时间在流逝，黑暗里有什么东西正循声靠近。\n` +
        `（恢复 ${deltas.join(" · ")} · 本章剩余休息 ${status.remaining - 1}/${REST_LIMIT} 次）`;

      // 休息推进时间：击杀冷却随之衰减一格，保底计数照常推进，并按当前
      // 场景遭遇表掷一次遇敌判定——撞上敌人则休憩被打断、直接开战。
      const cdNext = Math.max(0, Math.trunc(Number(save.encounter_cd) || 0) - 1);
      patch.encounter_cd = cdNext;
      const rawClock = Math.trunc(Number(save.encounter_clock) || 0);
      // 掷敌口径与 sceneView 同一派生（currentScene 含新档 NULL scene 的
      // 自愈落点）：save.scene 为空时旧码跳过掷点，开局休息零风险。
      const scene = chaptersEngine.currentScene(save);
      let enemy = null;
      if (
        scene &&
        !encounterBlockedByCooldown({ ...save, encounter_cd: cdNext }, scene)
      ) {
        enemy = tryEncounter({ ...save, encounter_cd: cdNext }, scene.id);
      }
      const res = { patch, content, combat: null };
      if (enemy) {
        res.combat = { op: "set", enemy, turn: 1 };
        patch.encounter_clock = rawClock < 0 ? Math.min(0, rawClock + 1) : 0;
        patch.encounter_seq = enemy.seq;
        res.content += `\n【遭遇】休憩被硬生生打断——${enemy.name} Lv.${enemy.level} 摸到了你的藏身处，它的 HP ${enemy.maxHp}/${enemy.maxHp}。`;
      } else {
        patch.encounter_clock = rawClock < 0 ? Math.min(0, rawClock + 1) : rawClock + 1;
      }
      return res;
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

// F129 面板名直开：自由输入只写面板名（可带「面板」尾缀）时按名直开
// 对应侧边面板——玩家口述「地图」与点地图按钮同义，不该落未识别兜底。
// 整句锚定、先于关键词表拦截：「属性」「状态」「影子编队」这类名字本就
// 被 status/shadow_formation 意图接住，两者同样零副作用，直开面板只是
// 省一次手点；句中再带别的词一律不拦，照走意图解析。
const PANEL_ROUTES = [
  { match: /^(?:背包|行囊|物品栏)(?:面板)?$/, panel: "inventory", label: "背包" },
  { match: /^技能(?:面板|列表)?$/, panel: "skills", label: "技能" },
  { match: /^(?:属性|状态)(?:面板)?$/, panel: "stats", label: "属性" },
  { match: /^地图(?:面板)?$/, panel: "map", label: "地图" },
  { match: /^任务(?:面板|列表|日志)?$/, panel: "quests", label: "任务" },
  { match: /^(?:影子(?:编队|面板|名单)?|编队)$/, panel: "shadows", label: "影子" },
];

// 裸面板名 → {intent:"unknown", panel} 的零副作用出参；非面板名返回 null，
// 由调用方继续走意图解析。/action 与 /ai-action 共用：后者在 AI 网关之前
// 短路，裸面板名不值得白跑一趟上行。零副作用是硬约束——patch/events 全空、
// 不占回合、不掷遭遇、不发奖励，照旧只写一条 system 日志。
function panelOutcome(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return null;
  for (const r of PANEL_ROUTES) {
    if (r.match.test(text)) {
      return {
        intent: "unknown",
        role: "system",
        panel: r.panel,
        patch: null,
        events: [],
        content: `【系统】已调出${r.label}面板。`,
      };
    }
  }
  return null;
}

// 交战中允许执行的意图：五个战斗指令 + 「前进」（撤离掷逃）。
// 其余白名单意图（休息/潜行/存档/状态/观察/影子编队……）在敌我面前一律
// 改判为一条诚实播报并挂 refused——不占回合、不产生任何 HP/MP 收益、
// 不进账本（与章节门/终章拒绝同口径），杜绝「交战中免费回血/回魔」的漏洞。
const COMBAT_INTENTS = new Set(["attack", "skill", "defend", "item", "flee", "advance"]);
const COMBAT_BLOCKED_VERB = {
  rest: "休息",
  sneak: "潜行",
  save: "存档",
  status: "检视状态",
  help: "翻查指令",
  observe: "分心观察",
  shadow_deploy: "调动影子",
  shadow_undeploy: "调动影子",
  shadow_formation: "整备编队",
};

// 引擎执行：intent id → 服务端结算出参。/action 与 /ai-action 共用，
// AI/客户端给的任何数值都不会走到这里，patch 只由白名单模板产出。
// build 出参的 events/combat/rewards/grantMain 是真实结算事件与副作用
// 描述，由 applyOutcome 统一落库（战斗态写删、奖励入账、死亡回溯、
// 每日任务推进）。
function executeIntent(save, intentId, input) {
  const intent = INTENTS.find((it) => it.id === intentId);
  if (!intent) return null;
  if (!COMBAT_INTENTS.has(intentId)) {
    const cbt = store.getCombat(save.id);
    if (cbt) {
      const verb = COMBAT_BLOCKED_VERB[intentId] || "执行该指令";
      return {
        intent: intent.id,
        role: "system",
        patch: null,
        content:
          `【战斗】${cbt.enemy.name}正堵在你面前，此刻无法${verb}——` +
          `先解决眼前的敌人，或以「逃跑」/「前进」寻隙撤离。`,
        shadows: undefined,
        events: [],
        combat: null,
        rewards: null,
        grantMain: null,
        // F094：交战拒绝与章节门/终章同挂 refused——零消耗、零日志、
        // 零事件；回包显性带 refused 标记，前端按回复播报不必等账本。
        refused: true,
      };
    }
  }
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
    refused: built.refused === true,
  };
}

// 结算副作用统一管线（/action 与 /ai-action 共用）：
//   patch → 战斗态写/删 → 死亡回溯 → 击杀/杂项奖励 → 主线奖励 → 每日任务。
// 死亡优先于发奖：HP 归零先复活再走 XP 结算，「倒下」播报不被升级覆盖。
// 整条管线包在一条 SQLite 事务里：奖励入账与主线去重标记同生共死，
// 中途抛错整体回滚，绝不出现「奖发了标记没写」的重复发奖窗口。
function applyOutcome(saveId, outcome) {
  const run = store.transaction(() => {
    // 跨章落点：本章休息配额随地图翻新归零（F086，与 encounter_clock
    // 同一时机重置）。仅当章节真的变化才重置——同值回写不清零配额。
    const before = store.getSave(saveId);
    if (
      outcome.patch &&
      outcome.patch.chapter !== undefined &&
      outcome.patch.chapter !== (before && before.chapter)
    ) {
      outcome.patch.rest_used = 0;
    }
    if (outcome.patch) {
      store.updateSave(saveId, outcome.patch);
    }
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
  });
  return run();
}

function resolveAction(save, input) {
  // 裸面板名最先走面板路由（F129）：比关键词表更靠前，因为「属性」
  // 「影子编队」本就会被 status/shadow_formation 意图接住而轮不到
  // unknown 分支——面板路由是同一意图的更好落地，不是新解析层。
  const panel = panelOutcome(input);
  if (panel) return panel;
  const intentId = intentRules.resolveIntent(input);
  if (intentId) {
    return executeIntent(save, intentId, input);
  }
  // 交战中收到无法解析的输入：给战斗指令提示而不是通用提示。
  const cbt = store.getCombat(save.id);
  return {
    intent: "unknown",
    role: "system",
    patch: null,
    events: [],
    content: cbt
      ? `【系统】你正与${cbt.enemy.name}交战——「攻击」「释放技能 X」「防御」「使用道具」「逃跑」，或「前进」强行撤离。`
      : "【系统】系统未识别该指令。可用：探索前进 / 环顾四周 / 攻击 / 休息 / 存档，输入「帮助」查看完整指令表。",
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

// F090 地图面板数据源：章节静态信息（标题/副标题/简介/解锁条件/景数）+
// 按存档推导的三态（cleared/current/locked）与本章主线进度。
// 只读：不写库、不产出日志；save_id 缺省时只回静态部分。
// 逐景全文（scenes[].text）不出接口——summary 是章节级简介，
// 景数给主线链长（main_total）与含支线总景数（scene_count）两条口径。
api.get("/chapters", (req, res) => {
  const rawId = req.query.save_id;
  const save = rawId === undefined ? null : store.getSave(Number(rawId));
  if (rawId !== undefined && !save) {
    return res.status(404).json({ error: "save not found" });
  }
  // 已通关章节数：与 endingEngine.buildStats 同一口径——抵达结局场景 = 8，
  // 否则按 save.chapter 推导（当前章不算已通关）。
  const clearedThrough = save
    ? endingEngine.hasCleared(save)
      ? chaptersEngine.CHAPTER_COUNT
      : Math.max(0, Math.trunc(Number(save.chapter) || 1) - 1)
    : 0;
  const chapters = chaptersEngine.listChapters().map((chapter) => {
    const mainTotal = chaptersEngine.chapterPath(chapter).length;
    const view = {
      id: chapter.id,
      index: chapter.index,
      title: chapter.title,
      subtitle: chapter.subtitle,
      summary: chapter.summary,
      // F116：解锁门三态（locked/soft/open）+ 未达前置 + 服务端文案由
      // chaptersEngine.unlockView 统一下发——与 saveView.chapter_unlock
      // 同一事实源，前端只渲染 hint/blocked_reasons，不再自拼「需 Lv.X」。
      // 无 save_id 时只给静态门槛，门态为空。
      unlock: save
        ? chaptersEngine.unlockView(save, chapter)
        : {
            level:
              chapter.unlock && Number.isInteger(chapter.unlock.level)
                ? chapter.unlock.level
                : null,
            chapter:
              chapter.unlock && Number.isInteger(chapter.unlock.chapter)
                ? chapter.unlock.chapter
                : null,
            state: null,
            blocked_reasons: [],
            hint: null,
          },
      scene_count: chapter.scenes.length,
      main_total: mainTotal,
    };
    if (!save) return view;
    const state =
      chapter.index <= clearedThrough
        ? "cleared"
        : chapter.index === Math.trunc(Number(save.chapter) || 1)
          ? "current"
          : "locked";
    let steps = state === "cleared" ? mainTotal : 0;
    if (state === "current") {
      const scene = chaptersEngine.currentScene(save);
      const idx = scene ? chaptersEngine.pathIndexOf(chapter, scene.id) : -1;
      // 与 saveView 同一口径：进度由当前站位推导（位置 + 1），
      // 不读高水位——地图「当前」与顶栏步数永不脱钩。
      steps = Math.min(mainTotal, Math.max(0, idx + 1));
    }
    return { ...view, state, progress: { current: steps, target: mainTotal } };
  });
  res.json({ chapters });
});

api.post("/saves", (req, res) => {
  const playerName = String((req.body && req.body.player_name) || "").trim();
  if (!playerName) {
    return res.status(400).json({ error: "player_name is required" });
  }
  const save = store.createSave(playerName);
  // F124：建档即写入第 1 章主线链首场景——「1/7」自此是真实站位而非
  // currentScene 自愈出的影子位；首幕正文随开场白一并落日志，第一次
  // 「前进」沿链推进到第二幕（章首铺陈步：零消耗、不掷遭遇、不计步）。
  const ch1 = chaptersEngine.getChapter(1);
  const entry = ch1 ? chaptersEngine.firstSceneOf(ch1) : null;
  if (entry) {
    store.updateSave(save.id, { scene: entry.id });
    store.appendLog(save.id, "narrator", entry.text);
  }
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
  // F094 交战门禁：交战中属性面板冻结——战中零回合成本加点与免费换装
  // 同是一类口子（即时攻防加成）。拒绝不扣点、不占回合，回包带 refused。
  if (store.getCombat(save.id)) {
    return res.status(400).json({
      error: "交战中无法分配属性点——先解决眼前的敌人，或脱离战斗再加点。",
      refused: true,
    });
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
      return res.status(400).json({ error: "交战中请用「使用道具」战斗指令", refused: true });
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
    // F094 交战门禁：交战中装备位冻结——免费换装是零回合成本的即时
    // 攻防加成。拒绝不动装备、不占回合，回包带 refused。
    if (store.getCombat(save.id)) {
      return res.status(400).json({
        error: "交战中无法更换装备——先解决眼前的敌人，或脱离战斗再换装。",
        refused: true,
      });
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

  // F089 终章收束：已在 ch8_epilogue（endingEngine.hasCleared，与
  // save.cleared / at_epilogue 同一判定）时「前进」整体拒绝——用户输入
  // 与播报都不进日志、不结算 HP/MP、不掷遭遇；回包只带一次性指引与同
  // 一份 save，连点多少次都是同一句话、日志零增长。
  // 例外：交战态（store.getCombat 非空）下「前进」的语义是撤离掷逃
  // （advanceWithEncounter → combatTurn flee），不走本短路——终章被怪
  // 缠住时玩家永远可以打或逃，不会被一句拒绝锁死。
  if (
    intentRules.resolveIntent(input) === "advance" &&
    endingEngine.hasCleared(save) &&
    !store.getCombat(save.id)
  ) {
    return res.json({
      reply: { id: --epilogueReplySeq, role: "system", content: EPILOGUE_REFUSAL },
      save: saveView(save),
      refused: true,
      ending_ready: true,
    });
  }

  // Server-side authority: the resolved intent's own delta is applied and the
  // result is clamped, so any numbers in the client payload are ignored.
  const outcome = resolveAction(save, input);
  // F096 章节门拒绝：没发生的事不进账本——用户输入与播报都不写日志、
  // 不产 advance 事件（与 F089 终章拒绝同口径）。refused 只压日志，
  // 结算管线照跑：patch 本应为 null，谁把它改回带消耗谁就在响应里现形。
  if (outcome.refused) {
    const extra = applyOutcome(save.id, outcome);
    return res.json({
      reply: {
        id: --epilogueReplySeq,
        role: outcome.role || "system",
        content: extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content,
      },
      save: saveView(store.getSave(save.id) || save),
      // F094：回包显性带拒绝标记——交战门禁/章节门/终章同一口径，
      // 前端与断言不必从文案反推「这次动作被拒了」。
      refused: true,
    });
  }
  store.appendLog(save.id, "user", input);
  // 真实结算事件随动作入账：战斗态/奖励/死亡回溯/每日任务都在
  // applyOutcome 里收敛，播报并进本条回复，不重开日志行。
  const extra = applyOutcome(save.id, outcome);
  const reply = store.appendLog(
    save.id,
    outcome.role,
    extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content
  );
  // F129：面板路由把目标面板 key 挂上回复——日志行只存 role/content，
  // panel 是回包附加字段不落库，前端凭它直接开对应抽屉。
  if (outcome.panel) reply.panel = outcome.panel;
  const payload = { reply, save: saveView(store.getSave(save.id)) };
  if (outcome.shadows) payload.shadows = outcome.shadows;
  if (outcome.panel) payload.panel = outcome.panel;
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

    // 与 /action 同一短路（F089）：终章态「前进」拒绝——不写日志不扣体力，
    // AI 网关也不必为一次必拒的指令白跑一趟。交战态除外：那时「前进」
    // 是撤离掷逃，必须落到正常结算管线。
    if (
      intentRules.resolveIntent(input) === "advance" &&
      endingEngine.hasCleared(save) &&
      !store.getCombat(save.id)
    ) {
      return res.json({
        reply: { id: --epilogueReplySeq, role: "system", content: EPILOGUE_REFUSAL },
        intent: "advance",
        save: saveView(save),
        refused: true,
        ending_ready: true,
      });
    }

    // F129 面板名直开：与 /action 同一面板路由——裸面板名在 AI 网关
    // 之前短路，不值得为它白跑一趟上行；零副作用，照旧只写一条
    // system 日志，回包带 panel 供前端开对应抽屉。
    const direct = panelOutcome(input);
    if (direct) {
      store.appendLog(save.id, "user", input);
      const reply = store.appendLog(save.id, direct.role, direct.content);
      reply.panel = direct.panel;
      return res.json({
        reply,
        intent: "unknown",
        panel: direct.panel,
        save: saveView(save),
      });
    }

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
    // F096 章节门拒绝：与 /action 同口径——零消耗、零日志、零事件，
    // 连用户输入都不入账（没发生的事不写）。此时才补写用户输入日志：
    // 拒绝态必须在此之前短路返回，日志表才真的零增长。
    if (outcome.refused) {
      const extra = applyOutcome(save.id, outcome);
      return res.json({
        reply: {
          id: --epilogueReplySeq,
          role: outcome.role || "system",
          content: extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content,
        },
        intent: outcome.intent,
        save: saveView(store.getSave(save.id) || fresh),
        refused: true,
        degraded,
      });
    }
    store.appendLog(save.id, "user", input);
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
