// Pure-function turn-based combat engine.
// resolveTurn(state, action, seed) -> { state, events, narration }
// Deterministic: identical inputs always produce identical outputs.
//
// 属性公式全部集中在 ./stats.js（F031），本文件只负责流程与事件文案。

const { createRng } = require("./rng");
const S = require("./stats");

const VALID_ACTIONS = new Set(["attack", "skill", "defend", "item", "flee"]);

const SKILL_COST = 8; // 基础技能消耗，实际消耗按智力折扣（stats.skillCost）
const ITEM_HEAL = 30;
const DEFEND_MULT = 0.5;
const FLEE_CHANCE = 0.5;

// F110 防御叙述：玩家侧防御事件在事件流中先于敌方结算事件落位，
// 减伤数字取真实结算（无防御倍率 raw 与实承 dmg 之差），措辞轮换。
const DEFEND_HIT_LINES = [
  "横刀格挡",
  "矮身卸力",
  "以臂甲架住来势",
];
const DEFEND_MISS_LINES = [
  "你横刀护住要害，它这一击擦着刀背落空。",
  "你沉身立稳架势，它的攻势贴着臂甲滑开。",
  "你借势轻轻一引，它的反击偏出半寸。",
];

function clamp(v, lo, hi) {
  return S.clamp(v, lo, hi);
}

// ============================================================================
// F034 猎人等级压制系数（E..S 跨级惩罚）
//
//   rankIndex(rank)  E=0 D=1 C=2 B=3 A=4 S=5，未知 / 缺省 / 非字符串 -> -1
//   rankFactor(attackerRank, defenderRank) -> 伤害系数（纯函数，永不抛错）
//
//   同级            1.00
//   攻方每高 1 级   +5%，上限 1.15（S 打 E 也只到 1.15）
//   攻方每低 1 级   -10%，硬下限 0.55（E 打 S 线性值 0.50 被夹到 0.55）
//   任一 rank 未知   回退 1（不惩罚、不奖励）
// ============================================================================
const RANK_ORDER = ["E", "D", "C", "B", "A", "S"];
const RANK_UP_STEP = 0.05;
const RANK_UP_MAX = 1.15;
const RANK_DOWN_STEP = 0.1;
const RANK_DOWN_MIN = 0.55;

// rank -> 序号；非法输入一律 -1，由 rankFactor 统一回退。
function rankIndex(rank) {
  if (typeof rank !== "string") return -1;
  return RANK_ORDER.indexOf(rank.trim().toUpperCase());
}

function rankFactor(attackerRank, defenderRank) {
  const a = rankIndex(attackerRank);
  const d = rankIndex(defenderRank);
  if (a < 0 || d < 0) return 1;
  const diff = a - d;
  if (diff === 0) return 1;
  if (diff > 0) return Math.min(RANK_UP_MAX, 1 + diff * RANK_UP_STEP);
  return Math.max(RANK_DOWN_MIN, 1 + diff * RANK_DOWN_STEP);
}

// ============================================================================
// F111 伤害单一事实源：战斗结算（strike）与技能面板的预计区间
// （damageRange）共用同一条 computeDamage——力量基数、暴击倍率、rank
// 压制、目标减伤、最小 1 点全部只在这一处定义，面板与回包数字同源。
//
//   computeDamage(attacker, def, { mult, crit, defenderRank }) -> 伤害值
//   skillMultOf(skill, fallbackEntity) -> 技能倍率（power/10，下限 0.5）
//   damageRange(attacker, skill, targets) -> { min, max }
// ============================================================================
function computeDamage(attacker, defenderDef, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const mult = S.num(o.mult) > 0 ? S.num(o.mult) : 1;
  const rankMul = rankFactor(attacker && attacker.rank, o.defenderRank);
  const multTotal = o.crit ? mult * rankMul * S.critMultiplier(attacker) : mult * rankMul;
  return S.physicalDamage(attacker, defenderDef, multTotal);
}

// 技能倍率：power/10、下限 0.5；power 缺失/为 0 时退回智力系数——
// 与 resolveTurn 的 skillUse 分支严格同一口径。
function skillMultOf(skill, fallbackEntity) {
  const raw = S.num(skill && skill.power) / 10;
  return Math.max(0.5, raw || S.skillMultiplier(fallbackEntity));
}

