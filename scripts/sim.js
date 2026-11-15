// 战斗模拟脚本：npm run sim -- [options]
// 纯 CLI，零依赖，不碰数据库。只使用 server/engine 纯函数与 data/*.json。

const path = require("path");
const { resolveTurn } = require("../server/engine/combat");
const { MAX_LEVEL } = require("../server/engine/progression");
const LEVELS = require(path.join(__dirname, "..", "server", "data", "levels.json"));

const DEFAULT_STATS = {
  strength: 10,
  agility: 12,
  vitality: 8,
  intelligence: 10,
  perception: 14,
};

const SKILL_COST = 8;
const MAX_TURNS = 200;
const STAT_KEYS = ["strength", "agility", "vitality", "intelligence", "perception"];

// 敌人预设：rank 仅用于展示，atk 映射为 stats.strength。
const ENEMY_PRESETS = {
  goblin: { id: "goblin", name: "哥布林", rank: "E", level: 1, hp: 60, atk: 10, def: 4, agility: 8 },
  wolf: { id: "wolf", name: "森林狼", rank: "E", level: 3, hp: 90, atk: 14, def: 5, agility: 16 },
  orc: { id: "orc", name: "半兽人战士", rank: "D", level: 8, hp: 160, atk: 20, def: 9, agility: 10 },
  knight: { id: "knight", name: "装甲骑士", rank: "C", level: 15, hp: 260, atk: 28, def: 16, agility: 12 },
  shadow: { id: "shadow", name: "暗影猎手", rank: "B", level: 25, hp: 380, atk: 38, def: 20, agility: 30 },
};

const USAGE = `用法：node scripts/sim.js [选项]

选项：
  --runs <N>      模拟场数（正整数，默认 200）
  --seed <S>      基准种子（数字或字符串；默认随机生成并打印）
  --level <L>     玩家等级（1-${MAX_LEVEL}，默认 1）
  --enemy <spec>  敌人：preset 名 ${Object.keys(ENEMY_PRESETS).join("|")}
                  或组合 hp=200,atk=18,def=10[,agi=12]（缺省按哥布林补齐）
  --policy <name> 策略：simple（默认）| aggressive | defensive
  -h, --help      显示本说明
`;

