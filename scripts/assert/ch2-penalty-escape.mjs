#!/usr/bin/env node
// F128 惩罚副本死循环断言（全是行为断言）：
//
//   线上实测：Lv.4 玩家在 ch2 惩罚副本死亡 → 回溯 ch2_daily_quest →
//   「前进」唯一出口 ch2_penalty_gate → 落地守关房强制毒牙蛇战。
//   交战中「前进」= 掷逃，掷逃对守关者零伤害——纯「前进」玩家要么
//   被 18/回合反击打死再回溯，要么掷逃成功撤回门口后撞进守关房
//   再入冷却 → 房内「前进」被门禁永久 refused（零位移零消耗软锁）。
//   50+ 次循环无一脱出。
//
//   复跑教训（本断言第一版是假绿）：摆脱守关者落回 ch2_daily_quest
//   当步判「脱出」即收——但下一按「前进」又把人送回 ch2_penalty_gate，
//   第二轮掷逃失败继续在副本里掉血等死。「脱出」必须粘住才算数。
//
//   断言：
//     a) DB 直写构造「死亡回溯落点」存档（chapter=2, scene=ch2_daily_quest,
//        Lv.4, HP=上限一半、deaths=3——与 settleDeath 回溯落点同口径）；
//     b) 原 12 次「前进」窗口保留：窗口内至少一次真正离开惩罚副本——
//        chapter 越过第 2 章（过门）或守关者已被击败/摆脱
//        （boss_cleared 含 "ch2" 且人已退出副本场景、无交战）——
//        死亡回溯回 ch2_daily_quest 不算脱出（那是循环本身的一环）；
//     c) 脱出后不回吞：首次判定脱出后继续按「前进」≥6 次——scene 不得
//        再进入 {ch2_penalty_gate, ch2_poison_fang}，交战不得再出现
//        「毒牙蛇/沙地毒蛇」（惩罚副本怪池）；
//     d) 终局：结束时 chapter > 2，或站在 ch2 主线上的非惩罚场景
//        （ch2_daily_quest）且无交战——「人还在惩罚副本里但
//        boss_cleared 有 ch2」不算通过；
//     e) 全程没有「零进展停留」：scene + HP + 回包正文三者全不变
//        = 软锁（门禁 refused 的计数轮换文案不构成进展）。
//
//   旧码红证：12 次全部留在 惩罚副本→毒牙蛇 环内（死亡回溯/撤离撤回
//   门口/房内门禁 refused），(b) FAIL；上一版实现（摆脱落回链首但
//   链未摘）在第 4 步重回 ch2_penalty_gate，(c) FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const PENALTY_GATE = "ch2_penalty_gate"; // 惩罚副本门口（dungeon）
const PENALTY_BOSS = "ch2_poison_fang"; // 惩罚副本守关房（毒牙蛇，链尾）
const REWIND = "ch2_daily_quest"; // 死亡回溯落点（本章主线链首）
const PENALTY_SCENES = new Set([PENALTY_GATE, PENALTY_BOSS]);
const PENALTY_MOBS = ["毒牙蛇", "沙地毒蛇"]; // 惩罚副本怪池（守关者 + 杂兵）
const ESCAPE_WINDOW = 12; // (b) 脱出判定窗口：原 12 次循环保留
const POST_ESCAPE = 6; // (c) 脱出后不回吞的最少续按次数

const id = await makeSave("f128-escape");

// 回溯落点存档：数值与 Lv.4 未加点玩家一致（DEFAULT_STATS：力10 攻16，
// max_hp = 80 + 4×4 + 10×8 = 176，回溯后 HP=88 与 settleDeath 同口径）。
db.prepare(
  `UPDATE saves SET chapter = 2, scene = ?, level = 4, rank = 'E', xp = 30,
     hp = 88, max_hp = 176, mp = 34, max_mp = 68, deaths = 3, free_points = 9,
     boss_cleared_json = '[]', boss_hp_json = '{}',
     encounter_clock = 0, encounter_cd = 0, encounter_seq = 0,
     rest_used = 0, advance_streak = 0, stealth_charges = 0
   WHERE id = ?`
).run(REWIND, id);
db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);

const before = (await fetchSaveView(id)).save;
assert(
  before.scene === REWIND && before.chapter === 2 && !before.combat,
  `setup broken: scene=${before.scene} ch=${before.chapter} combat=${JSON.stringify(before.combat)}`
);
console.log(`[setup] 死亡回溯落点 ${REWIND} · Lv.${before.level} HP ${before.hp}/${before.max_hp} deaths=${before.deaths}`);

