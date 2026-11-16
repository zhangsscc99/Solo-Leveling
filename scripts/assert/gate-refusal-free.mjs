#!/usr/bin/env node
// F106 门拒绝零消耗校验（全是行为断言）：线上实测 ch1 守关者「石像守卫」
// 未击杀时在房内点「前进」，回包无位移无推进却照扣 3 HP / 2 MP 并写了
// 「体力消耗」记账——连点可以原地耗死。本脚本钉住修复后的完整契约：
//
//   (a) 守关者门（boss 房 / 章尾）：守关者未击杀 + 站在 boss 房（ch1 链中、
//       ch2 链尾两形态），连续 POST /action 前进 6 次 → 每次 refused===true、
//       hp/mp/scene/chapter_progress 完全不变、响应正文不得出现「体力消耗」、
//       /log 条数零增长。正向：next_choices 非空、advance_mode ===
//       "retreat_to_boss"，房内「攻击」叫阵能把守关者逼回战场（拒绝不是
//       死路）。章尾（idx > boss）玩家另有出路：advance_mode 同样下发
//       retreat_to_boss，「前进」折返回守关房落地真打——这一支是真实位移
//       （照付体力），不能也改成 refused，否则章尾玩家没有任何后退动作、
//       永久卡死（历史缺陷）。
//   (b) 章节等级门：unlockedFor 自 F093 起是 OR 软门（等级 OR 上一章通关，
//       chapters.js 注释明示留待 F093 收尾补回 AND 硬门）——save.chapter
//       永远等于 unlock.chapter，chapter 条件恒真，「!gate.ok → refused」
//       是数据上不可达的死分支，无法落点构造。本段钉住现行软门口径：
//       等级未达 + 守关者已清 + 站在章尾 → 「前进」按等级门抑制的
//       「等级未达」播报跨章（不是拒绝），saveView.chapter_unlock.level_ok
//       === false 驱动前端弹窗。同族「等级/MP 不足」拒绝另行用可达路径
//       钉住：未学技能（等级不足）、MP 不足释放技能 → refused 零消耗。
//   (c) 终章门：scene 落在 ch8_epilogue（结局后）连点「前进」6 次 → 每次
//       refused===true + ending_ready，全部零变化。正向：cleared 存档
//       的出路是结局结算（GET /saves/:id/ending 200）。
//
//   拒绝的完整定义：refused===true 且 hp/mp/scene/chapter/chapter_progress
//   /encounter_clock 全不変、响应与 /log 均无新增——判定在扣费之前。
//
//   变异敏感性：boss 房「前进」退位扣费旧口径 → (a) 的 refused/零消耗/
//   日志零增长必 FAIL；refused 分支若带非空 patch（applyOutcome 照跑，
//   服务端故意留的后门）→ hp/mp/scene/clock 断言必 FAIL；advanceMode
//   改回 idx>idxBoss → (a) 的房内 retreat_to_boss 断言必 FAIL（前端主
//   按钮退回「探索前进」）；章尾 retreat 也改 refused → (a3) 的
//   「真实位移+落地战」断言必 FAIL（同时玩家被永久卡死）；epilogue 短
//   路丢 refused → (c) 必 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, fetchSaveView, get } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath = process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// ── 独立 oracle：主线链与 boss 名只从数据文件推导，不调被测引擎 ──
// （与 chapter-boss-gate.mjs 同取径：next_scene，缺失时取首个指向
// 本章内未到访场景的 choices[].next）
function deriveMainPath(chapter) {
  const byId = new Map(chapter.scenes.map((s) => [s.id, s]));
  const out = [];
  const seen = new Set();
  let cur = chapter.scenes[0];
  while (cur && !seen.has(cur.id)) {
    out.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? cur.next_scene
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (c) => typeof c.next === "string" && byId.has(c.next) && !seen.has(c.next)
      );
      nxt = pick ? pick.next : null;
    }
    cur = nxt ? byId.get(nxt) : null;
  }
  return out;
}

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const ch2 = CHAPTERS.chapters.find((c) => c.index === 2);
const CH1_PATH = deriveMainPath(ch1);
const CH2_PATH = deriveMainPath(ch2);
const CH1_BOSS = ch1.scenes.find((s) => s.kind === "boss");
const CH2_BOSS = ch2.scenes.find((s) => s.kind === "boss");
const CH1_BOSS_IDX = CH1_PATH.indexOf(CH1_BOSS.id);
const CH2_BOSS_IDX = CH2_PATH.indexOf(CH2_BOSS.id);
const CH1_TAIL = CH1_PATH[CH1_PATH.length - 1];
const EPILOGUE_SCENE_ID = "ch8_epilogue";

