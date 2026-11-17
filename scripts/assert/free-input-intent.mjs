#!/usr/bin/env node
// F137 自由输入意图覆盖契约（全是行为断言）：
//
//   (a) 交战态口语化攻击——「对着石像挥一拳」「出手打它」「劈它一刀」每次
//       intent==="attack"、敌人 HP 真降、回合数 +1（三句各算一回合，
//       不再像旧版一样回指令表白输）。
//   (b) 交战态「离开这里」= 撤离掷逃（intent==="flee"，与「逃跑」同一
//       结算管线），绝不推进主线——scene/chapter 不得前移。
//   (c)(d) 非交战 + escape_locked 场景（数据驱动：chapters.json 场景级
//       字段，ch2_penalty_gate）输「离开这里」「撤离副本」——refused 短路、
//       scene 不动、不掷遭遇、回包不含「毒牙蛇」「未识别」、含「无法撤离/
//       不能撤离」并给出真实出路，日志零增长。
//   (e) 非交战普通场景「离开这里」——零状态变更，回「没有交战/无需撤离」
//       提示，绝不路由成 advance。
//   (f) 「回到第1章」——无论普通场景还是封门副本，不得回「未识别」、
//       不得改 scene。
//   (g) 乱码「阿巴阿巴」——脱战兜底按 F146 语境生成：必须回显玩家原文
//       （「系统未识别该指令：「X」」），不再固定追问「你是想攻击还是想
//       离开？」，且给出与当前场景相关的可做之事。
//
//   落点/交战锻造走 DB 直写（同 gate-refusal-free.mjs 取径）。
//   (a) 的命中判定吃回合种子 combat:{save_id}:{seq}:{turn}——脚本用引擎
//   纯函数 resolveTurn 先仿真、挑一个三回合全命中的 seq 再锻造交战行，
//   断言不赌那 2% miss。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：attack/flee 词表回退（旧正则）→ (a)(b)(c)(d)(f) 全 FAIL；
//   escape_locked 分支删掉 → (c)(d) FAIL（scene 会走/文案不对）；
//   advance 正则加回「离开」→ (b)(c) FAIL；兜底丢掉输入回显或退回
//   固定问句（F146 回归）→ (g) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView, get } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const combatEngine = require(path.join(ROOT, "server", "engine", "combat.js"));
const encounterEngine = require(path.join(ROOT, "server", "engine", "encounter.js"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// ── 独立 oracle：交战锻造与命中预测只用引擎纯函数，不走服务端私有路径 ──
const DEFAULT_STATS = { strength: 10, agility: 12, vitality: 8, intelligence: 10, perception: 14 };

function forgeSave(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

function forgeCombat(id, enemy, turn = 1) {
  db.prepare(
    "INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, ?) " +
      "ON CONFLICT(save_id) DO UPDATE SET enemy_json = excluded.enemy_json, turn = excluded.turn"
  ).run(id, JSON.stringify(enemy), turn);
}

// 与服务端 combatTurn 同一种子格式：combat:{save_id}:{enemy.seq}:{turn}。
// 用 resolveTurn 预演三连攻击，只挑三回合敌血全降、玩家不倒的 seq——
// 断言拿到的是必然命中，不是运气。
function pickSeq(saveId, enemyTpl, playerTpl, turns = 3) {
  for (let seq = 1; seq <= 500; seq++) {
    let state = {
      turn: 1,
      player: JSON.parse(JSON.stringify(playerTpl)),
      enemy: JSON.parse(JSON.stringify({ ...enemyTpl, seq })),
    };
    let good = true;
    for (let t = 0; t < turns && good; t++) {
      const before = state.enemy.hp;
      const r = combatEngine.resolveTurn(state, "attack", `combat:${saveId}:${seq}:${state.turn}`, {});
      good = r.state.enemy.hp < before && r.state.player.hp > 0;
      state = r.state;
    }
    if (good) return seq;
  }
  return null;
}

async function logCount(id) {
  const r = await get(`/saves/${id}/log?limit=400`);
  assert(r.status === 200 && Array.isArray(r.body.log), `log fetch failed (HTTP ${r.status})`);
  return r.body.log.length;
}

const PENALTY_GATE = "ch2_penalty_gate";
const PENALTY_BOSS = "ch2_poison_fang";

// ── (a) 交战态三句口语化攻击：intent=attack · 敌血降 · 回合+1 ──────────
{
  const id = await makeSave("f137-atk");
  const { save } = await fetchSaveView(id);
  const sceneBefore = save.scene;
  const enemyTpl = encounterEngine.makeEnemy({
    id: "broken_statue",
    name: "石像残兵",
    rank: "E",
    level: 2,
    hp: 300,
    xp: 22,
  });
  enemyTpl.stats.agility = 0; // 闪避归零——命中封顶，断言不赌 miss
  const playerTpl = {
    name: save.player_name,
    level: save.level,
    rank: save.rank,
    hp: save.hp,
    maxHp: save.max_hp,
    mp: save.mp,
    maxMp: save.max_mp,
    stats: DEFAULT_STATS,
  };
  const seq = pickSeq(id, enemyTpl, playerTpl);
  assert(seq !== null, "(a) 500 个 seq 内找不出三回合全命中的种子——引擎口径变了");
  forgeCombat(id, { ...enemyTpl, seq }, 1);

  let prev = (await fetchSaveView(id)).save;
  assert(prev.combat && prev.combat.enemy.hp === 300 && prev.combat.turn === 1, "(a) setup broken");
  for (const phrase of ["对着石像挥一拳", "出手打它", "劈它一刀"]) {
    const r = await act(id, phrase);
    assert(
      r.intent === "attack",
      `(a)「${phrase}」期望 intent=attack，实际 ${JSON.stringify(r.intent)}`
    );
    assert(
      r.save.combat && r.save.combat.enemy.hp < prev.combat.enemy.hp,
      `(a)「${phrase}」敌人 HP 未降：${prev.combat.enemy.hp} -> ${r.save.combat && r.save.combat.enemy.hp}`
    );
    assert(
      r.save.combat.turn === prev.combat.turn + 1,
      `(a)「${phrase}」回合未推进：${prev.combat.turn} -> ${r.save.combat && r.save.combat.turn}`
    );
    assert(r.save.scene === sceneBefore, `(a)「${phrase}」改了 scene`);
    prev = r.save;
  }

  // ── (b) 同一交战态「离开这里」：撤离掷逃，不推进主线 ──────────────
  const beforeFlee = prev;
  const r = await act(id, "离开这里");
  assert(
    r.intent === "flee",
    `(b)「离开这里」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`
  );
  assert(
    r.save.scene === beforeFlee.scene && r.save.chapter === beforeFlee.chapter,
    `(b)「离开这里」推进了主线：${beforeFlee.scene}(ch${beforeFlee.chapter}) -> ${r.save.scene}(ch${r.save.chapter})`
  );
  assert(
    r.save.combat === null || r.save.combat.turn === beforeFlee.combat.turn + 1,
    `(b)「离开这里」没走战斗结算（combat=${JSON.stringify(r.save.combat)}）`
  );
  console.log("[OK] (a)(b) 交战态：挥拳/出手/劈=attack 真结算，「离开这里」=撤离不推进");
}

// ── (c)(d) 非交战 + escape_locked 场景：封门拒绝 ───────────────────────
{
  const id = await makeSave("f137-locked");
  forgeSave(id, {
    chapter: 2,
    scene: PENALTY_GATE,
    boss_cleared_json: "[]",
    encounter_clock: 0,
    encounter_cd: 0,
  });
  const before = (await fetchSaveView(id)).save;
  assert(
    before.scene === PENALTY_GATE && before.chapter === 2 && before.combat === null,
    `(c) setup broken: ${before.scene} ch${before.chapter}`
  );
  const logsBefore = await logCount(id);

  for (const [tag, phrase] of [
    ["(c)", "离开这里"],
    ["(d)", "撤离副本"],
  ]) {
    const r = await act(id, phrase);
    assert(
      r.intent === "flee",
      `${tag}「${phrase}」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`
    );
    assert(r.refused === true, `${tag}「${phrase}」期望 refused=true，实际 ${JSON.stringify(r.refused)}`);
    assert(
      r.escape_locked === true,
      `${tag}「${phrase}」期望 escape_locked 标记，实际 ${JSON.stringify(r.escape_locked)}`
    );
    assert(
      r.save.scene === PENALTY_GATE && r.save.chapter === 2,
      `${tag}「${phrase}」挪了位置：${r.save.scene}(ch${r.save.chapter})`
    );
    assert(r.save.combat === null, `${tag}「${phrase}」掷出了遭遇：${JSON.stringify(r.save.combat)}`);
    const text = r.reply.content;
    assert(/无法撤离|不能撤离/.test(text), `${tag}「${phrase}」缺封门提示：${text.slice(-120)}`);
    assert(!text.includes("毒牙蛇"), `${tag}「${phrase}」回包漏了守关者名：${text.slice(-120)}`);
    assert(!text.includes("未识别"), `${tag}「${phrase}」落了未识别兜底：${text.slice(-120)}`);
    assert(
      r.save.hp === before.hp && r.save.mp === before.mp,
      `${tag}「${phrase}」扣了体力：${before.hp}/${before.mp} -> ${r.save.hp}/${r.save.mp}`
    );
  }
  const logsAfter = await logCount(id);
  // F142 契约：(c)(d) 两次封门拒绝各写 2 条日志（user 原文 + 拒绝文案），数值/位移零变化。
  assert(
    logsAfter - logsBefore === 4,
    `(c)(d) 封门拒绝应写 4 条日志（2 次 × user+system），实际 ${logsAfter - logsBefore}`
  );
  console.log("[OK] (c)(d) escape_locked：离开/撤离被封死，不挪位不掷怪不遇毒牙蛇");

  // ── (f-locked) 封门副本里「回到第1章」：同样不得落未识别、不得挪位 ──
  const r = await act(id, "回到第1章");
  assert(
    !r.reply.content.includes("未识别"),
    `(f)「回到第1章」在封门副本落了未识别：${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.scene === PENALTY_GATE && r.save.chapter === 2,
    `(f)「回到第1章」挪了位置：${r.save.scene}(ch${r.save.chapter})`
  );
  assert(r.intent === "flee", `(f)「回到第1章」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`);
  console.log("[OK] (f) 封门副本「回到第1章」→ 封门拒绝而非未识别");
}

// ── (e)(f)(g) 非交战普通场景 ──────────────────────────────────────────
{
  const id = await makeSave("f137-open");
  const before = (await fetchSaveView(id)).save;
  assert(before.scene && before.combat === null, "(e) setup broken");

  // (e)「离开这里」：零变更 + 诚实提示，不得路由 advance
  {
    const r = await act(id, "离开这里");
    assert(r.intent === "flee", `(e)「离开这里」期望 intent=flee，实际 ${JSON.stringify(r.intent)}`);
    assert(r.refused !== true, `(e)「离开这里」不该走拒绝短路（普通场景要写日志）`);
    assert(
      r.save.scene === before.scene && r.save.chapter === before.chapter,
      `(e)「离开这里」挪了位置：${before.scene} -> ${r.save.scene}`
    );
    assert(
      r.save.hp === before.hp && r.save.mp === before.mp,
      `(e)「离开这里」扣了体力：${before.hp}/${before.mp} -> ${r.save.hp}/${r.save.mp}`
    );
    assert(
      /无需撤离|没有交战/.test(r.reply.content),
      `(e)「离开这里」缺「没有交战/无需撤离」提示：${r.reply.content.slice(-120)}`
    );
    assert(r.save.combat === null, `(e)「离开这里」掷出了遭遇`);
    console.log("[OK] (e) 普通场景「离开这里」→ 零消耗「无需撤离」提示");
  }

  // (f) 普通场景「回到第1章」：不落未识别、不挪位
  {
    const r = await act(id, "回到第1章");
    assert(
      !r.reply.content.includes("未识别"),
      `(f) 普通场景「回到第1章」落了未识别：${r.reply.content.slice(-120)}`
    );
    assert(
      r.save.scene === before.scene && r.save.chapter === before.chapter,
      `(f) 普通场景「回到第1章」挪了位置：${r.save.scene}`
    );
    console.log("[OK] (f) 普通场景「回到第1章」→ 非未识别、零位移");
  }

  // (g) 乱码：回显原文 + 语境化可做之事，不再固定追问攻击/离开（F146）
  {
    const r = await act(id, "阿巴阿巴");
    assert(
      r.reply.content.includes("「阿巴阿巴」"),
      `(g) 未识别兜底必须回显玩家原文：${r.reply.content.slice(-160)}`
    );
    assert(
      !r.reply.content.includes("你是想攻击还是想离开"),
      `(g) F146 脱战兜底不得再固定追问攻击/离开：${r.reply.content.slice(-160)}`
    );
    assert(
      /观察|前进/.test(r.reply.content),
      `(g) 兜底须给出与场景相关的可做之事：${r.reply.content.slice(-160)}`
    );
    console.log("[OK] (g) 未识别兜底回显原文 + 语境化可做之事（F146）");
  }
}

ok("F137 free-input intent contract: all assertions passed");
