#!/usr/bin/env node
// F134 验收：死亡回溯必须返还本章休息配额（rest_used 归零，与跨章重置
// 同一语义）。旧口径回溯不清配额——惩罚副本里 3 次休息烧完后再死一次
// 落回入口仍是 0/3，血回不上、怪照刷，永久死局。
//   A) 配额返还：DB 构造 rest_used=3、hp=1 的存档 → 真实「前进」力竭
//      触发回溯 → 视图 rest.remaining===3 且 available===true、DB
//      rest_used===0、deaths +1（回溯本身未被破坏）；
//   B) 幂等不叠加：同一存档再死一次，remaining 仍是 3（不会累加成 4/6）；
//   C) 死局出口：从回溯落点按真实路径连跑最多 40 步（休息 → 环顾四周/
//      潜行/探索前进 轮换，守关房轮换加排「攻击」叫阵，交战中真打），
//      断言 40 步内至少出现一次「XP 增长 / 场景变更 / 进入交战」；
//      连续 12 步指纹不变且本步无真实可走动作（无攻击出路、无配额、
//      无可推进）才算死局——守关房门拒+MP 不足的潜行拒绝是假死局，
//      房内主按钮已换标「叫阵守关者」，攻击开战是真实出路。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 与服务端 chapterPath 同口径推导 ch1 主线链（同 death-progress-keep）。
const ch1 = raw.chapters.find((c) => c.index === 1);
const byId = new Map(ch1.scenes.map((s) => [s.id, s]));
const PATH = [];
{
  const seen = new Set();
  let cur = ch1.scenes[0];
  while (cur && !seen.has(cur.id)) {
    PATH.push(cur.id);
    seen.add(cur.id);
    let nxt =
      cur.next_scene && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => c.next && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
}

function dbRow(id) {
  return db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
}

// ── 起步清场：与 scripts/report.sh clean_test_saves 同口径，先删干净
// e2e-*/verify-* 残留与本脚本历次跑挂留下的 assert-f134-* 存档及子表
// ——脏库（live data/game.db）上的跨脚本污染曾让断言拿到与预期对不上
// 的存档视图。若打开的库里根本没有 saves 表，说明脚本 DB 与 HTTP 侧
// 不是同一个库（DB_PATH / API_BASE 口径错了），直接点名而不是放它
// 静默 UPDATE 0 行后拿全新档视图报错。
assert(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='saves'").get(),
  `DB ${dbPath} 无 saves 表——脚本库与 HTTP 侧存档不一致（检查 DB_PATH / API_BASE）`
);
const staleIds = db
  .prepare(
    "SELECT id FROM saves WHERE player_name LIKE 'e2e-%' " +
      "OR player_name LIKE 'verify-%' OR player_name LIKE 'assert-f134-%'"
  )
  .all()
  .map((r) => r.id);
if (staleIds.length) {
  const ph = staleIds.map(() => "?").join(",");
  for (const t of ["combat", "quest_daily", "shadows", "log", "inventory"]) {
    db.prepare(`DELETE FROM ${t} WHERE save_id IN (${ph})`).run(...staleIds);
  }
  db.prepare(`DELETE FROM saves WHERE id IN (${ph})`).run(...staleIds);
}

// 指纹口径与 _http.mjs saveSig 同思路：scene/chapter/hp/mp/level/rest_used/
// encounter_cd/combat.seq 拼接——连续不变 = 驱动在空转、出口断供。
function sig(s) {
  const c = (s && s.combat) || {};
  return [
    s.scene, s.chapter, s.hp, s.mp, s.level, s.rest_used,
    s.encounter_cd, c.seq, c.turn,
  ].join("|");
}

// ── A) 配额返还：rest_used=3 的死档回溯后回到 3/3 ─────────────────────
// 站位 PATH[5]、hp=1：一推力竭。deaths=1 规避首死觉醒/保底 XP 干扰。
const idA = await makeSave("f134-refund");
const wroteA = db
  .prepare(
    "UPDATE saves SET chapter = 1, scene = ?, hp = 1, xp = 0, deaths = 1, rest_used = 3 WHERE id = ?"
  )
  .run(PATH[5], idA).changes;
assert(
  wroteA === 1,
  `A: UPDATE matched ${wroteA} rows for save ${idA} — 脚本库与 HTTP 侧不是同一个库` +
    `（DB ${dbPath}），DB_PATH / API_BASE 口径不一致`
);

const preA = await fetchSaveView(idA);
assert(
  preA.save.rest && preA.save.rest.remaining === 0 && preA.save.rest.available === false,
  `A pre-death: expected rest 0/3 unavailable, got ${JSON.stringify(preA.save.rest)}`
);
const deathsBeforeA = preA.save.deaths;

const dieA = await act(idA, "前进");
const repA = dieA.reply.content;
assert(repA.includes("倒下"), `A: missing 倒下 broadcast: ${repA.slice(-300)}`);
assert(repA.includes("回溯"), `A: missing 回溯 broadcast: ${repA.slice(-300)}`);
assert(
  dieA.save.deaths === deathsBeforeA + 1,
  `A: deaths should be ${deathsBeforeA + 1}, got ${dieA.save.deaths}`
);
assert(
  dieA.save.rest && dieA.save.rest.remaining === 3 && dieA.save.rest.available === true,
  `A: rest should be refunded to 3/3 available, got ${JSON.stringify(dieA.save.rest)}`
);
const rowA = dbRow(idA);
assert(rowA.rest_used === 0, `A: DB rest_used should be 0, got ${rowA.rest_used}`);

// ── B) 幂等：再死一次仍回 3/3，不累加 ────────────────────────────────
// 回溯落点是链首（章首零消耗推不死人），重新锚回 PATH[1] + hp=1 再力竭；
// rest_used 先烧回 3，模拟「配额又用完」的最坏面。
db.prepare(
  "UPDATE saves SET hp = 1, scene = ?, rest_used = 3 WHERE id = ?"
).run(PATH[1], idA);
const deathsBeforeB = (await fetchSaveView(idA)).save.deaths;
const dieB = await act(idA, "前进");
assert(
  dieB.save.deaths === deathsBeforeB + 1,
  `B: deaths should be ${deathsBeforeB + 1}, got ${dieB.save.deaths}`
);
assert(
  dieB.save.rest && dieB.save.rest.remaining === 3 && dieB.save.rest.available === true,
  `B: second death should still refund to 3/3 (idempotent), got ${JSON.stringify(dieB.save.rest)}`
);
const rowB = dbRow(idA);
assert(rowB.rest_used === 0, `B: DB rest_used should be 0, got ${rowB.rest_used}`);

// ── C) 死局出口：回溯落点起 40 步真实路径，不得断供 ───────────────────
// 动作轮换：休息（有配额/有收益才点）→ 环顾四周 → 潜行 → 探索前进；
// 交战中真打（杀出 XP，被打死则再次回溯——配额再次返还，循环仍可数）。
// 守关房（服务端 advance_mode=challenge_boss/retreat_to_boss，即守关者
// 未倒下）里唯一出路是「攻击/叫阵」开战——轮换把攻击排进去；缺了它，
// 门拒 + MP 不足的潜行拒绝会把活路刷成 12 连零 patch 假死局。
const ROTATE = ["环顾四周", "潜行", "探索前进"];
const ROTATE_BOSS = ["环顾四周", "攻击", "潜行", "探索前进"];

// 本步是否存在真实可走动作：交战中（攻击/技能/逃跑都是真步）、休息
// 配额可用、叫阵房（攻击开战）、其余 advance_mode 下「前进」是真步。
// advance_mode 缺省（拿不到的边缘态）保守视为无路。
function hasRealExit(s) {
  if (s.combat) return true;
  if (s.rest && s.rest.available === true) return true;
  const m = s.advance_mode;
  return (
    m === "challenge_boss" ||
    m === "retreat_to_boss" ||
    m === "next_chapter" ||
    m === "advance"
  );
}

// 失败取证：留最后 6 步的 input + refused + 正文前 60 字。
const trail = [];
const dumpTrail = () =>
  trail
    .map((t) => `#${t.i} 「${t.input}」 refused=${t.refused} | ${t.head}`)
    .join("\n    ");

const startView = await fetchSaveView(idA);
const scene0 = startView.save.scene;
const chap0 = startView.save.chapter;
let xp0 = Number(startView.save.xp) || 0;
let xpGrew = false;
let sceneMoved = false;
let sawCombat = false;
let prevSig = null;
let stale = 0;
let steps = 0;
for (let i = 0; i < 40; i++) {
  const { save: s } = await fetchSaveView(idA);
  const cur = sig(s);
  const unchanged = prevSig !== null && cur === prevSig;
  prevSig = cur;
  // 零 patch 只在「本步无真实可走动作」时向死局计数：有攻击出路/配额/
  // 真推进时原地踏步是驱动选错输入（被拒/纯叙述），不是出口断供——
  // 计数器不清零也不累加，靠 40 步进度口径兜底。
  stale = unchanged ? (hasRealExit(s) ? stale : stale + 1) : 0;
  if ((Number(s.xp) || 0) > xp0) xpGrew = true;
  if (s.combat) sawCombat = true;
  if (s.scene !== scene0 || s.chapter !== chap0) sceneMoved = true;
  assert(
    stale < 12,
    `C: save fingerprint unchanged across ${stale + 1} consecutive no-exit actions ` +
      `(scene=${s.scene} mode=${s.advance_mode} hp=${s.hp}/${s.max_hp} ` +
      `rest=${JSON.stringify(s.rest)}) — dead-end stall\n    last steps:\n    ${dumpTrail()}`
  );
  let input;
  if (s.combat) {
    const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
    input = castable ? `释放技能 ${castable.name}` : "攻击";
  } else if (
    s.rest && s.rest.available === true &&
    (s.hp < s.max_hp || s.mp < s.max_mp)
  ) {
    input = "休息";
  } else {
    const rot = s.advance_mode === "challenge_boss" ? ROTATE_BOSS : ROTATE;
    input = rot[steps % rot.length];
  }
  const r = await act(idA, input);
  trail.push({
    i,
    input,
    refused: r.refused === true,
    head: String((r.reply && r.reply.content) || "").slice(0, 60),
  });
  if (trail.length > 6) trail.shift();
  steps++;
}
const endView = await fetchSaveView(idA);
const xpEnd = Number(endView.save.xp) || 0;
if (xpEnd > xp0) xpGrew = true;
if (endView.save.combat) sawCombat = true;
if (endView.save.scene !== scene0 || endView.save.chapter !== chap0) sceneMoved = true;
// 40 步内必须至少出现一次真实推进：XP 增长 / 场景变更 / 进入交战。
// 三者全无 = 回溯后经验来源仍断供（死局未解开），FAIL。
assert(
  xpGrew || sceneMoved || sawCombat,
  `C: 40 steps after rewind — no XP growth (${xp0} -> ${xpEnd}), no scene ` +
    `change, never entered combat; rest refund did not reopen the dead end` +
    `\n    last steps:\n    ${dumpTrail()}`
);

db.prepare("DELETE FROM saves WHERE id = ?").run(idA);
ok("F134 PASS death rewind refunds rest quota (A refund / B idempotent / C dead-end exit)");