function fail(msg) {
  process.stderr.write(`错误：${msg}\n\n${USAGE}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { runs: 200, seed: null, level: 1, enemy: "goblin", policy: "simple" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const need = () => {
      if (i + 1 >= argv.length) throw new Error(`选项 ${a} 缺少参数`);
      return argv[++i];
    };
    switch (a) {
      case "-h":
      case "--help":
        return { help: true };
      case "--runs": {
        const n = Number(need());
        if (!Number.isInteger(n) || n <= 0) throw new Error("--runs 必须是正整数");
        opts.runs = n;
        break;
      }
      case "--seed":
        opts.seed = need();
        break;
      case "--level": {
        const n = Number(need());
        if (!Number.isInteger(n) || n < 1 || n > MAX_LEVEL) {
          throw new Error(`--level 必须是 1-${MAX_LEVEL} 的整数`);
        }
        opts.level = n;
        break;
      }
      case "--enemy":
        opts.enemy = need();
        break;
      case "--policy":
        opts.policy = need();
        if (!POLICIES[opts.policy]) {
          throw new Error(`未知策略「${opts.policy}」，可选：${Object.keys(POLICIES).join("|")}`);
        }
        break;
      default:
        throw new Error(`未知选项「${a}」`);
    }
  }
  return opts;
}

// 玩家构造：DEFAULT_STATS + 将升级获得的自由点均衡分配到五项属性。
function buildPlayer(level) {
  const stats = { ...DEFAULT_STATS };
  let points = 0;
  for (const e of LEVELS) {
    if (e.level > 1 && e.level <= level) points += e.freePoints || 0;
  }
  for (let i = 0; i < points; i++) stats[STAT_KEYS[i % STAT_KEYS.length]] += 1;

  const maxHp = 80 + level * 4 + stats.vitality * 10;
  const maxMp = 10 + level * 2 + stats.intelligence * 5;
  return {
    hp: maxHp,
    maxHp,
    mp: maxMp,
    maxMp,
    level,
    rank: "E",
    stats,
  };
}

function buildEnemy(spec) {
  let base;
  if (ENEMY_PRESETS[spec]) {
    base = { ...ENEMY_PRESETS[spec] };
  } else {
    base = { ...ENEMY_PRESETS.goblin, name: `自定义敌人(${spec})` };
    for (const pair of spec.split(/[,\s]+/).filter(Boolean)) {
      const m = pair.match(/^(hp|atk|def|agi)=(\d+)$/);
      if (!m) throw new Error(`敌人参数「${pair}」格式错误，应为 hp=..,atk=..,def=..[,agi=..]`);
      const key = m[1] === "agi" ? "agility" : m[1];
      base[key] = Number(m[2]);
    }
  }
  return {
    id: base.id,
    name: base.name,
    hp: base.hp,
    maxHp: base.hp,
    level: base.level,
    rank: base.rank,
    def: base.def,
    atk: base.atk,
    stats: {
      strength: base.atk, // rawDamage ≈ atk（见任务约束）
      agility: base.agility,
      vitality: 10,
      intelligence: 5,
      perception: 10,
    },
  };
}

const POLICIES = {
  simple(state) {
    const p = state.player;
    if (p.hp < p.maxHp * 0.3) {
      return p.hp >= p.maxHp - 5 ? "defend" : "item";
    }
    if (p.mp >= SKILL_COST && state.turn % 3 === 0) return "skill";
    return "attack";
  },
  aggressive() {
    return "attack";
  },
  defensive(state) {
    return state.player.hp < state.player.maxHp * 0.5 ? "defend" : "attack";
  },
};

function chooseAction(state, policy) {
  return POLICIES[policy](state);
}

// 模拟一场战斗；每回合使用确定但不同的种子。
function simulateRun({ baseSeed, runIndex, player, enemy, policy }) {
  const state = {
    turn: 1,
    player: JSON.parse(JSON.stringify(player)),
    enemy: JSON.parse(JSON.stringify(enemy)),
  };
  const actions = [];
  let fled = false;

  while (state.turn <= MAX_TURNS) {
    const action = chooseAction(state, policy);
    actions.push(action);
    const seed = `${baseSeed}:${runIndex}:${state.turn}`;
    const res = resolveTurn(state, action, seed);
    state.turn = res.state.turn;
    state.player = res.state.player;
    state.enemy = res.state.enemy;

    if (res.events.some((e) => e.type === "flee" && e.side === "player")) {
      fled = true;
      break;
    }
    if (state.enemy.hp <= 0 || state.player.hp <= 0) break;
  }

  let outcome;
  if (state.enemy.hp <= 0) outcome = "win";
  else if (state.player.hp <= 0) outcome = "loss";
  else if (fled) outcome = "flee";
  else outcome = "timeout";

  return {
    outcome,
    turns: actions.length,
    hpPct: state.player.maxHp > 0 ? state.player.hp / state.player.maxHp : 0,
    actions,
  };
}

const OUTCOME_LABEL = { win: "胜利", loss: "战败", flee: "逃跑", timeout: "超时" };

function fmtStats(s) {
  return `力${s.strength} 敏${s.agility} 体${s.vitality} 智${s.intelligence} 感${s.perception}`;
}
// 按「终端显示宽度」补空格，避免中文（双宽）+ ASCII 混排时冒号错位。
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/;
const dispWidth = (s) => [...String(s)].reduce((n, c) => n + (WIDE.test(c) ? 2 : 1), 0);
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - dispWidth(s)));

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    return fail(e.message);
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return;
  }

  const baseSeed = opts.seed === null ? Math.floor(Math.random() * 2 ** 31) : opts.seed;
  const player = buildPlayer(opts.level);
  let enemy;
  try {
    enemy = buildEnemy(opts.enemy);
  } catch (e) {
    return fail(e.message);
  }

  const results = [];
  for (let r = 0; r < opts.runs; r++) {
    results.push(simulateRun({ baseSeed, runIndex: r + 1, player, enemy, policy: opts.policy }));
  }

  const wins = results.filter((r) => r.outcome === "win");
  const losses = results.filter((r) => r.outcome === "loss");
  const flees = results.filter((r) => r.outcome === "flee").length;
  const timeouts = results.filter((r) => r.outcome === "timeout").length;
  const avgTurns = results.reduce((s, r) => s + r.turns, 0) / results.length;
  const avgHp = wins.length
    ? (wins.reduce((s, r) => s + r.hpPct, 0) / wins.length) * 100
    : null;

  let longest = null;
  let shortest = null;
  results.forEach((r, i) => {
    if (!longest || r.turns > longest.turns) longest = { ...r, idx: i };
    if (!shortest || r.turns < shortest.turns) shortest = { ...r, idx: i };
  });

  const L = [];
  L.push("=== 战斗模拟 ===");
  L.push(`${pad("场次", 12)}: ${opts.runs}`);
  L.push(`${pad("种子", 12)}: ${baseSeed}${opts.seed === null ? "（随机生成，可用 --seed 复现）" : ""}`);
  L.push(
    `${pad("玩家等级", 12)}: ${opts.level}   (HP ${player.maxHp} / MP ${player.maxMp} / ${fmtStats(player.stats)})`
  );
  L.push(`${pad("敌人", 12)}: ${enemy.name} (HP ${enemy.maxHp} / 攻 ${enemy.atk} / 防 ${enemy.def})`);
  L.push(`${pad("策略", 12)}: ${opts.policy}`);
  L.push("");
  L.push("结果统计");
  L.push(
    `  ${pad("胜率", 10)} : ${((wins.length / opts.runs) * 100).toFixed(1)}%   (${wins.length} 胜 / ${losses.length} 负 / ${flees} 逃跑 / ${timeouts} 超时)`
  );
  L.push(`  ${pad("平均回合数", 10)} : ${avgTurns.toFixed(1)}`);
  L.push(`  ${pad("平均剩余HP", 10)} : ${avgHp === null ? "-" : avgHp.toFixed(1) + "%"}`);
  L.push(
    `  ${pad("最长对局", 10)} : ${longest.turns} 回合 (第 ${longest.idx + 1} 场, ${OUTCOME_LABEL[longest.outcome]})`
  );
  L.push(
    `  ${pad("最短对局", 10)} : ${shortest.turns} 回合 (第 ${shortest.idx + 1} 场, ${OUTCOME_LABEL[shortest.outcome]})`
  );
  L.push("");
  L.push("失败样本（最多 2 条）");
  const failSamples = results
    .map((r, i) => ({ ...r, idx: i }))
    .filter((r) => r.outcome !== "win")
    .slice(0, 2);
  if (failSamples.length === 0) {
    L.push("  无");
  } else {
    for (const r of failSamples) {
      const seq =
        r.actions.length > 25 ? r.actions.slice(0, 25).join(" → ") + " → ..." : r.actions.join(" → ");
      L.push(
        `  [第 ${r.idx + 1} 场] 种子 ${baseSeed}:${r.idx + 1}  回合 ${r.turns}  剩余 HP ${(r.hpPct * 100).toFixed(0)}%  (${OUTCOME_LABEL[r.outcome]})`
      );
      L.push(`    ${seq}`);
    }
  }

  process.stdout.write(L.join("\n") + "\n");
}

if (require.main === module) main();
