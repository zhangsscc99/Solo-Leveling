const fs = require("fs");
const path = require("path");
// F171: 仓库根 .env（gitignore）必须在任何读取 process.env 的模块
// （db.js 的 DB_PATH、ai/gateway 的 API key、PORT 等）之前加载——真实进程
// 环境里已存在的键不会被覆盖，文件缺失时静默跳过。
require("./load-env").loadEnv(path.join(__dirname, ".."));
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
const entityDetail = require("./ai/entity-detail");
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

// F133 场景叙述名：正文与场景显示名一律念 narr_name（玩家可读的称呼），
// 缺失时回退 title——title 保留内部口径（可能是「玩家」这类占位串或
// 守关者真名），绝不直接写进正文。
function sceneNarrName(scene) {
  if (!scene || typeof scene !== "object") return "";
  return isNonEmpty(scene.narr_name) ? scene.narr_name : scene.title || "";
}
function isNonEmpty(v) {
  return typeof v === "string" && v.trim().length > 0;
}

// F197 软门量化风险：与 F158 guardianWarning / F191 est_take 同一口径——
// 敌方实体由 encounterEngine.spawnBoss 按本章 expected_level + 玩家等级
// 带宽（F097 同一钳制）现算预演，不塞模板值；承伤区间走同一条
// computeDamage（不暴击下限到暴击上限，装备折算进体力减伤、rank 压制），
// 不另写估算公式。返回 null 表示拿不到敌方实体（数据缺失时文案降级，
// 不编造数字）。
function softGateRisk(save, chapter) {
  const boss = encounterEngine.spawnBoss(chapter && chapter.index, save && save.level);
  if (!boss || typeof boss !== "object") return null;
  const equip = equipView(save.id);
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.vitality += (equip.def || 0) / 0.8;
  const playerDef = statsEngine.defenseOf({ stats });
  const attacker = { rank: boss.rank, stats: boss.stats };
  const lo = combatEngine.computeDamage(attacker, playerDef, {
    mult: 1,
    crit: false,
    defenderRank: save.rank,
  });
  const hi = Math.max(
    lo,
    combatEngine.computeDamage(attacker, playerDef, {
      mult: 1,
      crit: true,
      defenderRank: save.rank,
    })
  );
  return {
    enemy_name: boss.name || "守关者",
    enemy_level: Math.max(1, Math.trunc(Number(boss.level) || 1)),
    enemy_hp: Math.max(1, Math.trunc(Number(boss.maxHp !== undefined ? boss.maxHp : boss.max_hp) || 1)),
    player_level: Math.max(1, Math.trunc(Number(save.level) || 1)),
    player_hp: Math.max(0, Math.trunc(Number(save.hp) || 0)),
    player_max_hp: Math.max(1, Math.trunc(Number(save.max_hp) || 1)),
    est_take_lo: lo,
    est_take_hi: hi,
  };
}

// 量化风险的一句话：正文（crossing）与地图 hint 共用这同一条串，
// 数字只出自 softGateRisk 的字段，两处永不脱钩。
function softGateRiskLine(risk) {
  if (!risk) return "";
  return (
    `守关者「${risk.enemy_name}」Lv.${risk.enemy_level} · HP ${risk.enemy_hp}` +
    ` vs 你 Lv.${risk.player_level} · HP ${risk.player_hp}/${risk.player_max_hp}，` +
    `单回合预计承受 ${risk.est_take_lo}–${risk.est_take_hi} 点`
  );
}

// F152 软门文案同一事实源：越过软门的播报、saveView.chapter_unlock 与
// /api/chapters 的 unlock 视图由同一个函数产出——门槛数值只读
// chapters.json 的 unlock（经 chaptersEngine.unlockView / unlockedFor）。
// 「受压制」是没有数值解释的旧措辞：软门放行 ≠ 无代价，hint 与过门播报
// 统一写「已强行进入 · 推荐 X · 本章战斗难度高于你的当前等级」。
// F197：光说「难度更高」不算告知——hint 与过门播报都带上量化风险行
// （敌方名/等级/HP vs 玩家等级/HP + 单回合预计承受区间），并把同一组
// 数字放进 risk 字段随视图下发，前端/断言可自取，不与文案脱钩。
function chapterUnlockView(save, chapter) {
  const view = chaptersEngine.unlockView(save, chapter);
  if (view.state !== "soft") return view;
  const reqs = [];
  if (view.chapter !== null && !view.chapter_ok) reqs.push(`完成第${view.chapter}章主线`);
  if (view.level !== null && !view.level_ok) reqs.push(`Lv.${view.level}`);
  const recommend = reqs.join("、");
  const risk = softGateRisk(save, chapter);
  const riskLine = softGateRiskLine(risk);
  return {
    ...view,
    hint:
      `推荐 ${recommend} · 可强行进入（本章战斗难度高于你的当前等级` +
      `${riskLine ? `：${riskLine}` : ""}）`,
    // 过门播报的同源措辞：事实（已强行进入）+ 量化风险 + 后果（承伤更高、
    // 建议先刷级），不再写「系统压制了传送门」这种与放行结果自相矛盾的说法。
    crossing:
      `已强行进入 · 推荐 ${recommend}——本章战斗难度高于你的当前等级，` +
      `${riskLine ? `${riskLine}；` : ""}受到的伤害更高，建议先刷级再来`,
    risk,
  };
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
    scene_title: sceneNarrName(scene),
    scene_index: idx,
    chapter_steps: steps,
    chapter_total: total,
    chapter_progress: `${steps}/${total}`,
    chapter_completed: total > 0 && steps >= total,
    // F116 单一事实源：软门三态（locked/soft/open）+ 未达前置 +
    // 服务端文案与 /api/chapters、过门播报同出自 chapterUnlockView（F152）。
    chapter_unlock: chapterUnlockView(save, chapter),
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
      // F196：cost 是该选项 effects 的一句代价标注（「体力 −5」），
      // 前端按字段渲染——有代价的选项在按钮上就把账摊开。
      .map((c) => ({ id: c.id, label: c.label, cost: choiceCostHint(c) })),
  };
}

