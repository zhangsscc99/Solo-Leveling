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
    return;
  }
  const crit = rng.chance(S.critChance(attacker));
  // F034：等级压制系数乘进最终倍率。只用双方 rank，不消耗任何随机数，
  // 因此不改变同 seed 下的 RNG 抽取序列，确定性保持不变。
  const rankMul = rankFactor(attacker.rank, defender.rank);
  const multTotal = crit ? mult * rankMul * S.critMultiplier(attacker) : mult * rankMul;
  const dmg = S.physicalDamage(attacker, def, multTotal);
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
    ? Math.max(0.5, S.num(skillUse.power) / 10 || S.skillMultiplier(player))
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
        // 姿态已在 `defending` 中生效，无需额外事件。
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
      case "flee":
        if (rng.chance(FLEE_CHANCE)) {
          fled = true;
          events.push({ type: "flee", side: "player", text: "你抓住机会脱离战斗，成功逃跑！" });
        } else {
          events.push({ type: "flee", side: "enemy", text: "你试图逃跑，却被敌人拦了下来。" });
        }
        break;
    }
  };

  const enemyActs = () => {
    strike({
      attacker: enemy, defender: player,
      attackerSide: "enemy", defenderSide: "player",
      defenderName: "你", def: S.defenseOf(player),
      rng, events, mult: defendMult, label: `${enemyName}的反击`,
    });
  };

  // 先手判定：敏捷 + 0.5 × 感知，高者先动；平手时玩家先手（保持旧行为）。
  const enemyFirst = S.initiative(enemy) > S.initiative(player);
  if (enemyFirst) {
    enemyActs();
    if (player.hp > 0 && !fled) playerActs();
  } else {
    playerActs();
    if (enemy.hp > 0 && player.hp > 0 && !fled) enemyActs();
  }

  next.turn = S.num(src.turn) + 1;

  const narration =
    `第 ${S.num(src.turn)} 回合：` +
    (enemyFirst ? `${enemyName}敏捷更高，抢先出手。` : "") +
    (defending ? "你摆出防御姿态。" : "") +
    events.map((e) => e.text).join(" ");

  return { state: next, events, narration };
}

module.exports = { resolveTurn, rankFactor, rankIndex, RANK_ORDER };
