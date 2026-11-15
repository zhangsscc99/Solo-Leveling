// Pure-function turn-based combat engine.
// resolveTurn(state, action, seed) -> { state, events, narration }
// Deterministic: identical inputs always produce identical outputs.

const { createRng } = require("./rng");

const VALID_ACTIONS = new Set(["attack", "skill", "defend", "item", "flee"]);

const SKILL_COST = 8;
const ITEM_HEAL = 30;
const DEFEND_MULT = 0.5;
const FLEE_CHANCE = 0.5;
const BASE_CRIT_CHANCE = 0.05;
const BASE_CRIT_MULT = 1.5;

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function statOf(entity, key) {
  const s = entity.stats || {};
  const n = Number(s[key]);
  return Number.isFinite(n) ? n : 0;
}

function clone(entity) {
  return { ...entity, stats: { ...(entity.stats || {}) } };
}

// Hit chance derived from attacker's agility+perception vs defender's agility.
function hitChance(attacker, defender) {
  const acc = statOf(attacker, "agility") * 0.6 + statOf(attacker, "perception") * 0.4;
  const eva = statOf(defender, "agility");
  return clamp(0.85 + (acc - eva) * 0.02, 0.2, 0.98);
}

// Crit chance driven by perception.
function critChance(attacker) {
  return clamp(BASE_CRIT_CHANCE + statOf(attacker, "perception") * 0.005, 0.01, 0.5);
}

function rawDamage(attacker, defenderDef, mult) {
  const base = statOf(attacker, "strength") * 1.6 + statOf(attacker, "agility") * 0.2;
  return Math.max(1, Math.round((base - defenderDef * 0.8) * mult));
}

function playerDef(player) {
  return Math.round(statOf(player, "vitality") * 0.8);
}

function enemyDef(enemy) {
  const n = Number(enemy.def);
  return Number.isFinite(n) ? n : Math.round(statOf(enemy, "vitality") * 0.8);
}

// Resolve one side striking another. Mutates `defender` copy and `events`.
function strike({ attacker, defender, attackerSide, defenderSide, defenderName, def, rng, events, mult = 1, label }) {
  if (!rng.chance(hitChance(attacker, defender))) {
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
  const crit = rng.chance(critChance(attacker));
  const dmg = rawDamage(attacker, def, mult * (crit ? BASE_CRIT_MULT : 1));
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

function resolveTurn(state, action, seed) {
  const events = [];
  const next = {
    turn: state.turn,
    player: clone(state.player),
    enemy: clone(state.enemy),
  };
  const { player, enemy } = next;
  const enemyName = enemy.name || "敌人";

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

  let defending = false;
  let fled = false;

  if (enemyAlive) {
    switch (action) {
      case "attack":
        strike({
          attacker: player, defender: enemy,
          attackerSide: "player", defenderSide: "enemy",
          defenderName: enemyName, def: enemyDef(enemy),
          rng, events, label: "你的攻击",
        });
        break;
      case "skill":
        if (player.mp < SKILL_COST) {
          events.push({ type: "error", side: "system", text: `魔力不足（需要 ${SKILL_COST} MP），技能释放失败。` });
        } else {
          player.mp = clamp(player.mp - SKILL_COST, 0, player.maxMp);
          strike({
            attacker: player, defender: enemy,
            attackerSide: "player", defenderSide: "enemy",
            defenderName: enemyName, def: enemyDef(enemy),
            rng, events, mult: 1.8, label: "你的技能",
          });
        }
        break;
      case "defend":
        defending = true;
        break;
      case "item": {
        const before = player.hp;
        player.hp = clamp(player.hp + ITEM_HEAL, 0, player.maxHp);
        const healed = player.hp - before;
        events.push({
          type: "heal", side: "player", value: healed,
          text: healed > 0 ? `你使用了治疗药水，恢复 ${healed} 点生命。` : "你使用了治疗药水，但生命已满，毫无效果。",
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
  } else {
    events.push({ type: "defeat", side: "enemy", text: `${enemyName}已经倒下，没有可攻击的目标。` });
    return { state: next, events, narration: "战斗早已结束。" };
  }

  // Enemy counterattack in the same turn, if still alive and player hasn't fled.
  if (enemy.hp > 0 && player.hp > 0 && !fled) {
    const mult = defending ? DEFEND_MULT : 1;
    strike({
      attacker: enemy, defender: player,
      attackerSide: "enemy", defenderSide: "player",
      defenderName: "你", def: playerDef(player),
      rng, events, mult, label: `${enemyName}的反击`,
    });
  }

  if (playerAlive || fled) {
    next.turn = state.turn + 1;
  }

  const narration =
    `第 ${state.turn} 回合：` +
    (defending ? "你摆出防御姿态。" : "") +
    events.map((e) => e.text).join(" ");

  return { state: next, events, narration };
}

module.exports = { resolveTurn };