// F088 交战视图：无交战返回 null；有交战暴露敌人完整面板数据
// （名/等级/HP/攻/防）与回合数，战斗面板据此挂载真实数值。
function combatView(combat, save) {
  if (!combat || !combat.enemy || typeof combat.enemy !== "object") return null;
  const e = combat.enemy;
  const view = {
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
  // F191 每回合预估：与 guardianWarning / resolveTurn 注入引擎的实体同一
  // 口径——装备加成折回五项属性，伤害走同一条 computeDamage（力量基数、
  // rank 压制、体力减伤、暴击上下限），区间 = 不暴击下限到暴击上限，未计
  // 闪避。save 缺失（非存档视图路径）时不下发，客户端整行不渲染。
  if (save && typeof save === "object") {
    const equip = equipView(save.id);
    const stats = statsEngine.sanitizeStats({ stats: save.stats });
    stats.strength += (equip.atk || 0) / 1.6;
    stats.vitality += (equip.def || 0) / 0.8;
    const playerDef = statsEngine.defenseOf({ stats });
    const enemyAttacker = { rank: e.rank, stats: e.stats };
    const takeLo = combatEngine.computeDamage(enemyAttacker, playerDef, {
      mult: 1,
      crit: false,
      defenderRank: save.rank,
    });
    const takeHi = Math.max(
      takeLo,
      combatEngine.computeDamage(enemyAttacker, playerDef, {
        mult: 1,
        crit: true,
        defenderRank: save.rank,
      })
    );
    const playerAttacker = { rank: save.rank, stats };
    const enemyDef = statsEngine.defenseFor(e);
    const dealLo = combatEngine.computeDamage(playerAttacker, enemyDef, {
      mult: 1,
      crit: false,
      defenderRank: e.rank,
    });
    const dealHi = Math.max(
      dealLo,
      combatEngine.computeDamage(playerAttacker, enemyDef, {
        mult: 1,
        crit: true,
        defenderRank: e.rank,
      })
    );
    view.est_take_lo = takeLo;
    view.est_take_hi = takeHi;
    view.est_deal_lo = dealLo;
    view.est_deal_hi = dealHi;
  }
  return view;
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

// F184/F188 潜行「未被察觉」额度上限：每次潜行攒一格，下一步真实推进
// 掷遭遇前吃掉一格换这一幕不开战；攒到上限再潜不叠加（F188 起如实
// 拒绝——额度没涨世界没变化，白扣 5 MP 是花钱买同一句话）。
const STEALTH_CAP = 2;

// F120 休息代价尾注：只讲「安歇要付出什么」，不复述池句的恢复语义。
// 按 rest_used 轮换（见 rest 意图的 build），≥3 变体。
const REST_TRAIL_LINES = [
  "可安歇从来不是白给的——时间在流逝，黑暗里有什么东西正循声靠近。",
  "歇脚也要记账——你闭眼的这一会儿，四周的寂静松动了一分。",
  "喘息刚平，阴影里便传来极轻的挪动声——这地方从不让人睡踏实。",
];

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
// F128b 「前进」有效链 + 站位映射：本章守关者已清算（击杀或摆脱）时，
// escape_locked 封门场景从推进链上摘除——惩罚环节随守关战一并结束，
// 副本出口已经打开，前路不再把人吞回封门区；未清算时链保持原样
// （封门语义照旧，数据上仅 ch2 惩罚副本两幕带此字段）。人落在被摘除
// 场景（清算后仍站在副本里的站位/旧档落点）时，视作站在链上它之前
// 的最近一幕——惩罚副本的出口即本章过门。advanceOutcome 与
// advanceMode 共用本口径：主按钮语义与实际结算不两张皮。
function advancePathFor(save, chapter) {
  const rawPath = chapter ? chaptersEngine.chapterPath(chapter) : [];
  const path =
    chapter && bossCleared(save, chapter.id)
      ? rawPath.filter((s) => s && s.escape_locked !== true)
      : rawPath;
  let idx = path.findIndex((s) => s && s.id === (save && save.scene));
  if (idx < 0) {
    const rawIdx = rawPath.findIndex((s) => s && s.id === (save && save.scene));
    for (let i = rawIdx - 1; i >= 0 && idx < 0; i--) {
      idx = path.findIndex((s) => s && s.id === rawPath[i].id);
    }
  }
  return { path, idx };
}

function advanceMode(save) {
  const chapter = chaptersEngine.getChapter(save && save.chapter);
  const { path, idx } = chapter
    ? advancePathFor(save, chapter)
    : { path: [], idx: -1 };
  const idxBoss = path.findIndex((s) => s && s.kind === "boss");
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

// F161 代价预告：「前进」按钮旁必须能预读下一幕要付什么——与
// advanceOutcome 的免费分支（链首铺陈步/自愈落点/过门 scripted/门禁
// 拒绝）同一判定顺序，数值直接引 ADVANCE_HP_COST/ADVANCE_MP_COST，
// 预告与实扣同一组常量，不另编数字。交战中「前进」是掷逃不是探索，
// 不吃这份探索费（代价在回合结算里，不在本字段口径内）。
function advanceCostView(save, combat) {
  const free = { hp: 0, mp: 0 };
  if (!save || combat || endingEngine.hasCleared(save)) return free;
  const mode = advanceMode(save);
  if (mode === "retreat_to_boss") {
    // 折返守关房是真结算步（advanceOutcome 的 retreatToBoss 带 vit 扣费）。
    return { hp: ADVANCE_HP_COST, mp: ADVANCE_MP_COST };
  }
  if (mode !== "advance") return free;
  const chapter = chaptersEngine.getChapter(save.chapter);
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  const idx = chapter ? chaptersEngine.pathIndexOf(chapter, save.scene) : -1;
  // idx<=0：链首铺陈步或自愈落点，下一幕仍免费；idx===链尾：过门 scripted
  // 或终章拒绝，均不扣费。
  if (idx <= 0 || idx >= path.length - 1) return free;
  return { hp: ADVANCE_HP_COST, mp: ADVANCE_MP_COST };
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
    combat: combatView(combat, save),
    // F081：技能可释放性由服务端随存档下发（mp_cost/冷却剩余/解锁/交战
    // 前提），前端只渲染不自行推导——按钮 disabled 与 /action 门禁同一口径。
    skills: skillViews(save, combat),
    rest: restStatus(save, combat),
    advance_mode: advanceMode(save),
    // F161：下一次「前进」的实付代价随存档下发——与 advanceCostView
    // 同一判定，前端按字段渲染预告，不猜场景。
    advance_cost: advanceCostView(save, combat),
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
// F178：观察行不再以旧模板句开头，计数口径改认正文尾注里的观察标记——
// OBSERVE_MARK 与 observe 构建器共用同一常量，日后改措辞不会再把计数清零。
const OBSERVE_MARK = "仍可说「观察」再看一处";
const OBSERVE_TAIL = `（${OBSERVE_MARK}，或说「前进」）`;
// P203 观察探索进度：同一存档内 OBSERVE_MARK 元提示只出现一次（第 1 次
// 观察），其后收束按「本场景已观察次数」轮换 ≥2 种变体并带「探索 N/N」
// 可见进度，第 OBSERVE_TOTAL 次追加一条实质线索。
const OBSERVE_TOTAL = 3;
//   计数标记：所有观察回包（实体细节/发现/已查过/词池各分支）的收束句
//   都带「探索 N/N」进度语——构建器与 observeCount/observeSceneCount 共
//   用同一常量。改措辞必须同步改这里，否则 LIKE 计不上已写出的旧行，
//   词池轮转与进度推导一起归零（F178 同款旧坑）。
const OBSERVE_COUNT_MARK = "探索";
const OBSERVE_PROGRESS_TAILS = [
  (prog) => `（${prog} · 还有没看尽的角落——动身说「前进」）`,
  (prog) => `（${prog} · 心里大致有了数，说「前进」动身）`,
  (prog) => `（${prog} · 这一带已经看熟，说「前进」去下一幕）`,
];
// F181：实体细节句的轮换按 (save_id, entity) 记——observe 构建器与
// unknownSceneLine 共用同一份计数（与 unknownAckSeq 同口径），同一存档
// 同一实体第二次观察必换文。
const observeEntitySeq = new Map();
const proseStmts = {
  observeCount: db.prepare(
    `SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'narrator' AND content LIKE '%${OBSERVE_COUNT_MARK}%'`
  ),
  // P203：本场景已观察次数——观察行以「<narr_name>」——开头且收束句带
  // OBSERVE_COUNT_MARK，instr=1 锁行首（其它正文内嵌「X」——不算）。
  observeSceneCount: db.prepare(
    `SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'narrator' AND instr(content, ?) = 1 AND content LIKE '%${OBSERVE_COUNT_MARK}%'`
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

// F193 一次性可发现物：chapters.json 场景可挂 discoveries（按 entityDetail
// 规范实体名命中）。第一眼回「发现正文 + 奖励入账」——物品走既有
// applyOutcome → grantRewards 发奖管线（不新造表、不写新字段）；幂等
// 标记是写进日志的发现尾注「【发现·名字】」（与 observeCount 同一口径
// 的 LIKE 查账）——同一实体第二眼改口「已经查过」，奖励只发一次。
const discoveryStmts = {
  seen: db.prepare(
    "SELECT COUNT(*) AS n FROM log WHERE save_id = ? AND role = 'narrator' AND content LIKE ?"
  ),
};

// 场景里挂在某个可观察实体上的一次性发现物；数据缺 name/line 一律视作
// 未配置，回落普通实体细节，不让坏数据炸掉观察。
function sceneDiscoveryOf(scene, entity) {
  const list = scene && Array.isArray(scene.discoveries) ? scene.discoveries : [];
  return (
    list.find(
      (d) =>
        d &&
        d.entity === entity &&
        typeof d.name === "string" &&
        d.name !== "" &&
        typeof d.line === "string" &&
        d.line !== ""
    ) || null
  );
}

function discoverySeen(saveId, name) {
  const row = discoveryStmts.seen.get(saveId, `%【发现·${name}】%`);
  return Boolean(row && Number(row.n) > 0);
}

// 发放只认 items.json 目录内 id——未知 id 丢弃不记假账；全无效时返回
// null，发现正文与幂等尾注照常（发现本身也是收获）。
function discoveryReward(disc) {
  const items = (disc.reward && Array.isArray(disc.reward.items) ? disc.reward.items : [])
    .map((r) => ({ id: String((r && r.id) || ""), qty: Math.trunc(Number(r && r.qty) || 0) }))
    .filter((r) => r.id && r.qty > 0 && ITEMS.has(r.id));
  return items.length ? { items } : null;
}

// P203 第 OBSERVE_TOTAL 次观察的实质线索：优先指向本场景还没被领走的
// 一次性发现物（玩家照做有真实回报，不是空话），否则就地点名实体/环境
// 给一条值得记下的细节。写进日志即可，不发物品。
function observeClue(save, scene, entity) {
  const list = scene && Array.isArray(scene.discoveries) ? scene.discoveries : [];
  const next = list.find(
    (d) => d && d.entity && typeof d.name === "string" && !discoverySeen(save.id, d.name)
  );
  if (next) {
    return `【线索】${next.entity}附近像还压着东西——凑近「观察」它看看。`;
  }
  if (entity) {
    return `【线索】${entity}的边缘有新旧两层痕迹——在你之前已经有人看过它。`;
  }
  return `【线索】这处的回声比别处空——附近多半还有没看见的东西。`;
}

// P203 观察收束句统一由这里产出：第 1 次观察给 OBSERVE_MARK 元提示
// （存档内唯一一次），其后按本场景已观察次数轮换变体并带「探索 N/N」
// 进度；第 OBSERVE_TOTAL 次追加一条实质线索。
function observeClosing(save, scene, entity) {
  const name = sceneNarrName(scene);
  const globalN = Math.trunc(Number((proseStmts.observeCount.get(save.id) || {}).n) || 0);
  const sceneN = Math.trunc(
    Number((proseStmts.observeSceneCount.get(save.id, `「${name}」——`) || {}).n) || 0
  );
  const prog = `${OBSERVE_COUNT_MARK} ${Math.min(sceneN + 1, OBSERVE_TOTAL)}/${OBSERVE_TOTAL}`;
  const tail =
    globalN === 0
      ? `（${prog} · ${OBSERVE_MARK}，或说「前进」）`
      : OBSERVE_PROGRESS_TAILS[sceneN % OBSERVE_PROGRESS_TAILS.length](prog);
  const clue = sceneN === OBSERVE_TOTAL - 1 ? `\n${observeClue(save, scene, entity)}` : "";
  return { tail, clue };
}

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

// F147 配发即穿戴：STARTER_KIT 里 category 为 weapon/armor 的配发品
// 自动装进对应槽位。幂等——slotView 非空（玩家已换上别的装备）不动，
// 物品已不在背包（被丢弃）也不凭空变回一件；装备不占背包份额。
function autoEquipStarterGear(saveId) {
  const equipped = [];
  for (const [itemId] of STARTER_KIT) {
    const item = ITEMS.get(itemId);
    const slot = item && SLOT_OF[item.category];
    if (!slot || slotView(saveId, slot)) continue;
    const owned = invStmts.get.get(saveId, itemId);
    if (!owned || Number(owned.qty) <= 0) continue;
    equipment[saveId] = equipment[saveId] || {};
    equipment[saveId][slot] = item.id;
    equipped.push(item);
  }
  if (equipped.length) persistEquip();
  return equipped;
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
  // F147：配发的基础武器/防具直接穿上——Lv.1 不再裸身出门。
  const equipped = autoEquipStarterGear(saveId);
  if (equipped.length) {
    const view = equipView(saveId);
    store.appendLog(
      saveId,
      "system",
      `【系统】已为你装备：${equipped.map((item) => item.name).join(" / ")}` +
        `（攻击 +${view.atk} · 防御 +${view.def}）。`
    );
  }
}

// 老存档第一次打开背包时补发一次；用日志里的配发记录做幂等标记，
// 所以清空背包后不会无限补发。
function ensureStarterKit(saveId) {
  // F147：功能上线前的老存档背包里已有配发品、装备槽却是空的，
  // 打开背包（本检查）时顺手补穿；只填空槽，不顶玩家换装。
  autoEquipStarterGear(saveId);
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

// F153 补给用量尾注与丢弃路径同一口径：qty 扣尽时写「这是最后一瓶，
// 已用完」（栈真的没了，与丢弃的「背包中已无此物」同向），绝不写
// 「剩余 ×0」。/saves/:id/item op=use 与「使用道具」脱战结算共用。
function supplyUseTail(item, qtyLeft) {
  const rest = qtyLeft > 0 ? `剩余 ×${qtyLeft}` : "这是最后一瓶，已用完";
  return `（${itemLine(item)}，${rest}）`;
}


// 推进体力消耗（沿用原数值）：HP-3、MP-2，下限一律 0——F077 起不再夹
// 在 1，耗尽可能触发死亡回溯。数值没动过的一律不进文案——HP 已 0 时
// 不得输出「HP 0→0」这种虚构消耗，只写「体力已见底」。
// F161：代价常量单源化——零消耗注脚的「下一幕要付什么」与 saveView 的
// advance_cost 预告都引这两个常量，实扣与预告永远同一组数字。
const ADVANCE_HP_COST = 3;
const ADVANCE_MP_COST = 2;

function vitalsCost(save) {
  const hp = clamp(save.hp - ADVANCE_HP_COST, 0, save.max_hp);
  const mp = clamp(save.mp - ADVANCE_MP_COST, 0, save.max_mp);
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

// F150 守关者威压拒绝：文案按被拒次数轮换 + 如实报数，拒绝是零日志零
// patch 的短路——计数只能放进程内存（与 equipment 边车同理）：同一存档
// 第 n 次被逼退按 n 取池内下一条并写出「第 n 次被威压逼退」，进程重启
// 后计数自然清零（只是文案细节，不伤语义）。
// 每条的硬约束：① 点名可输入的「攻击」/「叫阵」——纯键盘玩家与点按钮
// 玩家都有路，不再只让人去点按钮；② 含按钮名「叫阵守关者」——
// gate-refusal-free 断言的老契约，删了它前端主按钮失去可点出路；
// ③ 不出现「遭遇/第 N 回合/倒下了」这类客户端交战信号词。
const BOSS_GATE_LINES = [
  (bossName, n) =>
    `【主线】「${bossName}」的威压仍封着出口——你无法越过守关者，唯有击败它才能前行。` +
    `说「攻击」或「叫阵」逼它现形再战（也可点「叫阵守关者」按钮）。\n` +
    `（只是被威压逼退，未耗体力 · 第 ${n} 次——下一幕想过去，仍得先击败守关者）`,
  (bossName, n) =>
    `【主线】出口仍被「${bossName}」的威压钉死——这已经是第 ${n} 次被它逼退。` +
    `守关者还活着，此路不通：说「攻击」向它叫阵，或点「叫阵守关者」。\n` +
    `（只是被拦在门前，未耗体力——下一幕想前行，仍得先击败守关者）`,
  (bossName, n) =>
    `【主线】「${bossName}」没有让路的意思——威压第 ${n} 次将你拦在门前。` +
    `唯有击败它才能前行：输入「攻击」或「叫阵」开战（对应按钮「叫阵守关者」）。\n` +
    `（只是被推了回来，未耗体力 · 第 ${n} 次——下一幕想过去，仍得先击败守关者）`,
];
const bossGatePushes = new Map();

// F183 门前拒绝提示分级计数：同一次守关房逗留内，第 1 次被拒给完整
// guardianWarning（数字 + 三条下一步），第 2 次起只给一行行动指引——
// 玩家要的是「下一步干什么」，不是把同一张状态面板复读五遍。
// 按 (save_id, chapter_id, scene) 分桶：A 存档的连点不污染 B 存档，
// 也不污染同一存档在别章/别房的逗留。清零口径（applyOutcome 挂钩）：
//   ① 任何真实场景变更（离开房门，含撤离折返/死亡回溯/后退）；
//   ② combat op=set——真打一场（叫阵/落地遭遇/折返再战）后再回门前；
// 进程内 Map 与 bossGatePushes 同口径，重启自然清零。
const gateHintSeq = new Map();
function gateHintReset(saveId) {
  const prefix = `${saveId}|`;
  for (const k of gateHintSeq.keys()) {
    if (k.startsWith(prefix)) gateHintSeq.delete(k);
  }
}

// F158 守关者状态预警：「进入守关者房」（落地掷出守关战）与「门前被拒」
// （F150 威压拒绝）两条路径共用的系统行。硬约束：
//   ① 玩家 HP 绝对值 + 百分比（HP 39/100 · 39%）；
//   ② 守关者 HP 与估算单回合承伤——与 resolveTurn 敌方 strike 同一条
//      computeDamage（boss 力量基数、rank 压制、玩家体力减伤含装备折算、
//      暴击上下限），不允许拍脑袋写死区间；
//   ③ ≥2 条真实可达的恢复/变强路径，全部点名可输入动词：「休息」带
//      剩余次数、「使用道具」/「喝<真实补给名>」（背包没有回血补给就
//      不指这条死路）、「前进」撤离；拒绝态不写「前进折返」——拒绝它的
//      正是「前进」本身；
//   ④ HP<60% 明确建议先恢复，≥60% 只陈述风险（不出现「先恢复」「建议
//      休息」字样）；
//   ⑤ ≥2 变体按进程内计数轮换（与 BOSS_GATE_LINES 同口径），连点
//      「前进」不逐字复读；
//   ⑥ 预警行进日志——不得含客户端交战信号词（「遭遇」「第 N 回合」
//      「倒下了」……），用「每回合」而非「第 N 回合」。
const BOSS_WARN_LINES = [
  ({ hp, maxHp, pct, bossName, bossHp, dmgLo, dmgHi, low, paths }) =>
    `【系统】${low ? "状态预警" : "状态提示"}——你的 HP ${hp}/${maxHp} · ${pct}%。` +
    `「${bossName}」HP ${bossHp}，估算每回合能对你造成约 ${dmgLo}–${dmgHi} 点伤害。` +
    `${low ? "建议先恢复再战：" : ""}${paths.join("；")}。`,
  ({ hp, maxHp, pct, bossName, bossHp, dmgLo, dmgHi, low, paths }) =>
    `【系统】预警——HP ${hp}/${maxHp} · ${pct}%` +
    `${low ? " 已不足六成" : ""}，而「${bossName}」HP ${bossHp}、` +
    `每回合约能压掉你 ${dmgLo}–${dmgHi} 点。` +
    `${low ? "最好先恢复再动手：" : "下一步可以：" }${paths.join("；")}。`,
];
const bossWarnSeq = new Map();

// F195 门前被拒短指引池（F183 第 2 次起的那一行）：本分支恒为
// patch:null 零消耗短路，HP 一滴不掉——文案不许再写「耗你的血」。
// ≥3 条按本次逗留内被拒次数 hintN 轮换，除「第 N 次」计数器外正文
// 不逐字复读；每条保留可输入动词「攻击」/「叫阵」与守关者事实。
// F158 契约仍在：每次被拒的【系统】行必须点名一条真实可达的恢复
// 路径（休息|药水|补给）并带「每回合」威胁陈述——按真实状态指路：
// 还有休息次数就写「休息」与剩余数，没次数但有回血补给就写「道具」，
// 两样都没有只如实说「补给」先备，不把不存在的路说成存在。
function gateRecoveryHint(save) {
  const rest = restStatus(save, false);
  const healRow = store
    .getInventory(save.id)
    .map((row) => ({ row, item: ITEMS.get(row.item_id) }))
    .find(
      (x) =>
        x.item &&
        x.item.category === "consumable" &&
        (x.item.heal || 0) > 0 &&
        x.row.qty > 0
    );
  if (rest.remaining > 0)
    return `说「休息」回血（本章休息还剩 ${rest.remaining}/${REST_LIMIT} 次）`;
  if (healRow) return `用「道具」喝${healRow.item.name}补给`;
  return "本章已无可休息的间隙——先「补给」再叫阵";
}
const BOSS_GATE_HINTS = [
  (save, n, ctx) =>
    `【系统】第 ${n} 次被威压逼退——它只是把路封着，这一拦没动你` +
    `（HP ${save.hp}/${save.max_hp}）。真打起来守关者每回合都会还手：` +
    `${ctx}；备好了就说「攻击」或「叫阵」开战。`,
  (save, n, ctx) =>
    `【系统】第 ${n} 次被威压逼退——守关者仍立在原地没有出手，` +
    `可它每回合的拳头是真威胁（HP ${save.hp}/${save.max_hp}）：` +
    `${ctx}，再说「攻击」或「叫阵」。`,
  (save, n, ctx) =>
    `【系统】第 ${n} 次被威压逼退——你被推回门前但血一滴未少` +
    `（HP ${save.hp}/${save.max_hp}）；开战才是每回合硬碰硬，` +
    `${ctx}，然后「攻击」或「叫阵」逼守关者现形。`,
];

// F168 交战态撤离指引：开战播报必须同时点名按钮「逃跑」与口述「前进」
// 两条路径（旧口径只写「说『前进』尝试撤离」，390px 下玩家得猜「前进」
// 是打字用的），并明示撤离可能失败——flee 判定不是必中，被拦下回合照推。
// ≥2 变体按 encounter_seq 轮换：同档连开两场遭遇指引句不逐字复读。
const FLEE_GUIDE_LINES = [
  "【提示】想撤离？点「逃跑」或说「前进」都能尝试脱身——但撤离不一定成功，被拦下就得继续挨回合（撤离不推进主线）。",
  "【提示】此战可以撤离：点「逃跑」按钮或说「前进」同效，只是撤离可能失败、被敌人拦下来（不推进主线）。",
];
function fleeGuidanceLine(seq) {
  const n = Math.abs(Math.trunc(Number(seq) || 0));
  return FLEE_GUIDE_LINES[n % FLEE_GUIDE_LINES.length];
}

function guardianWarning(save, chapter, boss, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const bossTpl =
    boss && typeof boss === "object"
      ? boss
      : encounterEngine.spawnBoss(chapter ? chapter.index : save.chapter, save.level);
  const bossName =
    (bossTpl && bossTpl.name) ||
    chapterBossName(chapter || chaptersEngine.getChapter(save.chapter), save);
  const bossMaxHp = Math.max(
    1,
    Math.trunc(Number(bossTpl && (bossTpl.maxHp !== undefined ? bossTpl.maxHp : bossTpl.max_hp)) || 1)
  );
  // F182：预警报数与交战面板同一口径——守关者带档续打时写它的剩余
  // HP 而不是满血模板值；脱战预警（未开怪）查 boss_hp 残血档兜底。
  const bossChapterId =
    (chapter && chapter.id) || (chaptersEngine.getChapter(save.chapter) || {}).id;
  const liveHp = boss && typeof boss === "object" ? Math.trunc(Number(boss.hp)) : 0;
  const persistedHp = bossHpFor(save, bossChapterId);
  const bossHp =
    liveHp > 0
      ? Math.min(liveHp, bossMaxHp)
      : persistedHp > 0
        ? Math.min(persistedHp, bossMaxHp)
        : bossMaxHp;
  const hp = Math.max(
    0,
    Math.trunc(Number(o.hp !== undefined ? o.hp : save.hp) || 0)
  );
  const maxHp = Math.max(1, Math.trunc(Number(save.max_hp) || 1));
  const pct = Math.max(0, Math.min(100, Math.round((hp / maxHp) * 100)));
  // F187：落地开战路径（opts.brief）把预警压成一句——敌 HP、我 HP、
  // 下一步按什么，一屏只留三件事。玩家 HP<60% 仍走下方完整恢复指引
  // （残血进门不指「休息/补给」就是死路）；门前被拒与房内重入两条
  // inCombat:false 路径不经 brief，逐字不动。
  if (o.inCombat && o.brief === true && pct >= 60) {
    return `【系统】「${bossName}」HP ${bossHp} · 你 ${hp}/${maxHp}——说「攻击」开打，或「逃跑」撤离。`;
  }
  // 承伤估算：与 combatTurn 注入引擎的玩家实体同一口径——装备攻防折算进
  // 五项属性，敌方打击看玩家体力减伤与双方 rank 压制，区间 = 不暴击下限
  // 到暴击上限。
  const equip = equipView(save.id);
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.vitality += (equip.def || 0) / 0.8;
  const playerDef = statsEngine.defenseOf({ stats });
  const attacker = { rank: bossTpl.rank, stats: bossTpl.stats };
  const dmgLo = combatEngine.computeDamage(attacker, playerDef, {
    mult: 1,
    crit: false,
    defenderRank: save.rank,
  });
  const dmgHi = Math.max(
    dmgLo,
    combatEngine.computeDamage(attacker, playerDef, {
      mult: 1,
      crit: true,
      defenderRank: save.rank,
    })
  );
  const rest = restStatus(save, null);
  const healRow = store
    .getInventory(save.id)
    .map((row) => ({ row, item: ITEMS.get(row.item_id) }))
    .find(
      (x) =>
        x.item &&
        x.item.category === "consumable" &&
        (x.item.heal || 0) > 0 &&
        x.row.qty > 0
    );
  const paths = [];
  if (o.inCombat) {
    paths.push("说「攻击」开打或「防御」先顶住");
    paths.push(
      healRow
        ? `说「使用道具」或「喝${healRow.item.name}」当场回血`
        : "背包里已没有回血补给，只能靠回合硬撑"
    );
    paths.push(
      `点「逃跑」或说「前进」尝试撤离（撤离可能失败），脱战后再说「休息」（本章还可休息 ${rest.remaining}/${REST_LIMIT} 次）`
    );
  } else {
    paths.push(
      rest.remaining > 0
        ? `说「休息」先恢复体力（本章还可休息 ${rest.remaining}/${REST_LIMIT} 次）`
        : `本章休息已用尽（0/${REST_LIMIT} 次）——恢复只能靠补给`
    );
    if (healRow) paths.push(`说「使用道具」或「喝${healRow.item.name}」补给`);
    paths.push("说「攻击」或「叫阵」逼守关者现形再战");
  }
  const n = (bossWarnSeq.get(save.id) || 0) + 1;
  bossWarnSeq.set(save.id, n);
  // F183：opts.variant 显式钉住变体下标（门前被拒的首屏完整提示需要
  // 确定出现「估算每回合…」那条），缺省沿用进程内计数轮换。
  const warnIdx =
    Number.isInteger(o.variant)
      ? Math.abs(o.variant) % BOSS_WARN_LINES.length
      : (n - 1) % BOSS_WARN_LINES.length;
  return BOSS_WARN_LINES[warnIdx]({
    hp,
    maxHp,
    pct,
    bossName,
    bossHp,
    dmgLo,
    dmgHi,
    low: pct < 60,
    paths: paths.slice(0, 3),
  });
}

// 本章守关者真名：遭遇表 boss 模板为准（玩家实际交手的实体），兜底主线
// 链上 kind="boss" 场景的标题；都拿不到才回退到通用称谓——数据上 8 章
// 的守关者都有真名，占位串永远不写出。
function chapterBossName(chapter, save) {
  if (!chapter) return "守关者";
  const boss = encounterEngine.spawnBoss(chapter.index, save && save.level);
  if (boss && boss.name) return boss.name;
  const path = chaptersEngine.chapterPath(chapter);
  const scene = path.find((s) => s && s.kind === "boss");
  return scene && scene.title ? scene.title : "守关者";
}

// 章节门（F075）：站在本章主线链尾再前进 = 本章主线完成，结算准入。
// 准入通过 → chapter+1 并落到下一章主线链首场景，同时写入一行主线播报；
// 准入失败 → 留在当前场景，仅提示门槛。等级门当前是软门：等级不足也放行，
// 但播报必须显性写出「已强行进入 + 推荐门槛」提示，不得静默（F152 起措辞
// 与 /api/chapters 同源，见 chapters.js 的 TODO(F088)）。
// F096 守关者硬门：unlockedFor 通过之后，本章守关者还必须已被击杀
// （bossRequirementMet —— 与主线奖励同一口径：链上无 boss 场景的章
// 自动满足）。未击杀时 patch 不动 chapter/scene，正文给出可执行的
// 下一步（击败守关者，附当前进度）。
// F096 收尾补丁：两条拒绝分支一律零消耗——patch 为 null（HP/MP 原样），
// 正文显性写明零消耗及其剧情内理由（F161：只是/未耗/下一幕），并挂
// refused 标记让路由短路：
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
        `（门没有开，只是原地停驻，未耗体力——下一幕得先够到门槛）`,
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
        `必须击败「${chapterBossName(chapter, save)}」才能通过（当前进度 ${steps}/${path.length}）。\n` +
        `（只是停在守关者门前，未耗体力——下一幕要么叫阵要么另寻出路）`,
    };
  }
  const first = chaptersEngine.firstSceneOf(nextChapter);
  // F152 软门播报：与 /api/chapters 的 unlock.hint 同一事实源
  // （chapterUnlockView）——人确实已经进门，措辞写「已强行进入」并如实
  // 给出后果，不再说「系统压制了传送门」这种与放行结果矛盾的话。
  const gateView = chapterUnlockView(save, nextChapter);
  const softNote = gateView.state === "soft" ? `（${gateView.crossing}）` : "";
  // F117：过门是章节切换不是一次「前进」——零消耗（patch 不写 HP/MP）、
  // scripted 标记让 advanceWithEncounter 跳过遭遇判定与 advance 事件，
  // 落点 = 下一章主线链首（下一幕才重新开始计步与掷怪）。
  // F161：落点是链首——下一幕仍是零消耗铺陈步，再往后每幕推进才付代价；
  // 注脚按这个真实次序写，不提前宣称「下一幕就要扣」。
  return {
    patch: { scene: first.id, chapter: nextChapter.index },
    scripted: true,
    content:
      `【主线】第${nextChapter.index}章「${nextChapter.title}」开启${softNote}。\n` +
      `${first.text}\n` +
      `（只是穿门而过，未耗体力——下一幕仍是铺垫，之后的推进每幕要耗 HP ${ADVANCE_HP_COST} · MP ${ADVANCE_MP_COST}）`,
  };
}

// F173 章首铺陈步注脚池：玩家语言版本「这一步免费、再往前要付代价」。
// 不写 HP/MP 数字、不写「未耗体力」这种系统口径；代价事实用世界语言
// 保留（每条都带「代价」）。hpCost/mpCost 只作签名占位（与实扣同源，
// 由调用方传 ADVANCE_HP_COST/ADVANCE_MP_COST），不进入文案。
const CHAPTER_ENTRY_NOTES = [
  "（石门在身后合上。你只是立在原地听风，未耗一丝力气——再往前一步，代价就开始了。）",
  "（你按着墙缘缓了口气，旧伤隐隐作痛——这一步只是看清前路，往后的每一步都要付代价。）",
  "（前路的影子还在沉睡。你只是看，没有出手——真正的代价，从下一幕才开始讨要。）",
  "（风从深处吹来，吹得伤口发紧。你只是站稳了脚跟，未耗一丝力气——可再向前，代价便要亲自来收。）",
];

// 按章确定性轮换：同一章永远同一句（可复现），相邻章落到不同变体。
// chapterId 形如 "ch3"；取不到序号时退回字符码和，保证任何章 id 都稳定。
function chapterEntryNote(chapterId, hpCost, mpCost) {
  void hpCost;
  void mpCost;
  const key = String(chapterId || "");
  const m = /(\d+)/.exec(key);
  const n = m
    ? Number(m[1])
    : [...key].reduce((a, c) => a + c.charCodeAt(0), 0);
  return CHAPTER_ENTRY_NOTES[(Math.max(1, n) - 1) % CHAPTER_ENTRY_NOTES.length];
}

// ---------------------------------------------------------------------------
// F196 分支选项：显式「选择 <序|id>」/请求体 choice_id 把当前场景的
// choice 落成一次真实推进——落点仍是 choice.next（主线拓扑不变），但
// lead 首段正文与 effects 结算随选项不同，选项不再是无差别的装饰。
// ---------------------------------------------------------------------------

// 场景选项的显式匹配：序号（1 起）、id、或与 label 逐字相同——只认精确
// 命中，绝不按 label 子串猜测（F075 旧坑：label 含「观察」字样就把玩家
// 误送进支线场景）。
function matchSceneChoice(choices, sel) {
  const s = String(sel || "").trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const i = Number(s) - 1;
    return i >= 0 && i < choices.length ? choices[i] : null;
  }
  return choices.find((c) => c && c.id === s) || choices.find((c) => c && c.label === s) || null;
}

// 「选择 <选择子>」「选 <选择子>」整句锚定——叙述句（「我选了半天」）
// 与句中词（「要不要选择」）都不命中。
function choiceSelFromInput(input) {
  const m = /^(?:选择|选)\s*([^\s，。！？]{1,24})\s*$/.exec(String(input || "").trim());
  return m ? m[1] : null;
}

// 线索旗标读账与【发现·名字】同一口径：日志行里的「【线索·flag】」即
// 旗标（兼容旧版「（获得标记：flag）」写法）。写账随落地回包正文落
// 日志，不另开表、不另开字段；requires.flag 也走这本账。
function flagSeen(saveId, flag) {
  const f = String(flag || "");
  if (!f) return false;
  const cur = discoveryStmts.seen.get(saveId, `%【线索·${f}】%`);
  if (cur && Number(cur.n) > 0) return true;
  const legacy = discoveryStmts.seen.get(saveId, `%（获得标记：${f}）%`);
  return Boolean(legacy && Number(legacy.n) > 0);
}

// choice.effects → 可落增量：hp/mp 是叠加在步骤代价上的整数增量（负数
// 即额外消耗，结算处统一 clamp 到上限）；xp/gold/item 走既有
// applyOutcome → grantRewards 管线入账；flag 在回包末尾写「【线索·
// flag】」标记（log 即是 save 的线索记录）。lead 是该选项专属的首段
// 正文——先于落点场景 text 落日志，与既有叙事行同格式。
function choiceEffects(choice) {
  const fx = (choice && typeof choice.effects === "object" && choice.effects) || {};
  const out = { hp: 0, mp: 0, rewards: null, notes: "", lead: "" };
  out.hp = Math.trunc(Number(fx.hp) || 0);
  out.mp = Math.trunc(Number(fx.mp) || 0);
  const xp = Math.trunc(Number(fx.xp) || 0);
  const gold = Math.trunc(Number(fx.gold) || 0);
  const item = typeof fx.item === "string" && ITEMS.has(fx.item) ? fx.item : null;
  const flag = typeof fx.flag === "string" && fx.flag ? fx.flag : null;
  const rewards = {};
  if (xp > 0) rewards.xp = xp;
  if (gold > 0) rewards.gold = gold;
  if (item) rewards.items = [{ id: item, qty: 1 }];
  if (Object.keys(rewards).length) out.rewards = rewards;
  const notes = [];
  if (xp > 0) notes.push(`【奖励】XP +${xp}。`);
  if (gold > 0) notes.push(`【奖励】金币 +${gold}。`);
  if (item) notes.push(`【获得】「${ITEMS.get(item).name}」×1。`);
  if (flag) notes.push(`【线索·${flag}】已记下。`);
  if (notes.length) out.notes = `\n${notes.join("\n")}`;
  const lead = typeof choice.lead === "string" ? choice.lead.trim() : "";
  if (lead) out.lead = `${lead}\n`;
  return out;
}

// 按钮/回包上的代价标注：只写看得见的账（体力/魔力/经验/金币/物品），
// flag 是内部旗标不上按钮。没有可标注代价时返回 null。
function choiceCostHint(choice) {
  const fx = (choice && typeof choice.effects === "object" && choice.effects) || {};
  const parts = [];
  const hp = Math.trunc(Number(fx.hp) || 0);
  const mp = Math.trunc(Number(fx.mp) || 0);
  const xp = Math.trunc(Number(fx.xp) || 0);
  const gold = Math.trunc(Number(fx.gold) || 0);
  if (hp) parts.push(`体力 ${hp > 0 ? "+" : ""}${hp}`);
  if (mp) parts.push(`魔力 ${mp > 0 ? "+" : ""}${mp}`);
  if (xp > 0) parts.push(`经验 +${xp}`);
  if (gold > 0) parts.push(`金币 +${gold}`);
  if (typeof fx.item === "string" && ITEMS.has(fx.item)) {
    parts.push(`获得「${ITEMS.get(fx.item).name}」`);
  }
  return parts.length ? parts.join(" · ") : null;
}

// 「前进」结算：严格沿本章主线链推进 save.scene，日志正文一律用落点
// 场景的真实 text。落到链尾场景 = 本章主线完成（播报写出 N/N），站在
// 链尾再前进触发章节门；全篇终点（ch8_epilogue）只输出收束提示——
// 结局正文在抵达 epilogue 时已输出一次，之后不得重复打印。
// F196：choice 形参 = 玩家显式点名的当前场景选项——落点换用
// choice.next（数据层与 next_scene 同向），正文先落该选项的 lead，
// effects 叠加进本步 patch/rewards 统一结算。门禁顺序与「前进」同一
// 口径：守关者未死/链尾过门照常先拦，选项不是绕开硬门的旁路。
function advanceOutcome(save, choice) {
  const chapter = chaptersEngine.getChapter(save.chapter);
  // F128b 脱出粘住：有效链与站位映射统一走 advancePathFor——守关者
  // 已清算的章，escape_locked 封门场景从链上摘除（清算后站在 ch2 链
  // 上任一点，下一按「前进」的真实语义都是过门离开，不再回吞副本）。
  const { path, idx } = chapter
    ? advancePathFor(save, chapter)
    : { path: [], idx: -1 };
  if (!path.length) {
    // 断路同样是门拒绝：零消耗、零位移、零日志——与章节门/终章同口径。
    return { patch: null, refused: true, content: "【系统】前路在此断裂，暂无可以踏足之地。" };
  }
  const vit = vitalsCost(save);

  // F196 显式分支：choice 是当前场景的真实选项（choice 意图已做精确
  // 匹配），其 next 即落点。落点必须仍在章内——悬空/跨界/空 next 一律
  // 如实拒绝，不替玩家改道。支线场景不在主线链上（idx<0）时，显式
  // 选项优先于自愈落点：玩家点名了分支就不是异常站位要拉回链首。
  let choiceScene = null;
  if (choice) {
    const t = chaptersEngine.getScene(choice.next);
    choiceScene = t && chapter.scenes.some((s) => s && s.id === t.id) ? t : null;
    if (!choiceScene) {
      return {
        patch: null,
        refused: true,
        content: "【系统】这条路在眼前断了——你站了一会儿，终究没有迈出去。",
      };
    }
  }

  // 自愈落点：save.scene 为空、悬空、错章或落在主线链之外（支线场景，
  // 支线只能通过 choice 进入、不占主线步序）→ 一律落到主线链首场景。
  // F124：这是异常路径自愈，不是真实推进——scripted 零消耗、不掷遭遇、
  // 不产 advance 事件（账本不写没发生的步数；新档建档即写入链首，
  // 正常玩家不会走到这里）。
  if (idx < 0 && !choiceScene) {
    return {
      patch: { scene: path[0].id },
      scripted: true,
      content:
        `${path[0].text}\n` +
        `（只是重新落定脚步，未耗体力——下一幕仍是铺垫，之后的推进每幕要耗 HP ${ADVANCE_HP_COST} · MP ${ADVANCE_MP_COST}）`,
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
    //      战斗结算位移），不再由「前进」代劳。F150：文案轮换+计数，
    //      可输入动词与按钮名双指路——只指按钮对纯输入玩家是死路。
    const pushN = (bossGatePushes.get(save.id) || 0) + 1;
    bossGatePushes.set(save.id, pushN);
    // F183：状态提示分级——同一次逗留内第 1 次给完整 guardianWarning
    // （钉 variant 0 保证「估算每回合…」首屏必达），第 2 次起一行行动
    // 指引（仍点名可输入的「攻击」/「叫阵」、带本次逗留内的第 N 次），
    // 不再整块复读承伤估算与恢复清单。计数按 (save_id, chapter_id,
    // scene) 分桶，离房/真打一场由 applyOutcome 清零（gateHintReset）。
    const hintKey = `${save.id}|${chapter.id}|${save.scene}`;
    const hintN = (gateHintSeq.get(hintKey) || 0) + 1;
    gateHintSeq.set(hintKey, hintN);
    // F158 既有契约仍须满足：预警行带玩家 HP、点名一条恢复路径
    // （休息/药水/补给）、含「每回合」威胁陈述且相邻两次不逐字复读——
    // 短指引把承伤估算压成一句定性提醒，不再报区间数字。
    const hint =
      hintN === 1
        ? guardianWarning(save, chapter, null, { inCombat: false, variant: 0 })
        : BOSS_GATE_HINTS[(hintN - 2) % BOSS_GATE_HINTS.length](
            save,
            hintN,
            gateRecoveryHint(save)
          );
    return {
      patch: null,
      refused: true,
      // F158：门前拒绝同挂状态预警——玩家被拒在门口那一刻最需要知道
      // 自己还剩多少血、守关者大致多疼、下一步去哪恢复。
      content:
        BOSS_GATE_LINES[(pushN - 1) % BOSS_GATE_LINES.length](
          chapterBossName(chapter, save),
          pushN
        ) + `\n${hint}`,
    };
  }
  if (
    bossAlive &&
    choiceScene &&
    path.findIndex((s) => s && s.id === choiceScene.id) > idxBoss
  ) {
    // F196：支线场景的显式选项若落点越过守关者（数据上暂无此分支，
    // 但选项不是绕开硬门的旁路）——与主线站位同口径，守关者把人
    // 折返回守关房，选项的 lead/effects 不结算（这一步没走成）。
    return {
      patch: { ...vit.patch, scene: path[idxBoss].id, encounter_clock: 0 },
      retreatToBoss: true,
      content:
        `【主线】守关者还守在那扇门前——你原路折返，回到「${sceneNarrName(path[idxBoss])}」。\n` +
        `${vit.note}`,
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
        `【主线】守关者还守在那扇门前——你原路折返，回到「${sceneNarrName(path[idxBoss])}」。\n` +
        `${vit.note}`,
    };
  }

  // P204 必选门：场景标 must_choose 时，关键抉择不得被「探索前进」整屏
  // 跳过——不带显式 choice 的推进一律零消耗拒绝，正文列出真实选项名
  // （说「选择 序号」或报选项名）。与章节门/守关门同一 refused 短路：
  // patch null、零位移、零 HP/MP、零事件、不计疾行。顺序排在守关门之后
  // ——守关者未死时显式选项同样走不通（choiceScene 越过 boss 一律折返），
  // 先给守关拒绝才不会把玩家指向一条同样被拒的路。显式「选择」不受影响，
  // 照走上方 choiceScene 分支。
  if (!choice) {
    const here = chaptersEngine.getScene(save.scene);
    if (here && here.must_choose === true) {
      const opts = (Array.isArray(here.choices) ? here.choices : [])
        .map((c, i) => `${i + 1}) ${c && c.label}`)
        .join(" ");
      return {
        patch: null,
        refused: true,
        content:
          `【系统】这里必须做出选择：${opts}` +
          `（说「选择 序号」或报选项名）。`,
      };
    }
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
    const nextScene = choiceScene || path[1];
    if (choiceScene) {
      // F196 链首选项：仍是免费铺陈步（scripted——不掷遭遇、不产
      // advance 事件），但选项自己的 effects 如实结算。lead 段先落
      // 正文；代价注脚按真实结算值写——扣了血的选项不得再念
      // 「未耗体力」。
      const fx = choiceEffects(choice);
      const hp = clamp(save.hp + fx.hp, 0, save.max_hp);
      const mp = clamp(save.mp + fx.mp, 0, save.max_mp);
      const patch = { scene: nextScene.id };
      if (hp !== save.hp) patch.hp = hp;
      if (mp !== save.mp) patch.mp = mp;
      const parts = [];
      if (hp !== save.hp) parts.push(`HP ${save.hp}→${hp}`);
      if (mp !== save.mp) parts.push(`MP ${save.mp}→${mp}`);
      const note = parts.length
        ? `（这一步要付代价：${parts.join(" · ")}）`
        : chapterEntryNote(chapter.id, ADVANCE_HP_COST, ADVANCE_MP_COST);
      return {
        patch,
        scripted: true,
        rewards: fx.rewards,
        content: `${fx.lead}${nextScene.text}\n${note}${fx.notes}`,
      };
    }
    // F161：这是唯一一处「下一幕真的开始扣费」的免费步。
    // F173：注脚换成玩家语言、按章轮换（chapterEntryNote），不再把
    // 「HP 3 · MP 2」这种机制数字摊进叙述；代价事实仍如实保留
    // （下一步开始要付代价），数值取自同一组常量，结算零改动。
    // F128 衍生：铺陈步落在守关房（ch3 链第二幕即守关房）时，「影子
    // 还在沉睡」与守关者当面相矛盾——换成守关者在场的注脚，开战由
    // advanceWithEncounter 的 scripted 收口补齐。
    const entryNote =
      bossAlive && nextScene.kind === "boss"
        ? `（守关者就盘踞在前路——你踏入它的房间，它不再沉睡。）`
        : chapterEntryNote(chapter.id, ADVANCE_HP_COST, ADVANCE_MP_COST);
    return {
      patch: { scene: nextScene.id },
      scripted: true,
      content: `${nextScene.text}\n${entryNote}`,
    };
  }

  const next = choiceScene || path[idx + 1];
  // 这一步将抵达主线链尾 = 本章 N/N 集满：播报写出完成状态，
  // saveView 同步暴露 chapter_completed。判定用真实落点（选项分支
  // 落到链尾同样算集满，与主线推进同一口径）。
  const completeNote =
    next.id === path[path.length - 1].id ? `\n【主线】本章主线 ${path.length}/${path.length} 完成。` : "";
  if (choiceScene) {
    // F196 分支落地：vit 扣点与「前进」同额（同一步剧情推进），选项
    // effects 的 hp/mp 叠加进去再 clamp——代价注脚写结算后的真实
    // 前后值，不是模板常量。lead 段落为正文首段，落点场景 text 随
    // 后照旧（F074 契约一字不删）。
    const fx = choiceEffects(choice);
    const hp = clamp(vit.patch.hp + fx.hp, 0, save.max_hp);
    const mp = clamp(vit.patch.mp + fx.mp, 0, save.max_mp);
    const parts = [];
    if (hp !== save.hp) parts.push(`HP ${save.hp}→${hp}`);
    if (mp !== save.mp) parts.push(`MP ${save.mp}→${mp}`);
    const vitNote = parts.length ? `（体力消耗 ${parts.join(" · ")}）` : "（体力已见底）";
    return {
      patch: { ...vit.patch, hp, mp, scene: next.id },
      rewards: fx.rewards,
      content: `${fx.lead}${next.text}${completeNote}\n${vitNote}${fx.notes}`,
    };
  }
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
    // F194：升级播报必须如实报数——记录结算前 HP/MP，播报写真实
    // 前后值（applyXp 升级即回满，与顶栏 save.hp/save.max_hp 一致）。
    const prevHp = save.hp;
    const prevMaxHp = save.max_hp;
    const prevMp = save.mp;
    const prevMaxMp = save.max_mp;
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
          `【升级】Lv.${e.level - 1} → Lv.${e.level} · 自由属性点 +${e.freePoints} · ` +
            `HP ${prevHp}/${prevMaxHp} → ${state.hp}/${state.max_hp}（上限提升并回满） · ` +
            `MP ${prevMp}/${prevMaxMp} → ${state.mp}/${state.max_mp}（已回满）`
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

// F165 章节结算卡：本章主线真正清完（主线奖励入账）的同一回包收尾——
// 战绩账 + 本章进度 + 一条真实可达的下一步。击杀/金币只读 saves.kills/gold
// 的结算后值（存档累计口径，如实记账不编本章增量）；saves.xp 是当前等级内
// 的经验进度（升级会扣减重置，不是累计值），必须配「距下一级所需经验」分母
// 与等级一起展示——分母复用 progression.xpToNext，满级/取不到就写（满级），
// 不编分母；下一章名取 chapters 数据，取不到不编名。触发点唯一（claimMainReward
// 经 rewards 去重，同一章终生只播一次——死亡回溯重打、重启后续推都不会再刷），
// 链尾守关战章（ch2/ch7 的 boss 场景即链尾）由击杀回包的 grantMain 同
// 样汇入本出口：那时守关者才真的倒下，「前进」过门才是真出路。
function chapterClearSummary(save, chapter) {
  const path = chapter ? chaptersEngine.chapterPath(chapter) : [];
  const idx = chaptersEngine.pathIndexOf(chapter, save && save.scene);
  const steps = Math.min(path.length, Math.max(0, idx + 1));
  const kills = Math.max(0, Math.trunc(Number(save && save.kills) || 0));
  const xp = Math.max(0, Math.trunc(Number(save && save.xp) || 0));
  const level = Math.max(1, Math.trunc(Number(save && save.level) || 1));
  const gold = Math.max(0, Math.trunc(Number(save && save.gold) || 0));
  const xpNeed = Math.trunc(Number(progression.xpToNext(level)) || 0);
  const xpPart =
    xpNeed > 0 ? `经验 ${xp}/${xpNeed}（Lv.${level}）` : `经验 ${xp}（满级）`;
  const nextChapter = chaptersEngine.getChapter(chapter.index + 1);
  const nextTitle = nextChapter ? nextChapter.title || nextChapter.subtitle || "" : "";
  const nextLine = nextChapter
    ? `下一章：第 ${nextChapter.index} 章${nextTitle ? `「${nextTitle}」` : ""}——说「前进」进入。`
    : `已至全篇终章——打开「结算」面板，回看这一路的战绩。`;
  return (
    `【章节结算】第 ${chapter.index} 章 · ${chapter.title || chapter.subtitle || chapter.id}\n` +
    `击杀 ${kills} · ${xpPart} · 金币 ${gold} · 本章进度 ${steps}/${path.length}\n` +
    nextLine
  );
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
  return [
    `【主线】第${chapter.index}章主线达成，奖励入账 ${parts.join(" · ")}。`,
    ...lines,
    // F165：奖励入账后重读存档——结算卡引用的是含本次入账的账本值。
    chapterClearSummary(store.getSave(saveId) || save, chapter),
  ];
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
    // F161：回溯是重新来过——疾行计数随进度一并抹去。
    advance_streak: 0,
    // F134 回溯 = 重开本章：休息配额与跨章重置同一语义归零——
    // 死亡不返还配额会把惩罚副本压成永久死局（血回不来、怪照刷）。
    rest_used: 0,
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
      `${landedScene ? `「${sceneNarrName(landedScene)}」` : ""}，` +
      `伤势被时间抚平了一部分（HP/MP 恢复至上限的一半）。`
  );
  lines.push(
    `【系统】回溯抹去了本章积攒的疲惫——休息次数已重置（${REST_LIMIT}/${REST_LIMIT} 次可用）。`
  );
  if (chapter && path.length && landedIdx >= 0) {
    lines.push(
      `【系统】回溯后本章主线停驻在 ${landedIdx + 1}/${path.length}` +
        `「${sceneNarrName(landedScene)}」——位置与进度同退，重走的路会重新计数。`
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

// F182 守关者残血档：save.boss_hp 按章 id 记「上次撤离/倒下时未击杀的
// 守关者剩余 HP」（与 boss_cleared 同一 key 口径，跨章天然隔离）。每场
// 守关战回合结算时由 combatTurn 回写，真杀才删 key——撤离再战从这里
// 续血，不再回满。普通小怪遭遇不走此账（每次遭遇都是满血新怪）。
function bossHpFor(save, chapterId) {
  const map = save && save.boss_hp && typeof save.boss_hp === "object" ? save.boss_hp : {};
  return Math.max(0, Math.trunc(Number(map[chapterId]) || 0));
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
  const enemy = encounterEngine.roll({
    chapterIndex: chapter.index,
    scene: effective,
    clock,
    seed,
    // F161：疾行计数参与掷点——连续「前进」会线性抬高遭遇率，并在
    // streak 达阈值后把 encounters:"none" 的场景也解锁为可掷点。
    streak: save.advance_streak,
    // F097：生成等级按玩家等级带宽钳制（±2 且不超过本章期望 +1），
    // 软门放进来的低等级玩家不再对上按章节硬推的怪。
    playerLevel: save.level,
  });
  if (enemy) {
    enemy.seq = seq;
    // F182：守关者带档续打——存档里记着它上次没被打死的残血，再叫阵
    // 从残血起算而不是重新凝聚满血；无记录 = 首次交锋，满血出战。
    if (enemy.boss) {
      const residual = bossHpFor(save, chapter.id);
      if (residual > 0) enemy.hp = Math.min(residual, enemy.maxHp);
    }
  }
  return enemy;
}

// P202 遭遇战「起势衔接」：掷出敌人的那次「前进」，紧随遭遇播报的正文
// 不得以终局/濒死描写结尾——线上实测玩家在「腿骨断裂、视野边缘开始发
// 黑」的文字里被拉进同一回包的满血开战，两套说法当面打架。落地正文
// （场景原文，F074 契约一字不删）之后、遭遇播报之前，补一句战斗起势把
// 玩家从地上重新立起来；起势句只点真实敌人名——正文写守关者时敌人
// 本就是该 boss，敌人是普通小怪时收尾不再把守关者说成对手。
// 终局词表与起势池都是常量/纯函数（导出供断言逐字对照），数值零改动。
const ENCOUNTER_TERMINAL_MARKS = [
  "视野边缘开始发黑",
  "腿骨断裂",
  "血在石板缝里摊开",
  "来不及叫",
  "倒在",
  "失去意识",
];
// 小怪起势：不得含「巨像/守关者」——敌人是谁，对手就是谁。
const ENCOUNTER_RISE_MOB = [
  (name) => `眩晕还没退干净，你先一步站稳——${name}已经欺到近前，这一仗躲不开。`,
  (name) => `你把气喘匀，撑着膝盖站直——${name}挡在正中，只能打。`,
  (name) => `膝盖一沉又绷直。你站稳脚跟的时候，${name}正好横到面前。`,
];
// 守关者起势：对手是本章 boss——起身迎它的那一下，正文与战斗对象同源。
const ENCOUNTER_RISE_BOSS = [
  (name) => `你把涌上眼眶的黑一层层压回去，指甲抠进地面，把自己从地上撑了起来——${name}还在眼前，由不得你躺着。`,
  (name) => `意识归位比痛更快。你撑起半身，又撑起全身——${name}没有给你躺下的余地。`,
  (name) => `腿还在抖，但你已经站了起来——${name}堵在唯一的去路上。`,
];
// 确定性取句：按开战盐 seq 轮换（同一场战斗必得同一句），纯函数可单测。
function encounterRiseLine(enemy) {
  const pool = enemy && enemy.boss ? ENCOUNTER_RISE_BOSS : ENCOUNTER_RISE_MOB;
  const n = Math.max(0, Math.trunc(Number(enemy && enemy.seq) || 0));
  return pool[n % pool.length]((enemy && enemy.name) || "敌人");
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
// F196：choice 形参 = 显式点名的场景选项，透传给 advanceOutcome——分支
// 落地与「前进」共用整条管线（遭遇判定/守关者强开战/疾行计数/链尾门槛
// 一律同口径），选项只是换了落点文案与 effects 增量，不是第二条规则。
function advanceWithEncounter(save, choice) {
  const cbt = store.getCombat(save.id);
  const enemyName = cbt && cbt.enemy ? cbt.enemy.name : "敌人";
  // F161 连续推进计数：每一次未被拒的「前进」（含交战中的撤离掷逃）
  // 都让疾行计数 +1——计数喂 encounter.js 的 streak 加成与 none 场景
  // 解锁，任何非「前进」的已结算动作在 executeIntent 里把它归零。
  const streakNext =
    Math.max(0, Math.trunc(Number(save.advance_streak) || 0)) + 1;

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
    // F161：撤离掷逃也是一次「前进」——疾行计数照涨（被敌人拦下不算断档）。
    if (fleeRes.patch) fleeRes.patch.advance_streak = streakNext;
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
      // F128b：封门副本摆脱守关者的撤离回包可能带主线奖励入账
      // （combatTurn 的 sealedEscape 分支），经统一出口结算。
      grantMain: fleeRes.grantMain || null,
    };
  }

  const out = advanceOutcome(save, choice);
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
    // F196：分支选项的 effects 奖励随出参下发（advanceOutcome 已翻成
    // grantRewards 口径），照旧由 applyOutcome 统一入账。
    rewards: out.rewards || null,
    grantMain: null,
    refused: out.refused === true,
  };
  // F114 无位移零消耗：结算出参没把玩家挪到新场景（patch.scene 缺省或
  // 与原地相同）时，体力扣点必须剥掉、并把「（体力消耗…）」注脚改写为
  // 带剧情内理由的零消耗注脚（F161）——「原地看旧文还掉血」不得在回溯
  // 态下复活。（F106 负责的门禁拒绝分支走 refused 短路，不在本车道动；
  // 这里只罩「无位移⇒不扣费」这一层不变量。）
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
      res.content = res.content.replace(
        /（体力消耗 [^）]*）/g,
        `（只是原地停驻，未耗体力——下一幕若真推进仍要付代价：HP ${ADVANCE_HP_COST} · MP ${ADVANCE_MP_COST}）`
      );
    }
  }
  // F161：被拒的「前进」不算推进（ refused 分支 patch 恒 null，不走到
  // 这里），其余前进一律把疾行计数 +1 落库——刷新后仍在，连按才有代价。
  if (!out.refused && patch) patch.advance_streak = streakNext;
  if (!moved) return res;

  // 跨章换地图：遭遇保底计数随地图归零；击杀冷却每次真实移动递减一格。
  if (patch.chapter && patch.chapter !== save.chapter) patch.encounter_clock = 0;
  const cdNext = Math.max(0, Math.trunc(Number(save.encounter_cd) || 0) - 1);
  patch.encounter_cd = cdNext;

  if (scripted) {
    // scripted 步不掷遭遇、不计保底——落点永远是链首/次幕，applyTailGate
    // 对链首天然空转，但守关提示等兜底仍走同一出口，保持一致。
    applyTailGate(res, chaptersEngine.getChapter(patch.chapter || save.chapter), false);
    // F128 衍生：铺陈步落在守关房（ch3_retest——ch3 主线链第二幕即守关
    // 房）时守关者照常成形拦门。scripted 免的是概率掷点与体力代价，不
    // 是免硬门——玩家真实走进了它盘踞的房间，房内不开战就只剩「非交战
    // 站守关房 + 前进被门拒」的死锁（旧码靠「休息召 boss」把这个态捞
    // 回交战，F138 改走杂兵池后落地通道必须存在）。已清守关房与再入
    // 冷却（encounter_clock<0）照旧安静——tryEncounter 内部口径不变。
    const sc = chaptersEngine.getScene(patch.scene);
    const scChapter = sc ? chaptersEngine.getChapterOfScene(sc.id) : null;
    if (sc && sc.kind === "boss" && scChapter && !bossCleared(save, scChapter.id)) {
      const enemy = tryEncounter(
        { ...save, chapter: patch.chapter || save.chapter },
        patch.scene
      );
      if (enemy) {
        res.combat = { op: "set", enemy, turn: 1 };
        patch.encounter_clock = 0;
        patch.encounter_seq = enemy.seq;
        res.content +=
          `\n【遭遇】${enemy.name} Lv.${enemy.level} 拦住了去路——HP ${enemy.hp}/${enemy.maxHp}。` +
          fleeGuidanceLine(enemy.seq).replace(/^【提示】/, "") +
          `\n${guardianWarning(save, scChapter, enemy, {
            hp: patch.hp !== undefined ? patch.hp : save.hp,
            inCombat: true,
            brief: true,
          })}`;
      }
    }
    return res;
  }

  const nextChapter = chaptersEngine.getChapter(patch.chapter || save.chapter);
  const landedScene = chaptersEngine.getScene(patch.scene);
  let enemy = null;
  let rolled = false;
  // F184 潜行收益结算：潜行攒下的「未被察觉」额度在这一步吃掉一格，
  // 本幕直接不掷遭遇——不是把概率调低，是这一幕根本没有掷点（守关房
  // 落地同样掠过，由 F125 的重入播报与门拒收口径，玩家仍越不过守关
  // 者）。额度如实写回存档，播报放在 landedGuardianAlive 收口之后。
  const stealthN = Math.max(0, Math.trunc(Number(save.stealth_charges) || 0));
  if (stealthN > 0) {
    patch.stealth_charges = stealthN - 1;
  } else if (!encounterBlockedByCooldown({ ...save, encounter_cd: cdNext }, landedScene)) {
    rolled = true;
    enemy = tryEncounter(
      {
        ...save,
        chapter: patch.chapter || save.chapter,
        encounter_cd: cdNext,
        // 本步落地掷点吃的是「按完这一下之后」的疾行计数。
        advance_streak: patch.advance_streak,
      },
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
    // P202：先定遭遇再定收束——本回包要开战，落地正文末尾必须换一句
    // 战斗起势（不得停在终局/濒死句上）；无遭遇则正文照旧收束。
    res.content += `\n${encounterRiseLine(enemy)}`;
    if (enemy.boss) {
      // F187：守关战落地一屏只留三件事——敌方 HP、我方 HP、下一步按
      // 什么。要压的是系统行而不是叙事正文：落点场景 text 一字不删
      // （F074 契约——落地回包必须含场景原文），系统段落收到两段：
      // 【遭遇】敌 HP 与撤离指引同段（verbatim FLEE_GUIDE_LINES 变体
      // 去【提示】前缀并入——flee-guidance-wording 的逐字契约），
      // 【系统】预警压成一句（brief；HP<60% 时 guardianWarning 仍展
      // 开完整恢复指引）。链尾守关房（ch2/ch7 的 boss 场景即链尾）
      // 落地时「本章主线 N/N 完成」并入【遭遇】段，不另占一条系统
      // 段；任务奖励由 applyOutcome 压成末尾一句，不单开【任务】段。
      const tailDone = /\n【主线】(本章主线 \d+\/\d+ 完成。)/.exec(res.content);
      if (tailDone) res.content = res.content.replace(tailDone[0], "");
      res.content +=
        `\n【遭遇】${enemy.name} Lv.${enemy.level} 拦住了去路——HP ${enemy.hp}/${enemy.maxHp}。` +
        (tailDone ? tailDone[1] : "") +
        fleeGuidanceLine(enemy.seq).replace(/^【提示】/, "");
      res.content += `\n${guardianWarning(save, nextChapter, enemy, {
        hp: patch.hp !== undefined ? patch.hp : save.hp,
        inCombat: true,
        brief: true,
      })}`;
    } else {
      res.content += `\n【遭遇】${enemy.name} Lv.${enemy.level} 拦住了去路——它的 HP ${enemy.hp}/${enemy.maxHp}。`;
      res.content += `\n${fleeGuidanceLine(enemy.seq)}`;
    }
  } else if (!out.retreatToBoss) {
    // 折返落点是守关房、开战有兜底——上面没掷出敌人时也不得把
    // advanceOutcome 已清零的再入冷却改回倒数。
    if (rawClock < 0) {
      patch.encounter_clock = Math.min(0, rawClock + 1);
    } else if (!(patch.chapter && patch.chapter !== save.chapter)) {
      patch.encounter_clock = rawClock + 1;
    }
  }

  // F161 疾行风险提示：连续推进计数达到阈值后，遭遇率已开始线性叠加
  // （none 场景也从此刻起被解锁掷点）——风险上升必须在回包里看得见，
  // 不许静默涨价。boss 场景是必中守关战，不挂这条（它不是概率事件）。
  const streakAfter = Math.max(
    0,
    Math.trunc(Number(patch.advance_streak !== undefined ? patch.advance_streak : save.advance_streak) || 0)
  );
  if (
    rolled &&
    streakAfter >= encounterEngine.STREAK_THRESHOLD &&
    landedScene &&
    landedScene.kind !== "boss"
  ) {
    res.content +=
      `\n【警觉】你已连续疾行 ${streakAfter} 幕，四周的回声乱了——` +
      `有什么被惊动了——你的脚步越快，惊动的东西就越多。`;
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
      sceneNarrName(landedScene),
      chapterBossName(chaptersEngine.getChapterOfScene(landedScene.id), save)
    );
    // F158：重入守关房同样追加状态预警——脱战态的恢复路径（休息/补给/
    // 叫阵）与进房开战版分开给。
    res.content =
      `${line}\n（只是重返守关者门前，未耗体力——下一幕要么叫阵要么退开）\n` +
      guardianWarning(
        save,
        chaptersEngine.getChapterOfScene(landedScene.id) || nextChapter,
        null,
        { inCombat: false }
      );
  }

  // F184：潜行吃掉一格额度的如实播报——正文追加一行「没有被察觉」，
  // 剩余次数与存档 stealth_charges 同口径。
  if (stealthN > 0) {
    res.content += `\n【潜行】你压着气息掠过——这一幕没有被察觉（剩余潜行 ${stealthN - 1} 次）。`;
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

// ────────────────────────────────────────────────────────────────
// F144/F145 补给点名/选取单一事实源：交战（combatTurn）与脱战
// （peacefulItemOutcome）共用，不允许两处各写一套解析/数值口径。
//   · 点名：「使用道具 X」「道具 X」「使用/服用/喝/吃 X」「use [item|potion] X」
//     取动词后的词为物品名；先按目录名/id 精确命中，再做包含式模糊命中
//     （「治疗药水」能定位「低级治疗药水」，多命中取回复量最低的一瓶）。
//   · 裸指令（或使用/喝 + 「药/药水/道具」这类通称）：按当前最缺挑补给——
//     HP 缺口百分比 ≥ MP 缺口百分比时优先治疗类（heal>0），否则优先回蓝类
//     （mp>0）；同类里取回复量最低的一瓶（省资源口径保留）。
// supplySelection 返回 { picked:{row,item}, want } 或
// { error: "empty"|"not_found"|"useless", ... }，由调用方翻译成播报。
// ────────────────────────────────────────────────────────────────
const NAMED_ITEM_RE =
  /(?:使用道具|使用|服用|道具|喝|吃|use(?:\s+(?:item|potion))?)\s*[:：]?\s*([^\s，。！？,.!?、；;]+)/i;
const GENERIC_ITEM_WORDS = new Set([
  "药", "药水", "药剂", "药品", "道具", "补给", "补给品", "物品", "东西",
  "potion", "item", "medicine",
]);

function extractWantedItem(input) {
  const m = String(input || "").match(NAMED_ITEM_RE);
  let want = m ? m[1].trim() : "";
  want = want.replace(/^[把来点些个瓶支]+/, "").replace(/[吧呢啊了哦嘛]+$/, "").trim();
  if (!want || GENERIC_ITEM_WORDS.has(want.toLowerCase())) return "";
  return want;
}

function supplySelection(save, input) {
  const usable = store
    .getInventory(save.id)
    .map((row) => ({ row, item: ITEMS.get(row.item_id) }))
    .filter((x) => x.item && x.item.category === "consumable" && x.row.qty > 0);
  if (!usable.length) return { error: "empty" };
  const needHp = save.hp < save.max_hp;
  const needMp = save.mp < save.max_mp;
  const helps = (it) => (needHp && (it.heal || 0) > 0) || (needMp && (it.mp || 0) > 0);
  const weakest = (a, b) =>
    (a.item.heal || 0) + (a.item.mp || 0) - ((b.item.heal || 0) + (b.item.mp || 0));
  const want = extractWantedItem(input);
  if (want) {
    let picked = usable.find((x) => x.item.name === want || x.item.id === want) || null;
    if (!picked) {
      const fuzzy = usable.filter(
        (x) => x.item.name.includes(want) || want.includes(x.item.name)
      );
      if (fuzzy.length) picked = fuzzy.sort(weakest)[0];
    }
    if (!picked) return { error: "not_found", want };
    if (!helps(picked.item)) return { error: "useless", picked };
    return { picked, want };
  }
  const helpful = usable.filter((x) => helps(x.item));
  if (!helpful.length) {
    return {
      error: "useless",
      haveHeal: usable.some((x) => (x.item.heal || 0) > 0),
      haveMp: usable.some((x) => (x.item.mp || 0) > 0),
    };
  }
  const hpMissingPct = (save.max_hp - save.hp) / Math.max(1, save.max_hp);
  const mpMissingPct = (save.max_mp - save.mp) / Math.max(1, save.max_mp);
  const preferHeal = hpMissingPct >= mpMissingPct;
  const primary = helpful.filter((x) =>
    preferHeal ? (x.item.heal || 0) > 0 : (x.item.mp || 0) > 0
  );
  return { picked: (primary.length ? primary : helpful).sort(weakest)[0], want };
}

// 「useless」拒绝理由按真实状态生成，不臆断满格：无点名时看背包里还剩
// 哪类补给与当前缺口（HP 残/MP 满只剩回魔 → 「只剩回魔类，而你缺的是
// 体力」，反之类推）；点名时只说该物效应对应的那一项满了。
function uselessReason(save, sel) {
  const needHp = save.hp < save.max_hp;
  const needMp = save.mp < save.max_mp;
  if (sel.picked) {
    const it = sel.picked.item;
    const full = [];
    if ((it.heal || 0) > 0 && !needHp) full.push("伤势已满");
    if ((it.mp || 0) > 0 && !needMp) full.push("魔力已满");
    return `「${it.name}」此刻派不上用场——${full.length ? full.join("，") : "它帮不上当前的缺口"}。`;
  }
  if (!needHp && !needMp) return "体力与魔力俱已满格，补给派不上用场。";
  if (needHp && !needMp) {
    return sel.haveMp
      ? "背包里的补给此刻帮不上忙——只剩回魔类，而你缺的是体力。"
      : "背包里的补给此刻都派不上用场。";
  }
  if (needMp && !needHp) {
    return sel.haveHeal
      ? "背包里的补给此刻帮不上忙——只剩回血类，而你缺的是魔力。"
      : "背包里的补给此刻都派不上用场。";
  }
  return "背包里的补给此刻都派不上用场。";
}

// F145 恢复通道指路：补给拒绝文案的尾部固定带剩余休息次数（「休息 x/3」
// 形态）与一条真实可达的恢复方式——配额在就指「休息」，配额耗尽时如实
// 写死亡回溯兜底；不再是一句「留到战斗再用」的死话。
function supplyHint(save) {
  const st = restStatus(save, null);
  const parts = [`本章休息 ${st.remaining}/${REST_LIMIT} 次`];
  parts.push(
    st.remaining > 0
      ? "说「休息」恢复体力与魔力"
      : "若伤重倒下，会被回溯至本章入口并恢复半数状态"
  );
  return `（${parts.join("；")}）`;
}

// F154 补给点名名单：把该档背包里真实存在的可用补给名传给
// resolveIntent，接住词尾表之外的点名叫法（新补给名不带药/剂/水
// 字尾时仍能用药）。裸「喝水」不会因为背包里有「生命圣水」被误判
// ——输入没有点名它。
function bagSupplyNames(save) {
  return store
    .getInventory(save.id)
    .filter((r) => Number(r.qty) > 0)
    .map((r) => ITEMS.get(r.item_id))
    .filter((it) => it && it.category === "consumable")
    .map((it) => it.name);
}

// F145 脱战补给：与 /saves/:id/item op:"use" 同口径结算——数值 clamp 到
// 0..max、消耗 1 件、满值拒绝；点名/选取走 supplySelection（与交战态同一
// 套，不是第二份数值逻辑）。零战斗结算：不占回合、不掷遭遇、不动 scene/
// 位置——只有 hp/mp patch 与一条 system 日志。
function peacefulItemOutcome(save, input) {
  const sel = supplySelection(save, input);
  const hint = supplyHint(save);
  if (sel.error === "empty") {
    return {
      patch: null,
      events: [],
      refused: true,
      content: `【系统】背包里已没有可用的补给。${hint}`,
    };
  }
  if (sel.error === "not_found") {
    return {
      patch: null,
      events: [],
      refused: true,
      content: `【系统】背包里没有名为「${sel.want}」的可用补给。${hint}`,
    };
  }
  if (sel.error === "useless") {
    return {
      patch: null,
      events: [],
      refused: true,
      content: `【系统】${uselessReason(save, sel)}${hint}`,
    };
  }
  const picked = sel.picked;
  const item = picked.item;
  const hp = item.heal ? clamp(save.hp + item.heal, 0, save.max_hp) : save.hp;
  const mp = item.mp ? clamp(save.mp + item.mp, 0, save.max_mp) : save.mp;
  if (hp === save.hp && mp === save.mp) {
    return {
      patch: null,
      events: [],
      refused: true,
      content: `【系统】当前状态已满，「${item.name}」派不上用场。${hint}`,
    };
  }
  if (picked.row.qty <= 1) invStmts.remove.run(save.id, picked.item.id);
  else invStmts.setQty.run(picked.row.qty - 1, save.id, picked.item.id);
  const deltas = [];
  if (hp !== save.hp) deltas.push(`HP ${save.hp}→${hp}`);
  if (mp !== save.mp) deltas.push(`MP ${save.mp}→${mp}`);
  return {
    patch: { hp, mp },
    events: [],
    content:
      `【系统】已使用「${item.name}」。${deltas.join(" · ")}。` +
      supplyUseTail(item, picked.row.qty - 1),
  };
}

// 交战中统一走 engine/combat.js resolveTurn 结算一回合。种子由存档 +
// 开战盐（enemy.seq，每场战斗唯一）+ 回合数构成，确定性可复现且场场
// 不同；事件文案全部由引擎产出，本函数只做落库参数与播报拼装
// （HP/MP 变化如实写出，不变不写）。
// opts.retreatOnFlee：逃跑判定成功时允许撤退回上一主线场景
// （守关 boss 专用逃生阀）；「逃跑」指令与交战中「前进」撤离都走此路。
function combatTurn(save, cbt, action, input, skill, opts) {
  let itemUse = null;
  if (action === "item") {
    // 道具必须真实消耗且药效对版：玩家点名（「使用道具 X」「使用/喝/服用
    // 治疗药水」）优先；裸指令按当前最缺（HP/MP 缺口百分比）挑同类里回复
    // 量最低的一瓶先喝——点名/选取与脱战补给共用 supplySelection。
    // 选中物的真实 { name, heal, mp } 会传进回合结算——MP 药剂真回 MP、
    // 圣水真按 300 回，播报一律用物品本名。
    const sel = supplySelection(save, input);
    if (sel.error === "empty") {
      return { patch: null, content: "【系统】背包里已没有可用的补给。", events: [], refused: true };
    }
    if (sel.error === "not_found") {
      return {
        patch: null,
        content: `【系统】背包里没有名为「${sel.want}」的可用补给。`,
        events: [],
        refused: true,
      };
    }
    if (sel.error === "useless") {
      return {
        patch: null,
        content: `【系统】${uselessReason(save, sel)}`,
        events: [],
        refused: true,
      };
    }
    const picked = sel.picked;
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
  // F128：封门副本（escape_locked 场景）守关战撤离成功时记下被摆脱的
  // 守关者所属章 id——下方 boss_hp 落账按它跳过（守关者被「摆脱」而非
  // 打残，残血记账无意义）。
  let sealedEscapeChapter = null;

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
      // F131：撤离收尾按 boss_cleared 分支——守关者被真杀过，身后凝聚的
      // 才谈得上「残骸」；未击杀的守关者只是仍守在门后，绝不提前发丧。
      const guardianDown = bossChapter ? bossCleared(save, bossChapter.id) : false;
      // F128 封门副本逃生阀收口：escape_locked 场景（惩罚副本类）里的守关战
      // 撤离成功 = 「摆脱守关者」。这类副本的规则本来就是「存活至副本结束」
      // ——挣脱守关者即熬过惩罚：人被吐出副本、落回本章主线链首，守关标记
      // 记为已摆脱（boss_cleared——退路重开、过门与主线奖励资格一并解锁），
      // 且不挂 boss 房再入冷却（副本已放人，不存在「再入」）。普通章节的
      // 守关战维持旧口径：撤回上一景 + BOSS_FLEE_COOLDOWN 步冷却。
      const standingScene =
        chaptersEngine.getScene(save.scene) || chaptersEngine.currentScene(save);
      if (
        !guardianDown &&
        bossChapter &&
        standingScene &&
        standingScene.escape_locked === true
      ) {
        const head = chaptersEngine.firstSceneOf(bossChapter);
        patch.scene = head ? head.id : patch.scene;
        patch.encounter_clock = 0;
        sealedEscapeChapter = bossChapter.id;
        patch.boss_cleared = [
          ...(Array.isArray(save.boss_cleared) ? save.boss_cleared : []),
          bossChapter.id,
        ];
        // 「存活至副本结束」：封门章的守关房即主线链尾（ch2 毒牙蛇），摆脱
        // 守关者 = 熬过惩罚抵达副本终点——主线奖励就地入账，与链尾击杀的
        // grantMain 同口径。封门场景已自「前进」前路摘除，玩家不会再踏上
        // 链尾，不等这次发奖就永远漏发。
        const sealedPath = chaptersEngine.chapterPath(bossChapter);
        if (sealedPath.length && save.scene === sealedPath[sealedPath.length - 1].id) {
          res.grantMain = bossChapter.id;
        }
        res.content +=
          `\n【战斗】你摆脱了${e.name}的纠缠——它仍守在门后没有追出来。` +
          `\n【系统】惩罚副本的握力松开了：你活着撑到它松手的一刻，被沙地抛回` +
          `「${head ? sceneNarrName(head) : "入口"}」。守关者未倒，但你已不在它` +
          `嘴里——封门的禁令就此解除，说「前进」便可离开本章。`;
      } else if (prev) {
        patch.scene = prev.id;
        res.content +=
          `\n【战斗】你且战且退，撤回了「${sceneNarrName(prev)}」——` +
          (guardianDown
            ? `守关者的残骸在身后缓缓凝聚，两步之内它不会立刻再度拦路。`
            : `${e.name}仍守在门后没有追出来，两步之内它不会立刻再度拦路。`);
      } else {
        res.content += guardianDown
          ? `\n【战斗】你摆脱了${e.name}的纠缠——守关者的残骸需要时间重新凝聚成形。`
          : `\n【战斗】你摆脱了${e.name}的纠缠——它仍守在门后，需要时间重新凝聚成形。`;
      }
    } else if (fled && patch.hp > 0 && !cbt.enemy.boss) {
      // F131：普通怪 / 精英怪撤离收尾——既不点名「守关者」也不写「残骸」，
      // 它只是没追出来而已（守关者模板套到野怪头上是穿帮）。
      res.content += `\n【战斗】${e.name}没有追出来。`;
    }
  } else {
    res.combat = { op: "turn", enemy: e, turn: state.turn };
  }

  // F182：守关者残血随每回合结算落档——撤离/阵亡时交战行虽删，残血
  // 仍留在存档里等下次叫阵续打；只有真杀（e.hp<=0）才删 key 清零。
  // 与 boss_cleared 同章 id 口径：跨章/换场景天然隔离，不会把上一章
  // 的残留套到新守关者身上。普通小怪遭遇不记此账（每次满血）。
  const bossChapter = cbt.enemy.boss ? chaptersEngine.getChapter(save.chapter) : null;
  if (bossChapter) {
    const map = { ...(save.boss_hp && typeof save.boss_hp === "object" ? save.boss_hp : {}) };
    const remain = Math.max(0, Math.trunc(Number(e.hp) || 0));
    if (bossChapter.id === sealedEscapeChapter || remain <= 0) delete map[bossChapter.id];
    else map[bossChapter.id] = Math.min(remain, Math.max(1, Math.trunc(Number(e.maxHp) || 1)));
    patch.boss_hp = map;
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
        content:
          (bossChallenge
            ? `【遭遇】你主动向仍未倒下的守关者叫阵——${enemy.name} Lv.${enemy.level} 被惊动，提前拦在出口前，它的 HP ${enemy.hp}/${enemy.maxHp}。`
            : `【遭遇】${enemy.name} Lv.${enemy.level} 应声现身，拦住了去路——它的 HP ${enemy.hp}/${enemy.maxHp}。`) +
          `\n${fleeGuidanceLine(enemy.seq)}`,
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
  // F137 非交战「想离开」语义分两层（交战态已在 combatTurn 真结算，不经过
  // 本函数）：
  //   · escape_locked 场景（chapters.json 场景级数据字段，惩罚副本类）——
  //     出口被系统封死：挂 refused 零消耗短路（与章节门同口径），正文给
  //     真实可行的出路。既有 refused 语义本身就匹配「门拒绝」（零日志/
  //     零位移），另挂 escape_locked 独立标记让前端/断言能区分这是
  //     「副本封门」而非一般门禁拒绝。
  //   · 普通场景——「想走」不是「前进」：零消耗诚实播报并指向真实推进
  //     指令，绝不路由成 advance（F137 前「离开这里」被 advance 正则
  //     抢走，惩罚副本门口一次输入直接撞进守关房）。
  if (action === "flee") {
    const scene = chaptersEngine.currentScene(save);
    if (scene && scene.escape_locked === true) {
      // F139：escape_locked 是场景静态字段，封门是否成立要看本章守关者
      // 是否还活着（bossRequirementMet——与章节门/主线奖励同一口径）。
      // 已清 → 退路重开：诚实指路「前进」，不替玩家推进、不掷遭遇；
      // 未清 → 封门拒绝照旧，但出路只写真存在的一条（机制上没有
      // 「撑到副本终结」的计时/存活计数），并点名真实动作词。
      const chapter = chaptersEngine.getChapter(save.chapter);
      if (chapter && bossRequirementMet(save, chapter)) {
        return {
          patch: null,
          content: "【系统】守关者已经倒下，退路重新打开——按「前进」离开副本。",
          events: [],
        };
      }
      return {
        patch: null,
        content:
          "【系统】退路已被封死——你无法撤离。说「前进」挑战守关者，打倒他才能离开；说「叫阵」也行。",
        events: [],
        refused: true,
        escape_locked: true,
      };
    }
    return {
      patch: null,
      content: "【系统】此处没有交战，无需撤离；要推进剧情请说「前进」。",
      events: [],
    };
  }
  // F145：脱战补给走真实结算（peacefulItemOutcome）——真回血/回蓝、真扣
  // 库存、不动场景；拒绝路径由 supplyHint 指路恢复通道，不再是
  // 「补给留到战斗再用」的空话。
  if (action === "item") {
    return peacefulItemOutcome(save, input);
  }
  const pool = proseEngine.poolFor(save.chapter);
  const lines = {
    defend: `【系统】${pool.defend}`,
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

// F200「连击 ×3」：一次输入连打至多 3 个回合，只在玩家点击时结算
// （无后台自动战斗/定时器）。逐回合走与「攻击」完全同一条 combatTurn →
// resolveTurn 结算——回合种子（存档 + 开战盐 + 回合号）、装备折算、冷却
// 衰减全部同源；回合间 hp/mp/敌 hp/冷却在内存快照上接力（与 applyOutcome
// 的 updateSave + setCombatTurn 同口径），与连点三次「攻击」的 RNG 流
// 逐项一致。战斗提前结束（击杀/倒下/脱离）即停：只有最后一个已结算回合
// 可能带收尾副作用，仍归 applyOutcome 统一收敛。每回合战报独立成条
// （log_entries）——与连点「攻击」的日志形态一致，不揉进一条。
// P205：「连击 ×3」的真实代价——整次固定 6 MP（不是每回合）。MP 不足
// 一律门拒绝（refused 短路：零消耗、零事件；回执照常落日志），正文给
// 可行动作，绝不静默降级为单次攻击、也不零消耗放行。通过则在连打前
// 一次性扣满 6 MP：work.mp 先行落账再进回合循环——回合种子
// （存档 + 开战盐 + 回合号）不含 mp、攻击动作的 RNG 抽取序列与 mp 无关，
// 同 seed 下逐回合伤害仍与逐次「攻击」逐项一致（契约见
// combat-multi-round / combo-cost 断言）；逐回合战报的 MP 箭头行因此
// 也不多出一条（work.mp 已是扣后值，与连点「攻击」逐字同形）。
const COMBO_MP_COST = 6;

function combatComboIntent(save, input) {
  const cbt0 = store.getCombat(save.id);
  // 非交战「连击」与「攻击」同义：叫阵/遭遇掷点，不白送回合——没有三回合
  // 结算可付，6 MP 代价不适用于此路径（与「攻击」同口径零消耗）。
  if (!cbt0) return peacefulCombatIntent(save, input, "attack");
  if (save.mp < COMBO_MP_COST) {
    return {
      patch: null,
      content:
        `【系统】魔力不足：连击需要 ${COMBO_MP_COST} MP，当前 ${save.mp} MP。` +
        `改点「攻击」（零消耗），或先喝一瓶魔力药剂。`,
      events: [],
      refused: true,
    };
  }
  const work = { ...save, mp: Math.max(0, save.mp - COMBO_MP_COST) };
  let cbt = { ...cbt0, enemy: { ...(cbt0.enemy || {}) } };
  const merged = {
    patch: {},
    content: "",
    log_entries: [],
    events: [],
    combat: null,
    rewards: null,
    grantMain: null,
  };
  for (let i = 0; i < 3; i++) {
    const res = combatTurn(work, cbt, "attack", input, null, {});
    merged.log_entries.push(res.content);
    merged.patch = { ...merged.patch, ...(res.patch || {}) };
    Object.assign(work, res.patch || {});
    merged.events.push(...(res.events || []));
    if (res.rewards) merged.rewards = res.rewards;
    if (res.grantMain) merged.grantMain = res.grantMain;
    merged.combat = res.combat;
    if (!res.combat || res.combat.op !== "turn") break;
    cbt = { ...cbt, enemy: res.combat.enemy, turn: res.combat.turn };
  }
  // P205：代价入账可见。扣 MP 发生在回合循环之前，逐回合战报的 MP 箭头
  // 已按扣后口径记（与逐次「攻击」逐字同形）；代价本身单独一行挂在首条
  // 战报前——「【连击】」前缀不撞「【战斗】第N回合 / HP→」行解析口径。
  merged.log_entries[0] =
    `【连击】连击 ×3 发动 · MP ${save.mp}→${work.mp}\n` + (merged.log_entries[0] || "");
  merged.content = merged.log_entries[merged.log_entries.length - 1] || "";
  return merged;
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
    // F200「连击 ×3」：attack 意图的连击变体——词表不含「连击」（resolveIntent
    // 对它返回 null），由 resolveAction 判入本意图，按输入词分流成至多
    // 3 回合的连续结算或单击一回合；INTENTS 表不新增 id（ai/validate 的
    // 镜像白名单保持同步，AI 端也无须认识新意图）。
    build: (save, input) =>
      /连击/.test(input) ? combatComboIntent(save, input) : combatIntent(save, input, "attack"),
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
        "「前进」推进剧情（消耗少量体力） · 「选择 <序号|名称>」走场景分支\n" +
        "「潜行」压低气息（消耗 5 MP）\n" +
        "「休息」恢复体力与魔力（每章 3 次，休憩会推进时间、可能惊动敌人） · 「存档」写入当前进度\n" +
        "「影子」查看编队 · 「影子出战 <名字>」遣影入阵 · 「影子撤回 <名字>」令其归队\n" +
        "补给：「使用道具」自动选药，「使用/喝 <药名>」点名用药（交战与脱战均可）\n" +
        "遭遇战中：「攻击」「释放技能 <名字>」「防御」「使用道具」「逃跑」或「前进」尝试撤离（不推进主线）\n" +
        "其余自由输入将交由叙事层判定，未识别的动作不会改变状态。",
    }),
  },
  {
    id: "observe",
    role: "narrator",
    build: (save, input) => {
      const chapter = chaptersEngine.getChapter(save.chapter);
      const scene = chapter ? chaptersEngine.currentScene(save) : null;
      if (!scene) {
        return { patch: null, content: `你环顾四周，只有浓得化不开的黑暗。${OBSERVE_TAIL}` };
      }
      // 「观察」是免费环顾：不写 save.scene、不扣 HP/MP。分支推进留给
      // 显式 choice_id 指令，绝不按 label 猜测。
      // F092/F101 口径保留：短句观察按本档已产出的观察行数轮转，同场景
      // 连点两次必然不同文。F178/F181：正文不再套「重新审视」模板句——
      // 玩家点名的场景实体给该实体专属细节（按 save×entity 轮换），未
      // 点名时按场景真实在场的实体轮转，都没有才回落本章 prose 池；
      // P203：尾注统一走 observeClosing——OBSERVE_MARK 元提示只在第 1 次
      // 出现，其后按本场景观察次数轮换变体并带「探索 N/N」进度，第
      // OBSERVE_TOTAL 次追加一条实质线索。
      const n = (proseStmts.observeCount.get(save.id) || {}).n || 0;
      const blob = `${scene.title || ""}\n${scene.narr_name || ""}\n${scene.text || ""}`;
      let entity = entityDetail.extractEntity(input);
      if (!entity) {
        const present = entityDetail.entitiesIn(blob);
        if (present.length) entity = present[n % present.length];
      }
      const closing = observeClosing(save, scene, entity);
      // F193：命中带发现物的实体时第一眼回发现正文、奖励交 applyOutcome →
      // grantRewards 入账；日志尾注「【发现·名字】」是幂等标记，同一实体
      // 第二眼改口「已经查过」不再发奖。无发现物的实体维持 F181 轮换。
      const disc = entity ? sceneDiscoveryOf(scene, entity) : null;
      if (disc) {
        if (discoverySeen(save.id, disc.name)) {
          return {
            patch: null,
            content:
              `「${sceneNarrName(scene)}」——你凑近${entity}又看了一遍——` +
              `这里你已经查过了，「${disc.name}」不会再有第二份收获。${closing.tail}`,
          };
        }
        const rewards = discoveryReward(disc);
        const got = ((rewards && rewards.items) || [])
          .map((r) => `「${ITEMS.get(r.id).name}」×${r.qty}`)
          .join("、");
        return {
          patch: null,
          rewards,
          content:
            `「${sceneNarrName(scene)}」——${disc.line}\n` +
            `【发现·${disc.name}】${got ? `获得 ${got}。` : "已记下。"}${closing.tail}`,
        };
      }
      let line;
      if (entity) {
        const key = `${save.id}|ent|${entity}`;
        const k = observeEntitySeq.get(key) || 0;
        observeEntitySeq.set(key, k + 1);
        line = entityDetail.detail(entity, k);
      } else {
        line = proseEngine.pick(proseEngine.poolFor(chapter.index).observe, n);
      }
      return {
        patch: null,
        content: `「${sceneNarrName(scene)}」——${line}${closing.tail}${closing.clue}`,
      };
    },
  },
  {
    id: "advance",
    role: "narrator",
    build: (save) => advanceWithEncounter(save),
  },
  {
    // F196 显式分支指令：「选择 <序号|id>」或请求体 choice_id——input
    // 实参是选择子本身（resolveAction 已剥壳）。只认当前场景真实存在
    // 的选项，匹配不上/门槛未达一律 refused（零消耗、零位移）；命中
    // 后走 advanceWithEncounter 的整条落地管线，与「前进」同一口径。
    id: "choice",
    role: "narrator",
    build: (save, input) => {
      const chapter = chaptersEngine.getChapter(save.chapter);
      const scene = chapter ? chaptersEngine.currentScene(save) : null;
      const choices = scene && Array.isArray(scene.choices) ? scene.choices : [];
      if (!scene || !choices.length) {
        return {
          patch: null,
          refused: true,
          content: "【系统】这里没有分支可选——说「前进」继续剧情。",
        };
      }
      const sel = String(input || "").trim();
      const choice = matchSceneChoice(choices, sel);
      if (!choice) {
        const list = choices
          .map((c, i) => `${i + 1}. ${c.label}`)
          .join(" · ");
        return {
          patch: null,
          refused: true,
          content:
            `【系统】没有「${sel}」这条分支。眼下可选：${list} ` +
            `（说「选择 序号」点名，或直接报选项名）。`,
        };
      }
      const req =
        typeof choice.requires === "object" && choice.requires ? choice.requires : {};
      if (
        Number.isInteger(req.min_level) &&
        Math.trunc(Number(save.level) || 0) < req.min_level
      ) {
        return {
          patch: null,
          refused: true,
          content: `【系统】「${choice.label}」——实力还不够（需 Lv.${req.min_level}），这一步迈不出去。`,
        };
      }
      if (typeof req.flag === "string" && req.flag && !flagSeen(save.id, req.flag)) {
        return {
          patch: null,
          refused: true,
          content:
            `【系统】「${choice.label}」——你还没看清足够的线索，这一步迈不出去` +
            `（说「观察」再仔细看看四周）。`,
        };
      }
      return advanceWithEncounter(save, choice);
    },
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
      // F188：额度已满（2/2）再潜不叠加——如实拒绝，零消耗零事件。
      // 旧口径照扣 5 MP 额度却停在 2/2，是花钱买同一句话。
      const stealthCur = Math.max(0, Math.trunc(Number(save.stealth_charges) || 0));
      if (stealthCur >= STEALTH_CAP) {
        return {
          patch: null,
          refused: true,
          content:
            `【系统】气息已沉到极致（潜行 ${stealthCur}/${STEALTH_CAP} 已满），` +
            `再潜一次不叠加——先走一步再看。`,
        };
      }
      const mp = clamp(save.mp - 5, 0, save.max_mp);
      const n = (proseStmts.sneakCount.get(save.id) || {}).n || 0;
      const line = proseEngine.pick(
        proseEngine.poolFor(save.chapter).stealth,
        n
      );
      // F184 潜行收益：每次潜行攒一格「未被察觉」额度（上限 2），下一步
      // 真实推进掷遭遇前由 advanceWithEncounter 吃掉一格换这一幕不开战
      // ——烧 MP 必须换来可观测的世界变化，不再只是两句轮播文案。
      const stealthNext = Math.min(STEALTH_CAP, stealthCur + 1);
      return {
        patch: { mp, stealth_charges: stealthNext },
        content:
          `${line}\n` +
          (mp !== save.mp ? `（魔力消耗 MP ${save.mp}→${mp}）` : "（魔力已见底）") +
          `\n【潜行】你的气息沉入阴影——接下来更难被发现（潜行 ${stealthNext}/${STEALTH_CAP}）。`,
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
      // F120 代价提示行：旧拼句「体力与魔力一点点回流」与池句结尾
      // 「体力一点点回到四肢。」是同义复读——改成只讲代价不讲恢复，并
      // 按 rest_used 轮换 ≥3 变体。该句放在池句之前：即使某章 rest 池
      // 只有一条池句，连续两次休息的正文前 12 字也必然不同。
      const restIdx = Math.max(0, Math.trunc(Number(save.rest_used) || 0));
      let content =
        `${REST_TRAIL_LINES[restIdx % REST_TRAIL_LINES.length]}\n` +
        `${proseEngine.pick(proseEngine.poolFor(save.chapter).rest, save.rest_used)}\n` +
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
        // F138：休憩掷敌走杂兵池（encounterEngine.rollRest）——守关 Boss
        // 只被「前进」落地/房内叫阵惊动，不许被一次安歇召进藏身处；休息
        // 遭遇回包挂 encounter_source:"rest" 供前端/断言分辨来源。
        const chapter = chaptersEngine.getChapter(save.chapter);
        if (chapter) {
          const seq = nextEncounterSeq(save);
          enemy = encounterEngine.rollRest({
            chapterIndex: chapter.index,
            scene,
            clock: Math.max(0, rawClock),
            seed: `${save.id}:${scene.id}:${Math.max(0, rawClock)}:${seq}`,
            playerLevel: save.level,
          });
          if (enemy) enemy.seq = seq;
        }
      }
      const res = { patch, content, combat: null, encounter_source: null };
      if (enemy) {
        res.combat = { op: "set", enemy, turn: 1 };
        patch.encounter_clock = rawClock < 0 ? Math.min(0, rawClock + 1) : 0;
        patch.encounter_seq = enemy.seq;
        res.encounter_source = "rest";
        res.content += `\n【遭遇】休憩被硬生生打断——${enemy.name} Lv.${enemy.level} 摸到了你的藏身处，它的 HP ${enemy.hp}/${enemy.maxHp}。`;
        res.content += `\n${fleeGuidanceLine(enemy.seq)}`;
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
// F143：裸名之外允许一个可选的开面板动词前缀（+ 可选空白）——「打开背包」
// 「看看地图」「打开我的属性」与点按钮同义；整句锚定原则不变，长句叙述
// （「我打开背包发现里面空了」）首尾对不上锚点，仍落正常意图解析。
// 「打开我的/给我看」这类长前缀必须排在短词之前先试，否则「我的背包」
// 会卡住名词匹配。
const PANEL_VERB = "(?:打开我的|给我看|打开|查看|看看|瞧一瞧|看一下|调出|显示)?\\s*";
const PANEL_ROUTES = [
  { match: new RegExp(`^${PANEL_VERB}(?:背包|行囊|物品栏)(?:面板)?$`), panel: "inventory", label: "背包" },
  { match: new RegExp(`^${PANEL_VERB}技能(?:面板|列表)?$`), panel: "skills", label: "技能" },
  { match: new RegExp(`^${PANEL_VERB}(?:属性|状态)(?:面板)?$`), panel: "stats", label: "属性" },
  { match: new RegExp(`^${PANEL_VERB}地图(?:面板)?$`), panel: "map", label: "地图" },
  { match: new RegExp(`^${PANEL_VERB}任务(?:面板|列表|日志)?$`), panel: "quests", label: "任务" },
  { match: new RegExp(`^${PANEL_VERB}(?:影子(?:编队|面板|名单)?|编队)$`), panel: "shadows", label: "影子" },
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

// 交战中允许执行的意图：战斗指令 + 「前进」（撤离掷逃）。
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
  // F161 疾行计数只记「连续前进」：任何未被拒绝的非前进动作（观察/休息/
  // 战斗/道具……）都把它归零——streak 是「连着按前进」的账，断档即清。
  // advance/choice 自己经 advanceWithEncounter 落新值（F196：分支落地
  // 也是一次前进）；refused 不写档不动计数。
  const patch =
    intentId === "advance" || intentId === "choice" || built.refused
      ? built.patch
      : { ...(built.patch || {}), advance_streak: 0 };
  return {
    intent: intent.id,
    role: intent.role,
    patch,
    content: built.content,
    // F200：连击逐回合战报——存在时 /action 按序各写一条日志（缺省走
    // 单条 content，旧行为不变）。
    log_entries: Array.isArray(built.log_entries) ? built.log_entries : null,
    shadows: built.shadows,
    events: built.events || [],
    combat: built.combat || null,
    rewards: built.rewards || null,
    grantMain: built.grantMain || null,
    refused: built.refused === true,
    // F137：副本封门拒绝的独立标记——与一般 refused（门禁/交战忙碌）区分，
    // 回包随 refused 一并下发，缺省不下发。
    escape_locked: built.escape_locked === true,
    // F138：遭遇来源标记（"rest" = 休憩惊动的杂兵）——意图层只在休息
    // 掷出遭遇时挂值，其余路径缺省不下发。
    encounter_source: built.encounter_source || null,
  };
}

// 结算日志落库（/action 与 /ai-action 共用）：单条动作照旧只写一条；
// outcome.log_entries（F200 连击逐回合战报）按序各写一条，applyOutcome
// 的追加播报（击杀奖励/升级/每日任务/死亡回溯）并进最后一条——与旧口径
// `${content}\n${extra}` 逐字一致（content 为空时保留原前导换行形态）。
// 返回写入的全部日志行，调用方取末条作 reply、整组作 replies。
function appendOutcomeLogs(saveId, role, outcome, extra) {
  const bodies =
    Array.isArray(outcome.log_entries) && outcome.log_entries.length
      ? outcome.log_entries.map((c) => String(c || ""))
      : [String(outcome.content || "")];
  if (extra.length) {
    const last = bodies.length - 1;
    bodies[last] = `${bodies[last]}\n${extra.join("\n")}`;
  }
  const rows = [];
  for (const b of bodies) {
    if (!b.trim()) continue;
    rows.push(store.appendLog(saveId, role, b));
  }
  if (!rows.length) rows.push(store.appendLog(saveId, role, "【系统】回合已结算。"));
  return rows;
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
      // F183：真实场景变更 = 本次守关房逗留结束——门拒提示分级计数清零，
      // 下次再到门前被拒重新给完整提示（含撤离折返/死亡回溯/后退）。
      if (
        outcome.patch.scene !== undefined &&
        outcome.patch.scene !== (before && before.scene)
      ) {
        gateHintReset(saveId);
      }
    }
    if (outcome.combat) {
      if (outcome.combat.op === "set") {
        store.setCombat(saveId, outcome.combat.enemy, outcome.combat.turn || 1);
        // F183：真打一场后提示分级同步清零——再战之后再回门前被拒，
        // 玩家重新需要完整状态面板而不是一行指引。
        gateHintReset(saveId);
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
    // F187：守关战落地回包不再单开【任务】段——任务奖励压成末尾一句
    // （brief 口径），让位给「敌 HP/我 HP/下一步按什么」三件事。
    const briefQuest = Boolean(
      outcome.combat &&
        outcome.combat.op === "set" &&
        outcome.combat.enemy &&
        outcome.combat.enemy.boss === true
    );
    const questNote = settleDailyQuests(saveId, outcome.events, { brief: briefQuest });
    if (questNote) lines.push(questNote);
    return lines;
  });
  return run();
}

// F146 脱战未识别兜底按语境生成：
//   ① 回显玩家原文——「系统未识别该指令：「X」」形态自 F129 起有客户端
//      依赖（回显被删曾打红 F076 交战信号断言），不得改写；
//   ② 命中面板操作词（加点/属性点/装备/卸下/技能……）先给一句具体指路
//      ——这些动作在面板里有真实路径，笼统问「想干什么」是死路；
//   ③ 收尾给 2–3 条与当前场景实况相关的可做之事（守关者封门指叫阵、
//      有自由点指属性、有伤且配额在指休息），不再固定追问
//      「你是想攻击还是想离开」——与语境无关的死问句已删。
const UNKNOWN_GUIDES = [
  {
    match: /加点|属性点|自由属性/,
    tip: "属性点请到「属性」面板分配（口述「属性」或「状态」直接打开）。",
  },
  {
    match: /装备|卸下|换装|穿上/,
    tip: "装备与卸下请到「背包」面板操作（口述「背包」直接打开）。",
  },
  {
    match: /技能/,
    tip: "技能请到「技能」面板查看与释放（口述「技能」直接打开）。",
  },
];

// F157 兜底场景化回应：回显与可做之事之间插一句「这句话落在场景里
// 发生了什么」的具象回应——玩家第一句自由输入就被干巴巴打回，选择感
// 归零。构造规则：
//   ① 从输入抽关键词分词族（刻痕/石像/门/血迹/听/闻/行囊/检视 8 族），
//      每族 ≥3 条句式；族内轮换计数挂进程内 Map（与 bossGatePushes
//      同口径），同一存档同一句连发必然换文；
//   ② 模板里的实体优先取当前场景正文真实出现的物（石碑/石像/石门…），
//      场景没写就落「四周」兜底——不凭空捏造殿里没有的东西；
//   ③ 未命中任何词族时用通用池，句子必须带场景叙述名（「命令之律」），
//      不许退回与场景无关的空话；
//   ④ 硬约束：不复读「眼下可以做」、不出现「你是想攻击还是想离开」、
//      不含客户端交战信号词（遭遇/第N回合/倒下了……）——这条日志会
//      进战斗面板的 gate 扫描。
const UNKNOWN_SCENE_ENTITIES = [
  "石像", "石碑", "石阶", "台阶", "祭坛", "石柱", "石门", "长明灯",
  "壁画", "石座", "光幕", "沙地", "兽骨", "火盆", "画像", "冰面",
  "刻痕", "血迹",
];

const UNKNOWN_SCENE_LINES = [
  {
    key: "carve",
    match: /刻痕|划痕|碑文|石碑|铭文|符纹|壁刻|文字|记号/,
    lines: [
      ({ entity }) => `你蹲下去，指尖划过${entity}上的刻痕：太浅，看不出是字还是磨损。`,
      ({ entity }) => `你凑近${entity}，就着微光辨认那些纹路——像字，又像谁随手划下的道子。`,
      ({ entity }) => `${entity}上的痕迹你来回看了两遍，深浅不一，辨不出究竟记了什么。`,
    ],
  },
  {
    key: "statue",
    match: /石像|雕像|塑像|神像|巨像/,
    lines: [
      ({ entity }) => `你屏息盯着${entity}看了片刻——纹丝不动，可那份安静本身就让人不敢挪眼。`,
      ({ entity }) => `你绕着${entity}慢慢走了半圈：表面冰冷，看不出哪里藏着机关。`,
      ({ entity }) => `${entity}的影子压在你脚边。你伸出手又缩回来——还是先别碰它。`,
    ],
  },
  {
    key: "door",
    match: /门|出口|入口|通道|锁|缝/,
    lines: [
      ({ entity }) => `你贴近${entity}摸索了一遍，缝里没有风——这边暂时走不通。`,
      ({ entity }) => `${entity}纹丝不动。你推了推，又侧耳听了听，里面什么回音都没有。`,
      ({ entity }) => `你检查了${entity}的边缘：没有把手，也没有能借力的地方。`,
    ],
  },
  {
    key: "blood",
    match: /血|尸体|尸|骨|残骸|遗体|伤痕|伤口|哀嚎/,
    lines: [
      () => `你顺着那点暗色看过去——痕迹已经干透，辨不出是什么时候留下的。`,
      () => `你蹲低看了看：颜色深得发黑，边缘早被尘土糊住，有些年头了。`,
      () => `你伸手在那处痕迹上方虚按了按，又缩回来——心里大致有了数，但说不上是什么。`,
    ],
  },
  {
    key: "listen",
    match: /听|倾听|聆听|声音|动静|响动/,
    lines: [
      () => `你屏住呼吸听了一会儿——只听见灯芯轻微的噼啪。`,
      ({ title }) => `你侧耳细听，「${title}」里安静得只剩下自己的心跳。`,
      () => `你闭眼凝神去听：远处隐约有极轻的摩擦声，又好像只是耳鸣。`,
    ],
  },
  {
    key: "smell",
    match: /闻|嗅|气味|味道|腥|臭/,
    lines: [
      () => `你轻轻嗅了嗅——空气里是陈年的潮气和土腥味，没有新的东西。`,
      () => `你分辨了一下周遭的气味：尘土、冷风，以及一丝说不清的铁锈味。`,
      () => `鼻腔里只有这里特有的滞涩空气，闻不出活物靠近的迹象。`,
    ],
  },
  {
    key: "bag",
    match: /背包|行囊|口袋|袋子|地图|包袱|身上/,
    lines: [
      () => `你低头翻了翻随身的东西——就这些家当，没有多出什么来。`,
      () => `你把行囊重新理了一遍：每件东西都还在原处，位置没变。`,
      () => `你确认了一遍随身的物件，该有的都在，不该有的一样没有。`,
    ],
  },
  {
    key: "inspect",
    match: /检查|端详|打量|摸|碰|敲|翻|拾|捡|蹲|试探|按/,
    lines: [
      ({ entity }) => `你仔细检查了${entity}——没有松动的机关，也没有藏东西的暗格。`,
      ({ entity }) => `你伸手在${entity}上敲了敲，声音实沉——里面大概是实的。`,
      ({ entity }) => `你把${entity}附近摸了个遍，除了冷硬的触感什么也没发现。`,
    ],
  },
];

const UNKNOWN_GENERIC_LINES = [
  ({ title }) => `在「${title}」里，这句话没能改变什么。`,
  ({ title }) => `「${title}」安静地应着——你做的这件事，没有惊动任何东西。`,
  ({ title }) => `你试着这么做了。「${title}」的一切照旧，没有回应，也没有阻拦。`,
];

// F180 回显共指去重：模板里的 `${entity}上的X` 在 entity 与 X 同名时会
// 叠出「刻痕上的刻痕」。插入名词与模板已有名词同指时改落「表面」表述，
// 不删整句回显（F076/F129 客户端依赖输入回显保留）。
const DUP_ENTITY_RE = /([一-鿿]{2,4})上的\1/g;
function dedupEcho(line) {
  return String(line || "").replace(DUP_ENTITY_RE, "$1表面");
}

const unknownAckSeq = new Map();
// F176：自由输入兜底回包的「眼下可以做…输入「帮助」」指令表尾巴按存档
// 只给一次（与 bossGatePushes 同口径的进程内计数）——自然语言长句每句
// 都复读操作说明会把叙事打断。指令形态输入走的也是这条兜底，首次命中
// 照常带表；「帮助」指令本身在另一分支返回完整指令表，不受影响。
const unknownTailShown = new Map();

function unknownSceneLine(save, input) {
  const scene = chaptersEngine.currentScene(save);
  const title = scene ? sceneNarrName(scene) : "此地";
  const blob = scene ? `${scene.title || ""}\n${scene.text || ""}` : "";
  // F162：共指与动作族交给 free-action 解析——玩家点名但不在静态
  // 词表里的物不再被整段丢弃，拾取动词不再被答成「检查」。
  const freeAction = require("./ai/free-action");
  const res = freeAction.resolveTarget(input, UNKNOWN_SCENE_ENTITIES, blob);
  const entity = res.target;
  const fam = UNKNOWN_SCENE_LINES.find((f) => f.match.test(input));
  const famKey = fam ? fam.key : "generic";
  const verb = freeAction.verbFamily(input);
  // 拾取族独立成池：捡/拾/拿/揣/收必须给后果叙述。inspect 与场景
  // 物三族（carve/statue/door）都让位——「捡起石碑上的刻痕」该答
  // 刻痕拿不走，不是再念一遍刻痕模板；listen/blood/smell/bag 四族
  // 维持既有行为与轮换。
  const PICKUP_OVERRIDE = new Set(["generic", "inspect", "carve", "statue", "door"]);
  if (verb === "pickup" && PICKUP_OVERRIDE.has(famKey)) {
    const key = `${save.id}|pickup`;
    const n = (unknownAckSeq.get(key) || 0) + 1;
    unknownAckSeq.set(key, n);
    return dedupEcho(
      freeAction.pickupOutcome(input, res.target, res.exists_in_scene, {
        takeable: !freeAction.FIXTURE_ENTITIES.has(res.target),
        anchor: freeAction.sceneAnchor(UNKNOWN_SCENE_ENTITIES, blob),
        variant: n - 1,
      })
    );
  }
  // 查看族点名了非场景物 → 明确否认，不得换个场景物作答。
  if (famKey === "inspect" && res.named_by_player && !res.exists_in_scene) {
    const key = `${save.id}|deny`;
    const n = (unknownAckSeq.get(key) || 0) + 1;
    unknownAckSeq.set(key, n);
    return dedupEcho(
      freeAction.denyLine(
        res.target,
        freeAction.sceneAnchor(UNKNOWN_SCENE_ENTITIES, blob),
        n - 1
      )
    );
  }
  // F181：玩家点名的场景实体（裂缝/石碑/石像/长明灯/石门/壁画）回实体
  // 专属细节——换措辞问同一实体不再复读同一条词族模板；按 save×entity
  // 轮换（与 observe 构建器共用 observeEntitySeq），未命中实体保持现状。
  const detailEntity = entityDetail.extractEntity(input);
  if (detailEntity) {
    const key = `${save.id}|ent|${detailEntity}`;
    const k = observeEntitySeq.get(key) || 0;
    observeEntitySeq.set(key, k + 1);
    return dedupEcho(entityDetail.detail(detailEntity, k));
  }
  const pool = fam ? fam.lines : UNKNOWN_GENERIC_LINES;
  const key = `${save.id}|${famKey}`;
  const n = (unknownAckSeq.get(key) || 0) + 1;
  unknownAckSeq.set(key, n);
  return dedupEcho(pool[(n - 1) % pool.length]({ title, entity }));
}

function unknownFallbackContent(save, input) {
  const guide = UNKNOWN_GUIDES.find((g) => g.match.test(input));
  const scene = chaptersEngine.currentScene(save);
  const todo = [];
  if (advanceMode(save) === "challenge_boss") {
    todo.push("说「攻击」或「叫阵」逼守关者现形再战");
  } else if (scene && scene.escape_locked === true) {
    todo.push("说「前进」硬闯守关者——击败它才能离开这里");
  }
  if ((Number(save.free_points) || 0) > 0) {
    todo.push("说「属性」打开面板分配自由属性点");
  }
  const rest = restStatus(save, null);
  if (rest.available && (save.hp < save.max_hp || save.mp < save.max_mp)) {
    todo.push(`说「休息」恢复体力与魔力（本章还可休息 ${rest.remaining}/${REST_LIMIT} 次）`);
  }
  todo.push("说「观察」环顾四周", "说「前进」推进剧情");
  // F166：自然语言长句不再回「系统未识别该指令：「X」」——玩家写的是
  // 一句行动描写，按解析报错打包退回会把「世界在回应我」打回「关键词
  // 表没匹配上」。指令形态（短词/信号词/数字键位）回显原样保留，
  // F076/F129 的客户端解析靠它开合战斗面板。
  const echo = require("./ai/free-action").echoRequired(input)
    ? `【系统】系统未识别该指令：「${input}」。`
    : "【系统】";
  const tailN = unknownTailShown.get(save.id) || 0;
  // F146：短尾巴同样要给 ≥2 条「说「X」」形态的可做之事（F146 按
  // /说「[^」]+」/ 计数）——「仍可：观察 · 前进」没有动词锚点会计数为 0，
  // 两个动词必须各自带「说」。
  const tail =
    tailN >= 1
      ? "仍可说「观察」或说「前进」。"
      : `眼下可以做：${todo.slice(0, 3).join("；")}。输入「帮助」查看完整指令表。`;
  if (tailN < 1) unknownTailShown.set(save.id, tailN + 1);
  return (
    echo +
    `${unknownSceneLine(save, input)}\n` +
    (guide ? `${guide.tip}\n` : "") +
    tail
  );
}

function resolveAction(save, input, choiceSel) {
  // 裸面板名最先走面板路由（F129）：比关键词表更靠前，因为「属性」
  // 「影子编队」本就会被 status/shadow_formation 意图接住而轮不到
  // unknown 分支——面板路由是同一意图的更好落地，不是新解析层。
  const panel = panelOutcome(input);
  if (panel) return panel;
  // F196 显式分支指令：请求体 choice_id 或文本「选择 <序|id|label>」。
  // 先于关键词表拦截——选项 id 可能撞上 advance/observe 等英文关键词，
  // 让关键词表先判会把「选择 observe」错拆成免费环顾。是否命中场景
  // 真实选项交给 choice 意图结算（选不上也给如实拒绝）。
  const sel =
    choiceSel !== undefined && choiceSel !== null && String(choiceSel).trim() !== ""
      ? String(choiceSel).trim()
      : choiceSelFromInput(input);
  if (sel !== null) return executeIntent(save, "choice", sel);
  // F154：背包真实补给名一并交给解析器——词尾表之外的点名叫法
  // （「喝能量饮」且背包真有「能量饮」）仍判 item；没点名不算。
  const intentId = intentRules.resolveIntent(input, bagSupplyNames(save));
  if (intentId) {
    return executeIntent(save, intentId, input);
  }
  // F200「连击 ×3」：指令词表在 ai/keywords.js（本改动不动它）——「连击」
  // 不含任何既有信号词，resolveIntent 必然返回 null，走到这里才判入
  // attack 意图的连击变体；与词表同口径吃疑问句守卫（「你会连击吗？」不触发）。
  if (/连击/.test(input) && !intentRules.QUESTION_FORM.test(input)) {
    return executeIntent(save, "attack", input);
  }
  // 交战中收到无法解析的输入：给战斗指令提示而不是通用提示。
  const cbt = store.getCombat(save.id);
  return {
    intent: "unknown",
    role: "system",
    patch: null,
    events: [],
    content: cbt
      ? (require("./ai/free-action").echoRequired(input)
          ? `【系统】系统未识别该指令：「${input}」。`
          : "【系统】") +
        `你正与${cbt.enemy.name}交战——` +
        `「攻击」「释放技能 X」「防御」「使用道具」或「使用/喝 <药名>」「逃跑」，或「前进」强行撤离。`
      : unknownFallbackContent(save, input),
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
      // chapterUnlockView 统一下发——与 saveView.chapter_unlock、过门
      // 播报同一事实源，前端只渲染 hint/blocked_reasons，不再自拼
      // 「需 Lv.X」。无 save_id 时只给静态门槛，门态为空。
      unlock: save
        ? chapterUnlockView(save, chapter)
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

// F136 存档找回：按猎人代号查存档摘要（同名匹配口径 = db.js 的
// NFKC+trim+大小写折叠精确匹配，前端不在本地另算）。名字空 → 400；
// 无命中 → { saves: [] }，两种结果前端都按「可继续/可新建」分支渲染。
api.get("/saves", (req, res) => {
  const playerName = String((req.query && req.query.player_name) || "").trim();
  if (!playerName) {
    return res.status(400).json({ error: "player_name is required" });
  }
  res.json({ saves: store.findSavesByName(playerName) });
});

api.post("/saves", (req, res) => {
  const playerName = String((req.body && req.body.player_name) || "").trim();
  if (!playerName) {
    return res.status(400).json({ error: "player_name is required" });
  }
  const mode = String((req.body && req.body.mode) || "").trim();
  // F136 重名检测：同名已有存档时默认拒绝（409），一条记录都不写——
  // 静默开新档会让玩家误以为找回了角色、旧档从此找不回。玩家明确选
  // 「另起新档」（mode === "new"）才放行，旧档保留不删，仅回包带
  // superseded_save_id 提示。
  const existing = store.findSavesByName(playerName);
  if (existing.length && mode !== "new") {
    const s = existing[0];
    return res.status(409).json({
      error: "existing_save",
      existing_save_id: s.id,
      existing: {
        id: s.id,
        level: s.level,
        chapter: s.chapter,
        clears: s.cleared_at ? 1 : 0,
        created_at: s.created_at,
        updated_at: s.updated_at,
      },
      name_conflict: true,
    });
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
  const body = { save: saveView(store.getSave(save.id)) };
  if (existing.length) {
    body.superseded_save_id = existing[0].id;
    body.replaced_note = "同名旧档仍保留在服务端，本浏览器此后只接入新档。";
  }
  res.status(201).json(body);
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
      supplyUseTail(item, qty - 1);
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
function settleDailyQuests(saveId, events, opts) {
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
  // F187 brief：守关战落地回包把任务奖励压成末尾一句（无【任务】段
  // 头），数字口径不变——入账事实照常播报，只是不再抢屏。
  const headline =
    opts && opts.brief === true
      ? `每日任务完成：${names}，奖励已入账 ${parts.join(" · ")}。`
      : `【任务】每日任务完成：${names}。奖励已入账 ${parts.join(" · ")}。`;
  return [headline, ...rewardLines].join("\n");
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
  // F196：choice_id 是显式分支指令（前端选项按钮/断言点名），随请求体
  // 下发——选择子的归属与门槛全由服务端按当前场景数据判定。
  const outcome = resolveAction(save, input, body.choice_id);
  // F096 章节门拒绝：零结算、零位移、零事件——applyOutcome 照跑空管线，
  // patch 本应为 null，谁把它改回带消耗谁就在响应里现形。
  // F142：但被拒的输入与拒绝文案本身是真实发生的往来——照旧写两条日志
  // （一条 user 原文、一条 system 拒绝文案），刷新后玩家回查有据；日志
  // 可见性不等于结算，数值口径不变。
  if (outcome.refused) {
    store.appendLog(save.id, "user", input);
    const extra = applyOutcome(save.id, outcome);
    const reply = store.appendLog(
      save.id,
      outcome.role || "system",
      extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content
    );
    const body = {
      reply,
      // F137：回包显式带解析出的 intent——与 /ai-action 同一口径，
      // 玩家与断言不必从文案反推这条输入被当成了什么。
      intent: outcome.intent,
      save: saveView(store.getSave(save.id) || save),
      // F094：回包显性带拒绝标记——交战门禁/章节门/终章同一口径，
      // 前端与断言不必从文案反推「这次动作被拒了」。
      refused: true,
    };
    if (outcome.escape_locked) body.escape_locked = true;
    return res.json(body);
  }
  store.appendLog(save.id, "user", input);
  // 真实结算事件随动作入账：战斗态/奖励/死亡回溯/每日任务都在
  // applyOutcome 里收敛，播报并进本条回复，不重开日志行。
  const extra = applyOutcome(save.id, outcome);
  // F200：连击等多条战报按序各写一条日志（appendOutcomeLogs），
  // 追加播报并进末条；单条动作仍只写一条，形态与旧口径逐字一致。
  const rows = appendOutcomeLogs(save.id, outcome.role, outcome, extra);
  const reply = rows[rows.length - 1];
  // F129：面板路由把目标面板 key 挂上回复——日志行只存 role/content，
  // panel 是回包附加字段不落库，前端凭它直接开对应抽屉。
  if (outcome.panel) reply.panel = outcome.panel;
  // F137：/action 回包同样带 intent（与 /ai-action 对齐）——自由输入
  // 解析结果对外可见，「挥一拳→attack」「离开→flee」可观测、可断言。
  const payload = { reply, intent: outcome.intent, save: saveView(store.getSave(save.id)) };
  if (rows.length > 1) payload.replies = rows;
  if (outcome.shadows) payload.shadows = outcome.shadows;
  if (outcome.panel) payload.panel = outcome.panel;
  if (outcome.escape_locked) payload.escape_locked = true;
  if (outcome.encounter_source) payload.encounter_source = outcome.encounter_source;
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

    // F174 散文快路径：echoRequired===false 的自然语言长句不打 AI 网关——
    // 线上实测每句散文都要白等一次慢模型往返（12s+），且 qwen 会把散文
    // 误判成 item 让 F162/F166 的具象否认整段丢失（答成补给播报）。散文
    // 直接走与 /action 同一规则入口 resolveAction，degraded 保持 falsy：
    // 这是正常路径不是降级，不弹「叙事引擎降级」横幅。指令形态照旧走 AI
    // 判意图，但单次网关预算压到 6s——默认 20s 曾让每条输入都拖成慢请求。
    const proseFastPath = !require("./ai/free-action").echoRequired(input);
    let intentId = null;
    let degraded = false;
    if (!proseFastPath) {
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
          timeoutMs: 6000,
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

      if (!intentId) degraded = true;
    }

    // F025：await AI 期间存档可能已被其它写入改动——先重读最新存档再结算，
    // outcome.patch 基于新快照产出，不再做旧快照增量回算。
    const fresh = store.getSave(save.id) || save;
    // F170：AI 不可用（degraded）时结算改走与 /action 完全相同的规则入口
    // ——关键词表/交锋分支/自由行动否认兜底都在 resolveAction 里；降级
    // 不再退回 observe 模板把自由输入答成通用观察话术。F174：散文快路径
    // 同走此口——对同一句输入与 /action 的正文逐字相同。
    const outcome =
      degraded || proseFastPath
        ? resolveAction(fresh, input)
        : executeIntent(fresh, intentId, input) || executeIntent(fresh, "observe", input);
    // F096 章节门拒绝：与 /action 同口径——零消耗、零事件、零位移；
    // F142：拒绝往来照旧落库两条日志（user 原文 + system 拒绝文案），
    // 数值结算口径不变。
    if (outcome.refused) {
      store.appendLog(save.id, "user", input);
      const extra = applyOutcome(save.id, outcome);
      const reply = store.appendLog(
        save.id,
        outcome.role || "system",
        extra.length ? `${outcome.content}\n${extra.join("\n")}` : outcome.content
      );
      const body = {
        reply,
        intent: outcome.intent,
        save: saveView(store.getSave(save.id) || fresh),
        refused: true,
        degraded,
      };
      // F137：副本封门拒绝与一般门禁拒绝同走 refused 短路，独立标记下发。
      if (outcome.escape_locked) body.escape_locked = true;
      return res.json(body);
    }
    store.appendLog(save.id, "user", input);
    const extra = applyOutcome(save.id, outcome);
    // F200：与 /action 同一落库口径——多条战报按序各写一条日志，
    // 单条动作仍只写一条。
    const rows = appendOutcomeLogs(save.id, outcome.role, outcome, extra);
    const reply = rows[rows.length - 1];
    const payload = { reply, intent: outcome.intent, save: saveView(store.getSave(save.id)) };
    if (rows.length > 1) payload.replies = rows;
    if (outcome.shadows) payload.shadows = outcome.shadows;
    if (outcome.encounter_source) payload.encounter_source = outcome.encounter_source;
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

module.exports = {
  app,
  saveView,
  grantRewards,
  chapterEntryNote,
  encounterRiseLine,
  ENCOUNTER_TERMINAL_MARKS,
};