// 面板「预计伤害」的唯一算法：对每个可遭遇目标各算一遍不暴击/暴击
// 伤害（与 strike 同一条 computeDamage），min 取不暴击最低值、max 取
// 暴击最高值——天然覆盖实战落点（含 rank 压制与目标减伤差异）。
// targets 为空时退化为零防木桩，保证返回有限正整数区间。
function damageRange(attacker, skill, targets) {
  const mult = skillMultOf(skill, attacker);
  const list = Array.isArray(targets) && targets.length ? targets : [null];
  let min = Infinity;
  let max = -Infinity;
  for (const t of list) {
    const isEnt = t && typeof t === "object";
    const def = isEnt ? S.defenseFor(t) : 0;
    const opts = { mult, defenderRank: isEnt ? t.rank : undefined };
    const lo = computeDamage(attacker, def, { ...opts, crit: false });
    const hi = computeDamage(attacker, def, { ...opts, crit: true });
    if (lo < min) min = lo;
    if (hi > max) max = hi;
  }
  return { min, max };
}

// 实体消毒：属性/HP/MP 全部夹进合法区间，NaN 与负值安全降级。
function sanitizeEntity(entity) {
  const src = entity && typeof entity === "object" ? entity : {};
  const out = { ...src, stats: S.sanitizeStats(src) };
  const level = S.num(src.level);
  const has = (v) => v !== undefined && v !== null && Number.isFinite(Number(v));

  const maxHpRaw = S.num(src.maxHp);
  out.maxHp = maxHpRaw > 0 ? maxHpRaw : S.maxHpFor(level, out.stats);
  out.hp = has(src.hp) ? clamp(src.hp, 0, out.maxHp) : out.maxHp;

  const maxMpRaw = S.num(src.maxMp);
  out.maxMp = maxMpRaw > 0 ? maxMpRaw : S.maxMpFor(level, out.stats);
  out.mp = has(src.mp) ? clamp(src.mp, 0, out.maxMp) : out.maxMp;

  return out;
}

// 解析一次攻击/技能：命中 → 暴击 → 伤害。修改 defender 并追加事件。
function strike({ attacker, defender, attackerSide, defenderSide, defenderName, def, rng, events, mult = 1, label }) {
  const hit = S.hitChance(attacker, defender);
  if (!rng.chance(hit)) {
    const dodge = rng.chance(0.6);
    events.push({
      type: dodge ? "dodge" : "miss",
      side: defenderSide,
      text: dodge
        ? `${defenderName}侧身一闪，${label}落空了。`
        : `${label}偏离了目标，没有命中${defenderName}。`,
    });
    return { hit: false, dodge };
  }
  const crit = rng.chance(S.critChance(attacker));
  // F034：等级压制系数乘进最终倍率（computeDamage 内部合成，只用双方
  // rank，不消耗任何随机数——同 seed 下的 RNG 抽取序列不变）。
  const dmg = computeDamage(attacker, def, { mult, crit, defenderRank: defender.rank });
  defender.hp = clamp(defender.hp - dmg, 0, defender.maxHp);
  events.push({
    type: crit ? "crit" : "hit",
    side: attackerSide,
    value: dmg,
    text: crit
      ? `${label}正中${defenderName}要害，暴击造成 ${dmg} 点伤害！`
      : `${label}命中${defenderName}，造成 ${dmg} 点伤害。`,
  });
  if (defender.hp <= 0) {
    events.push({
      type: "defeat",
      side: defenderSide,
      text: `${defenderName}倒下了，战斗结束。`,
    });
  }
  return { hit: true, crit, dmg };
}

// ============================================================================
// F169 敌方阶段反应（纯叙述层，不改任何数值）
//
// 敌人 HP 首次下破 50% / 25% 两个阈值时，向本回合事件流末尾追加一句
// 敌人自身的阶段反应。模板按 kind/id/name 分池：石像类（石像/巨像/守
// 卫）写裂纹碎石，狼犬类写低吼呲牙绕后，蛇虫类写嘶鸣鳞片摩擦，其余走
// 通用池（喘息/摇晃/黑血）。每阶段 ≥3 条变体，按 (turn + enemy.seq)
// 轮换——不消耗 RNG 抽取，同 seed 下 hp/mp/敌 hp 逐回合与旧版完全相等；
// opts.phases === false 可整体关闭（供数值对照测试）。敌人倒下（含一击
// 秒杀）的回合不追加——死亡已有专门的收束句。
// ============================================================================
const ENEMY_PHASE_STAGES = [
  { key: "half", at: 0.5 },
  { key: "low", at: 0.25 },
];