assert(
  CH1_BOSS_IDX > 0 && CH1_BOSS_IDX < CH1_PATH.length - 1,
  `oracle broken: ch1 boss idx ${CH1_BOSS_IDX} should sit mid-chain in ${CH1_PATH.join(",")}`
);
assert(
  CH2_BOSS_IDX === CH2_PATH.length - 1,
  `oracle broken: ch2 boss idx ${CH2_BOSS_IDX} should be the chain tail in ${CH2_PATH.join(",")}`
);
assert(
  CHAPTERS.chapters.find((c) => c.index === 8).scenes.some((s) => s.id === EPILOGUE_SCENE_ID),
  `oracle broken: ${EPILOGUE_SCENE_ID} missing from ch8`
);

// 落点锻造：只改本脚本自造存档的 saves/combat 行（同 chapter-boss-gate (f) 的取径）。
function forge(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

async function logCount(id) {
  const r = await get(`/saves/${id}/log?limit=200`);
  assert(r.status === 200 && Array.isArray(r.body.log), `log fetch failed (HTTP ${r.status})`);
  return r.body.log.length;
}

async function snapshot(id) {
  const { save: s } = await fetchSaveView(id);
  return {
    hp: s.hp,
    mp: s.mp,
    scene: s.scene,
    chapter: s.chapter,
    chapter_progress: s.chapter_progress,
    encounter_clock: s.encounter_clock,
    next_choices: s.next_choices,
    advance_mode: s.advance_mode,
    combat: s.combat,
    logLen: await logCount(id),
  };
}

// 门拒绝契约：连续 n 次「前进」每次都必须 refused===true 且零变化。
// perPress 可挂各段特有的逐次断言（如终章的 ending_ready）。
async function assertFreeRefusal(id, before, tag, { presses = 6, perPress = null } = {}) {
  let prev = before;
  for (let i = 0; i < presses; i++) {
    const r = await act(id, "前进");
    assert(
      r.refused === true,
      `${tag} push#${i + 1} must be refused, got ${JSON.stringify(r.refused)} :: ${r.reply.content.slice(-160)}`
    );
    assert(
      r.save.hp === prev.hp && r.save.mp === prev.mp,
      `${tag} push#${i + 1} deducted vitals: ${prev.hp}/${prev.mp} -> ${r.save.hp}/${r.save.mp}`
    );
    assert(
      r.save.scene === prev.scene && r.save.chapter === prev.chapter,
      `${tag} push#${i + 1} moved the save: ${prev.scene}(ch${prev.chapter}) -> ${r.save.scene}(ch${r.save.chapter})`
    );
    assert(
      r.save.chapter_progress === prev.chapter_progress,
      `${tag} push#${i + 1} changed chapter_progress: ${prev.chapter_progress} -> ${r.save.chapter_progress}`
    );
    assert(
      r.save.encounter_clock === prev.encounter_clock,
      `${tag} push#${i + 1} mutated encounter_clock: ${prev.encounter_clock} -> ${r.save.encounter_clock}`
    );
    assert(
      !r.reply.content.includes("体力消耗"),
      `${tag} push#${i + 1} logged a vitals cost: ${r.reply.content.slice(-200)}`
    );
    assert(
      r.save.combat === null,
      `${tag} push#${i + 1} spawned combat despite refusal: ${JSON.stringify(r.save.combat)}`
    );
    if (perPress) perPress(r, i);
    prev = r.save;
  }
  const after = await logCount(id);
  assert(
    after === before.logLen,
    `${tag} wrote ${after - before.logLen} log entries across ${presses} refused pushes`
  );
  return prev;
}

// ── (a1) 守关者门：ch1 boss 房（链中），守关者未击杀 ─────────────────
{
  const id = await makeSave("f106-guardian-inroom");
  forge(id, {
    scene: CH1_BOSS.id,
    boss_cleared_json: "[]",
    encounter_clock: -1,
    encounter_cd: 0,
  });
  const before = await snapshot(id);
  assert(
    before.scene === CH1_BOSS.id && before.chapter === 1 && before.combat === null,
    `(a1) setup broken: ${before.scene} ch${before.chapter} combat=${JSON.stringify(before.combat)}`
  );
  // 正向：被门挡住的玩家有出路——服务端下发折返语义 + 房内仍留抉择。
  assert(
    before.advance_mode === "retreat_to_boss",
    `(a1) advance_mode must be retreat_to_boss while sealed in-room, got ${before.advance_mode}`
  );
  assert(
    Array.isArray(before.next_choices) && before.next_choices.length > 0,
    `(a1) sealed save must still expose choices: ${JSON.stringify(before.next_choices)}`
  );
  const after = await assertFreeRefusal(id, before, "(a1) ch1 in-room");
  // 正向出路：房内「攻击」= 主动叫阵，守关者被逼回战场（逃生阀不没收
  // 「想打」的权利）——拒绝不是死路。
  const fight = await act(id, "攻击");
  assert(
    fight.save.combat && fight.save.combat.enemy && fight.save.combat.enemy.boss === true,
    `(a1) in-room challenge must spawn the guardian: ${JSON.stringify(fight.save.combat)}`
  );
  assert(
    fight.save.combat.enemy.name === CH1_BOSS.title,
    `(a1) challenged enemy should be「${CH1_BOSS.title}」, got ${fight.save.combat.enemy.name}`
  );
  assert(
    fight.save.scene === after.scene,
    `(a1) challenge must stay in-room: ${after.scene} -> ${fight.save.scene}`
  );
  console.log(`    (a1) ch1 boss room sealed: 6x refused, free, exit via 攻击`);
}

// ── (a2) 守关者门：ch2 boss 房（链尾形态），守关者未击杀 ─────────────
{
  const id = await makeSave("f106-guardian-tailroom");
  forge(id, {
    chapter: 2,
    scene: CH2_BOSS.id,
    boss_cleared_json: "[]",
    encounter_clock: -1,
    encounter_cd: 0,
  });
  const before = await snapshot(id);
  assert(
    before.scene === CH2_BOSS.id && before.chapter === 2 && before.combat === null,
    `(a2) setup broken: ${before.scene} ch${before.chapter}`
  );
  assert(
    before.advance_mode === "retreat_to_boss",
    `(a2) advance_mode must be retreat_to_boss, got ${before.advance_mode}`
  );
  await assertFreeRefusal(id, before, "(a2) ch2 tail-room");
  console.log(`    (a2) ch2 tail boss room sealed: 6x refused, free`);
}

// ── (a3) 守关者门：ch1 章尾（idx > boss），守关者未击杀 ──────────────
// 收尾口径下该状态仅存于线上旧档（save 550），DB 落点复刻：「前进」不
// 是拒绝而是折返位移——玩家没有任何后退动作，若也改 refused 即永久卡死。
{
  const id = await makeSave("f106-guardian-pastboss");
  forge(id, {
    scene: CH1_TAIL,
    boss_cleared_json: "[]",
    encounter_clock: 0,
    encounter_cd: 0,
  });
  const before = await snapshot(id);
  assert(
    before.scene === CH1_TAIL && before.chapter === 1 && before.combat === null,
    `(a3) setup broken: ${before.scene} ch${before.chapter}`
  );
  assert(
    before.advance_mode === "retreat_to_boss",
    `(a3) advance_mode must be retreat_to_boss past the boss, got ${before.advance_mode}`
  );
  const r = await act(id, "前进");
  assert(
    r.refused !== true,
    `(a3) tail push is a real retreat, not a refusal: refused=${JSON.stringify(r.refused)}`
  );
  assert(
    r.save.scene === CH1_BOSS.id,
    `(a3) tail push must retreat into the boss room ${CH1_BOSS.id}, got ${r.save.scene}`
  );
  assert(
    r.save.combat && r.save.combat.enemy && r.save.combat.enemy.name === CH1_BOSS.title,
    `(a3) retreat must re-engage「${CH1_BOSS.title}」, got ${JSON.stringify(r.save.combat)}`
  );
  console.log(`    (a3) ch1 tail past boss: retreat lands in boss fight (real move, kept)`);
}

// ── (b) 章节等级门 + 「等级/MP 不足」拒绝族 ──────────────────────────
// F093 软门口径：等级条件不满足时依旧放行跨章，只是播报降级为「等级未达」
// 并驱动前端升级提醒——不是 refused（AND 硬门留待 F093 收尾，改回硬门
// 时本章门自然走 !gate.ok → refused 零消耗分支，本段届时按新口径重写）。
{
  const id = await makeSave("f106-level-gate");
  // encounter_cd 抬高：跨章落点不掷小怪，保证本段后序断言确定性。
  forge(id, {
    scene: CH1_TAIL,
    level: 1,
    boss_cleared_json: JSON.stringify(["ch1"]),
    encounter_clock: 0,
    encounter_cd: 5,
  });
  const before = await snapshot(id);
  assert(
    before.chapter === 1 && before.scene === CH1_TAIL && before.combat === null,
    `(b1) setup broken: ${before.scene} ch${before.chapter}`
  );
  const r = await act(id, "前进");
  assert(
    r.refused !== true,
    `(b1) soft level gate must traverse (not refuse): refused=${JSON.stringify(r.refused)}`
  );
  assert(r.save.chapter === 2, `(b1) soft-gated push should open ch2, got ch${r.save.chapter}`);
  assert(
    r.save.scene === CH2_PATH[0],
    `(b1) soft gate should land on ch2 chain head ${CH2_PATH[0]}, got ${r.save.scene}`
  );
  assert(
    r.reply.content.includes("等级未达"),
    `(b1) suppressed gate must announce「等级未达」: ${r.reply.content.slice(-200)}`
  );
  assert(
    r.save.chapter_unlock && r.save.chapter_unlock.level === 5 && r.save.chapter_unlock.level_ok === false,
    `(b1) ch2 unlock must flag level_ok=false (need Lv.5): ${JSON.stringify(r.save.chapter_unlock)}`
  );
  console.log(`    (b1) level-soft-gate: traverse with「等级未达」suppression (F093 semantics; hard gate unreachable)`);

  // 「等级不足」拒绝：未学技能——技能面板等级门（与章节门同一族门禁）。
  const lenBeforeSkills = await logCount(id);
  const g1 = await act(id, "释放技能 统治者之权能");
  assert(
    g1.refused === true && g1.reply.content.includes("等级不足"),
    `(b2) unlearned skill must be refused for level: ${JSON.stringify(g1.refused)} :: ${g1.reply.content.slice(-160)}`
  );
  assert(
    g1.save.hp === r.save.hp && g1.save.mp === r.save.mp && g1.save.scene === r.save.scene,
    `(b2) level-gated skill must be free: ${r.save.hp}/${r.save.mp}/${r.save.scene} -> ${g1.save.hp}/${g1.save.mp}/${g1.save.scene}`
  );
  // 「MP 不足」拒绝：已学技能但 mp 不够。
  db.prepare("UPDATE saves SET mp = 0 WHERE id = ?").run(id);
  const s0 = (await fetchSaveView(id)).save;
  const g2 = await act(id, "释放技能 猛虎猛击");
  assert(
    g2.refused === true && g2.reply.content.includes("MP 不足"),
    `(b3) unaffordable skill must be refused for MP: ${JSON.stringify(g2.refused)} :: ${g2.reply.content.slice(-160)}`
  );
  assert(
    g2.save.mp === s0.mp && g2.save.hp === s0.hp && g2.save.scene === s0.scene,
    `(b3) MP-gated skill must be free: ${s0.hp}/${s0.mp} -> ${g2.save.hp}/${g2.save.mp}`
  );
  const lenAfterSkills = await logCount(id);
  assert(
    lenAfterSkills === lenBeforeSkills,
    `(b2/b3) refused intents must not write logs: ${lenBeforeSkills} -> ${lenAfterSkills}`
  );
  console.log(`    (b2/b3) level/MP gated skills refused, zero-cost, no logs`);
}

// ── (c) 终章门：结局后的「前进」一律零消耗拒回 ──────────────────────
{
  const id = await makeSave("f106-epilogue");
  forge(id, {
    chapter: 8,
    scene: EPILOGUE_SCENE_ID,
    encounter_clock: 0,
    encounter_cd: 0,
  });
  const before = await snapshot(id);
  assert(
    before.scene === EPILOGUE_SCENE_ID && before.chapter === 8 && before.combat === null,
    `(c) setup broken: ${before.scene} ch${before.chapter}`
  );
  const after = await assertFreeRefusal(id, before, "(c) epilogue", {
    perPress: (r, i) =>
      assert(
        r.ending_ready === true,
        `(c) push#${i + 1} must flag ending_ready: ${JSON.stringify(r.ending_ready)}`
      ),
  });
  assert(after.scene === EPILOGUE_SCENE_ID, `(c) epilogue push moved the save: ${after.scene}`);
  // 正向：结局存档的出路是结算页——at_epilogue 随存档下发，GET ending 可达。
  const { save: s2 } = await fetchSaveView(id);
  assert(
    s2.at_epilogue === true && s2.cleared === true,
    `(c) epilogue save must flag at_epilogue/cleared`
  );
  const ending = await get(`/saves/${id}/ending`);
  assert(
    ending.status === 200 && ending.body && ending.body.ending,
    `(c) cleared save must expose its ending screen: HTTP ${ending.status}`
  );
  console.log(`    (c) epilogue gate: 6x refused + ending_ready, exit via /ending`);
}

db.close();
ok("OK");