const tag = (s) =>
  `scene=${s.scene} ch=${s.chapter} hp=${s.hp}/${s.max_hp} ` +
  `combat=${s.combat && s.combat.enemy ? `${s.combat.enemy.name} Lv.${s.combat.enemy.level} ${s.combat.enemy.hp}/${s.combat.enemy.max_hp}` : "无"}`;

let escapedAt = 0; // 首次脱出发生在第几步（0 = 窗口内未脱出）
let postEscape = 0; // 脱出后已续按次数
let prev = null;
let last = null;
for (let i = 1; i <= ESCAPE_WINDOW + POST_ESCAPE; i++) {
  if (escapedAt > 0 && postEscape >= POST_ESCAPE) break;
  if (escapedAt === 0 && i > ESCAPE_WINDOW) break;
  const r = await act(id, "前进");
  const s = r.save;
  const reply = (r.reply && r.reply.content) || "";
  console.log(
    `  前进#${i} → ${tag(s)}${r.refused === true ? " refused" : ""} | ${reply.slice(0, 60).replace(/\n/g, " ")}`
  );
  // (e) 零进展停留：scene+HP+回包正文三者全不变 = 软锁，一次都嫌多。
  assert(
    !(prev && s.scene === prev.scene && s.hp === prev.hp && reply === prev.reply),
    `(e) 前进#${i} 零进展停留：${tag(s)} — 场景/HP/正文与上一步全同，惩罚副本软锁未解`
  );
  const cleared = Array.isArray(s.boss_cleared) && s.boss_cleared.includes("ch2");
  if (escapedAt === 0) {
    if (
      s.chapter !== 2 ||
      (!PENALTY_SCENES.has(s.scene) && !s.combat && cleared)
    ) {
      escapedAt = i;
      console.log(`  → 脱出惩罚副本（第 ${i} 步）：${tag(s)} · boss_cleared=${JSON.stringify(s.boss_cleared)}`);
    }
  } else {
    postEscape++;
    // (c) 脱出必须粘住：scene 不得再被封门副本吞回，
    //     惩罚副本怪池（毒牙蛇/沙地毒蛇）不得再现于交战。
    assert(
      !PENALTY_SCENES.has(s.scene),
      `(c) 前进#${i} 脱出后被吞回惩罚副本：scene=${s.scene} — 摆脱守关者没有真的放人`
    );
    const e = s.combat && s.combat.enemy;
    assert(
      !(e && PENALTY_MOBS.some((n) => String(e.name).includes(n))),
      `(c) 前进#${i} 脱出后再遇惩罚副本战斗：${e && e.name} Lv.${e && e.level} — 惩罚副本怪池仍在追人`
    );
  }
  prev = { scene: s.scene, hp: s.hp, reply };
  last = s;
}

// (b) 12 次窗口内必须至少一次真正脱出惩罚副本环——到过别的章，
//     或守关者已被击败/摆脱且人退出副本（死亡回溯回入口不算脱出）。
assert(
  escapedAt > 0,
  `(b) 连打 ${ESCAPE_WINDOW} 次「前进」仍困在惩罚副本→毒牙蛇环内：scene 始终未离开 ` +
    `${REWIND}↔${PENALTY_GATE}↔${PENALTY_BOSS} 循环，守关者未击败/未摆脱（boss_cleared 无 ch2）`
);

// (c) 脱出后必须已按足 POST_ESCAPE 次（上面 break 口径保证，此处钉死）。
assert(
  postEscape >= POST_ESCAPE,
  `(c) 脱出后续按不足：escapedAt=${escapedAt} postEscape=${postEscape} < ${POST_ESCAPE}`
);

// (d) 终局：chapter 越过第 2 章，或站在 ch2 主线非惩罚场景（ch2_daily_quest）
//     且无交战——「人还在惩罚副本里但 boss_cleared 有 ch2」不算通过。
const fin = last;
const onCh2MainlineSafe =
  fin.chapter === 2 && fin.scene === REWIND && !fin.combat;
assert(
  fin.chapter > 2 || onCh2MainlineSafe,
  `(d) 终局不合格：chapter=${fin.chapter} scene=${fin.scene} ` +
    `combat=${JSON.stringify(fin.combat && fin.combat.enemy && fin.combat.enemy.name)} ` +
    `— 「人在副本里但 boss_cleared 有 ch2」不算脱出`
);
console.log(
  `[final] ${tag(fin)} · boss_cleared=${JSON.stringify(fin.boss_cleared)} · 脱出@${escapedAt} +${postEscape} 步未回吞`
);

ok(`F128 PASS penalty escape sticky: 第 ${escapedAt} 步脱出，后续 ${postEscape} 按未回吞惩罚副本，终局 ${tag(fin)}`);