const ENEMY_PHASE_TEMPLATES = {
  stone: {
    half: [
      "{name}的躯干绽开第一道裂纹，碎石簌簌而落。",
      "裂纹爬上{name}的肩甲，它的动作第一次透出滞涩。",
      "{name}的关节卡响了一声，石屑从缝隙里崩落。",
    ],
    low: [
      "{name}半边身子爬满裂纹，像一尊随时会散架的旧像。",
      "碎石不断从{name}身上剥落，它的重心已经开始摇晃。",
      "{name}的胸口透出细密的裂光，石臂抬得一次比一次沉。",
    ],
  },
  beast: {
    half: [
      "{name}低吼着退开半步，绕到你侧翼呲出了牙。",
      "{name}压低身形，喉咙里滚出一串受伤的低吼。",
      "{name}甩了甩头上的血，小步绕着换了个方向逼近。",
    ],
    low: [
      "{name}的呼吸开始发抖，却仍呲着牙不肯退。",
      "{name}夹着尾侧过身，压低的呜咽里缠着凶性。",
      "{name}踉跄半步又稳住，红着眼从侧翼重新咬住你的影子。",
    ],
  },
  serpent: {
    half: [
      "{name}发出一阵嘶鸣，鳞片刮擦着地面收紧了身位。",
      "{name}嘶嘶吐信，受伤的躯体反而缠得更紧。",
      "{name}的鳞片摩擦出沙沙声，它弓起身子重新蓄力。",
    ],
    low: [
      "{name}的嘶鸣变得又急又哑，躯干痉挛般抽动。",
      "{name}贴地滑行时拖出一道湿痕，鳞片已不再服帖。",
      "{name}的芯子吐得越来越快，残缺的身体绷成一张弓。",
    ],
  },
  generic: {
    half: [
      "{name}重重喘了口气，攻势里第一次露出空隙。",
      "{name}摇晃了一下，黑血顺着伤口淌了下来。",
      "{name}低低哼了一声，脚步不复先前稳当。",
    ],
    low: [
      "{name}浑身是伤，黑血不断滴落，却仍死死盯着你。",
      "{name}喘得越来越急，伤口涌出的黑血已经止不住。",
      "{name}已摇摇欲坠，眼里的凶光却没有散。",
    ],
  },
};

// 敌型分池：kind/id（英文模板键）与中文名关键词一起看，全不命中走通用池。
function enemyPhaseKind(enemy) {
  const e = enemy && typeof enemy === "object" ? enemy : {};
  const tag = `${e.kind || ""} ${e.id || ""} ${e.name || ""}`.toLowerCase();
  if (/石像|巨像|守卫|守护|statue|golem|guard/.test(tag)) return "stone";
  if (/狼|犬|wolf|hound/.test(tag)) return "beast";
  if (/蛇|虫|蚁|serpent|worm|ant/.test(tag)) return "serpent";
  return "generic";
}

function resolveTurn(state, action, seed, opts) {
  const events = [];
  const src = state && typeof state === "object" ? state : {};
  const options = opts && typeof opts === "object" ? opts : {};
  const next = {
    turn: S.num(src.turn),
    player: sanitizeEntity(src.player),
    enemy: sanitizeEntity(src.enemy),
  };
  const { player, enemy } = next;
  const enemyName = enemy.name || "敌人";

  // opts.item / opts.skill 由 index.js 注入真实目录数据（items.json /
  // skills.json）：缺省时回落到旧默认（治疗药水 ITEM_HEAL / 基础技能），
  // 保证纯函数测试与未接线调用方行为不变。
  const itemUse = options.item && typeof options.item === "object" ? options.item : null;
  const skillUse = options.skill && typeof options.skill === "object" ? options.skill : null;
  const itemName = itemUse && typeof itemUse.name === "string" && itemUse.name ? itemUse.name : "治疗药水";
  const itemHeal = itemUse ? Math.max(0, Math.trunc(S.num(itemUse.heal))) : ITEM_HEAL;
  const itemMp = itemUse ? Math.max(0, Math.trunc(S.num(itemUse.mp))) : 0;
  const skillCostNow = skillUse
    ? Math.max(1, Math.trunc(S.num(skillUse.mp_cost) || 1))
    : S.skillCost(player, SKILL_COST);
  const skillMult = skillUse
    ? skillMultOf(skillUse, player)
    : S.skillMultiplier(player);
  const skillLabel = skillUse && typeof skillUse.name === "string" && skillUse.name
    ? `「${skillUse.name}」`
    : "你的技能";

  if (!VALID_ACTIONS.has(action)) {
    events.push({ type: "error", side: "system", text: `未知的行动「${action}」，回合未推进。` });
    return { state: next, events, narration: "系统无法识别该指令。" };
  }

  const rng = createRng(seed);
  const playerAlive = player.hp > 0;
  const enemyAlive = enemy.hp > 0;

  if (!playerAlive) {
    events.push({ type: "defeat", side: "player", text: "你已经倒下，无法再行动。" });
    return { state: next, events, narration: "你失去了意识。" };
  }

  if (!enemyAlive) {
    events.push({ type: "defeat", side: "enemy", text: `${enemyName}已经倒下，没有可攻击的目标。` });
    return { state: next, events, narration: "战斗早已结束。" };
  }

  // 防御姿态在本回合内始终生效（即使敌人抢先出手，也能及时架住）。
  const defending = action === "defend";
  const defendMult = defending ? DEFEND_MULT : 1;
  let fled = false;
  // F169：阶段阈值判定用的回合前敌方 HP——必须在任何 strike 之前快照。
  const enemyHpBefore = enemy.hp;

  // 玩家行动：与旧版行为一致，但技能伤害系数与 MP 消耗由智力决定。
  const playerActs = () => {
    switch (action) {
      case "attack":
        strike({
          attacker: player, defender: enemy,
          attackerSide: "player", defenderSide: "enemy",
          defenderName: enemyName, def: S.defenseFor(enemy),
          rng, events, label: "你的攻击",
        });
        break;
      case "skill":
        if (player.mp < skillCostNow) {
          events.push({ type: "error", side: "system", text: `魔力不足（需要 ${skillCostNow} MP），技能释放失败。` });
        } else {
          player.mp = clamp(player.mp - skillCostNow, 0, player.maxMp);
          strike({
            attacker: player, defender: enemy,
            attackerSide: "player", defenderSide: "enemy",
            defenderName: enemyName, def: S.defenseFor(enemy),
            rng, events, mult: skillMult, label: skillLabel,
          });
        }
        break;
      case "defend":
        // 姿态已在 `defending` 中生效；先落位玩家侧防御事件，
        // 具体措辞与减伤数字待敌方结算后由 enemyActs 回填。
        pushDefendEvent();
        break;
      case "item": {
        const beforeHp = player.hp;
        const beforeMp = player.mp;
        player.hp = clamp(player.hp + itemHeal, 0, player.maxHp);
        player.mp = clamp(player.mp + itemMp, 0, player.maxMp);
        const healed = player.hp - beforeHp;
        const restored = player.mp - beforeMp;
        const parts = [];
        if (healed > 0) parts.push(`恢复 ${healed} 点生命`);
        if (restored > 0) parts.push(`恢复 ${restored} 点魔力`);
        events.push({
          type: "heal", side: "player", value: healed + restored,
          text: parts.length
            ? `你使用了「${itemName}」，${parts.join("、")}。`
            : `你使用了「${itemName}」，但状态已满，毫无效果。`,
        });
        break;
      }
    }
  };

  // 防御叙述占位：玩家先手时由 playerActs 推入、敌人先手时在此处
  // 推入——保证防御事件始终排在敌方命中/闪避事件之前。
  let defendEv = null;
  const pushDefendEvent = () => {
    if (!defendEv) {
      defendEv = { type: "damage", side: "player", value: 0, text: "" };
      events.push(defendEv);
    }
    return defendEv;
  };

  const enemyActs = () => {
    const ev = defending ? pushDefendEvent() : null;
    const res = strike({
      attacker: enemy, defender: player,
      attackerSide: "enemy", defenderSide: "player",
      defenderName: "你", def: S.defenseOf(player),
      rng, events, mult: defendMult, label: `${enemyName}的反击`,
    });
    if (!ev) return;
    // 措辞抽取放在 strike 之后：防御回合的命中/暴击判定序列与旧版
    // 完全一致，只多消耗一次收尾抽取，不影响既有 seed 的结算结果。
    if (res && res.hit) {
      const raw = computeDamage(enemy, S.defenseOf(player), {
        crit: res.crit, defenderRank: player.rank,
      });
      const reduced = Math.max(0, raw - res.dmg);
      const line = DEFEND_HIT_LINES[rng.int(0, DEFEND_HIT_LINES.length - 1)];
      ev.value = res.dmg;
      ev.blocked = reduced;
      ev.text = `${line} · 这一击被卸去大半（你只受 ${res.dmg} 点，减免 ${reduced}）`;
    } else {
      ev.text = DEFEND_MISS_LINES[rng.int(0, DEFEND_MISS_LINES.length - 1)];
    }
  };

  // 先手判定：敏捷 + 0.5 × 感知，高者先动；平手时玩家先手（保持旧行为）。
  // F095 逃跑先行结算：判定在吃任何反击之前——成功脱身本回合零伤害，
  // 只有被拦下才挨敌人一击（boss 房逃生阀，交战中「前进」同走此路）。
  let enemyFirst = false;
  if (action === "flee") {
    if (rng.chance(FLEE_CHANCE)) {
      fled = true;
      events.push({ type: "flee", side: "player", text: "你抓住机会脱离战斗，成功逃跑！" });
    } else {
      events.push({ type: "flee", side: "enemy", text: "你试图逃跑，却被敌人拦了下来。" });
      if (enemy.hp > 0 && player.hp > 0) enemyActs();
    }
  } else if ((enemyFirst = S.initiative(enemy) > S.initiative(player))) {
    enemyActs();
    if (player.hp > 0) playerActs();
  } else {
    playerActs();
    if (enemy.hp > 0 && player.hp > 0) enemyActs();
  }

  // 防御回合敌人必然行动（玩家存活、敌人存活均已校验）；此兜底仅
  // 防未来分支改动让占位文案空挂。
  if (defendEv && !defendEv.text) {
    defendEv.text = "你摆出防御姿态，稳稳压住重心。";
  }

  // F169 敌方阶段反应：敌人存活且 HP 首次下破 50% / 25% → 向事件流末尾
  // 追加一句敌人自身的反应（倒下/秒杀回合不追加）。变体按 (回合 + 开战
  // 盐 seq) 轮换，不走 RNG、不动数值——同 seed 下结算与旧版逐回合一致。
  if (options.phases !== false && enemy.hp > 0 && enemy.maxHp > 0) {
    const fracBefore = enemyHpBefore / enemy.maxHp;
    const fracAfter = enemy.hp / enemy.maxHp;
    const seq = Math.max(0, Math.trunc(S.num(enemy.seq)));
    const turnNo = Math.max(0, Math.trunc(S.num(src.turn)));
    const pool = ENEMY_PHASE_TEMPLATES[enemyPhaseKind(enemy)];
    ENEMY_PHASE_STAGES.forEach((stage, i) => {
      if (fracBefore > stage.at && fracAfter <= stage.at) {
        const lines = pool[stage.key];
        events.push({
          type: "phase",
          side: "enemy",
          stage: stage.key,
          text: lines[(turnNo + seq + i) % lines.length].replace(/\{name\}/g, enemyName),
        });
      }
    });
  }

  next.turn = S.num(src.turn) + 1;

  const narration =
    `第 ${S.num(src.turn)} 回合：` +
    (enemyFirst ? `${enemyName}敏捷更高，抢先出手。` : "") +
    (defending ? "你摆出防御姿态。" : "") +
    events.map((e) => e.text).join(" ");

  return { state: next, events, narration };
}

module.exports = {
  resolveTurn,
  rankFactor,
  rankIndex,
  RANK_ORDER,
  computeDamage,
  skillMultOf,
  damageRange,
  enemyPhaseKind,
  ENEMY_PHASE_TEMPLATES,
};
