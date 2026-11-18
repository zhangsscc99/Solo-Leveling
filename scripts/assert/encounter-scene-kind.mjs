#!/usr/bin/env node
// F115 遭遇按场景分区契约：「这个场景刷不刷怪」是 chapters.json 场景对象
// 上的数据事实（encounters 字段），代码只读字段判定——现实世界/收束场景
// （医院、协会、归途运输等）标 "none" 永不掷怪；字段缺失/"dungeon" 维持
// 旧行为（地下城默认掷怪），漏标不得让全场不出怪。
//
//   (a) 数据层：读服务端同款 server/data/chapters.json（chapters.js 的
//       DATA_PATH，运行实例加载的就是这份文件——HTTP 不下发场景级字段，
//       /chapters 只出章节级信息，文件+引擎契约即数据层真源）：
//       - none 集合必须等于显式快照 EXPECTED_NONE（现实世界/收束场景
//         完整清单）——漏标、多标双向现形，diff 直接列在报错里；
//       - 全量场景 × encounter.roll（保底触顶时钟）：标 "none" 的必返回
//         null，未标的必返回敌人——整表失效、误标 boss 场景（软锁主线）
//         全部现形；
//       - GET /chapters 200：运行中的服务端把这份带标记的数据文件正常
//         下发（loadChapters 是惰性的——坏数据不挡 listening，首个触碰
//         章节数据的请求才抛 CHAPTERS_INVALID 变 500，200 = 校验已过）。
//   (b) 行为负向：DB 落点 save.scene=ch1_surface、encounter_clock 顶到
//       PITY_LIMIT-1（无标记时下一次掷点必出怪——确定性负向，不靠 RNG
//       赏脸）：
//       - 「攻击」×2：回包不得有【遭遇】、save.combat 恒 null（原地叫阵
//         路径也被标记压住，诚实回「没有可攻击的目标」）；
//       - 「前进」#1：过门跨章落到 ch2 链首 ch2_daily_quest（医院病房，
//         标 none）——第 9 轮实测的「过门即开战」不得复现；
//       - 「前进」#2（再落点 ch3_retest、守关者已清、保底顶格）：落到
//         ch3_new_rank（现实场景）同章落地掷点同样被压住——无标记时
//         保底必出怪，这里是标记唯一挡板。
//   (c) 行为正向：scene=ch1_law（未标记地下城）连续「前进」必须刷出
//       【遭遇】/combat——证明掷怪没有被整体关掉换全绿。
//
//   变异敏感性：删掉场景上的标记 → (a) 清单断言必 FAIL；roll() 不读
//   encounters 字段 → (a) 矩阵与 (b) 保底顶格两处确定性 FAIL；roll()
//   一律返回 null（判怪被整体关掉）→ (a) 未标场景保底必中 + (c) 双双
//   FAIL；把 "none" 标到 boss 场景 → chapters.js 校验期炸 + (a) kind
//   检查 FAIL；落地/叫阵/休憩三条路径任一绕过 roll 另起掷点 → (b) 的
//   攻击压制失效必 FAIL（roll 是唯一漏斗）。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, get, makeSave, act, fetchSaveView, advanceStep } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const encounter = require(path.join(ROOT, "server", "engine", "encounter.js"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

const ENCOUNTER_MARK = "【遭遇】";
const PITY_EDGE = encounter.PITY_LIMIT - 1;

// 落点锻造：只改本脚本自造存档的 saves/combat 行（同 gate-refusal-free 取径）。
function forge(id, fields) {
  const cols = Object.keys(fields);
  db.prepare(`UPDATE saves SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
    ...cols.map((c) => fields[c]),
    id
  );
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
}

const sceneById = new Map();
const sceneChapter = new Map();
for (const c of CHAPTERS.chapters) {
  for (const s of c.scenes) {
    sceneById.set(s.id, s);
    sceneChapter.set(s.id, c.index);
  }
}

// ── (a) 数据层：标记必须在场、被引擎真读、且只在合法场景上 ──────────
{
  // 运行实例的数据文件健康：loadChapters 惰性加载——坏数据不挡进程
  // listening，首个触碰章节数据的请求才 500；/chapters 200 = 校验已过。
  const api = await get("/chapters");
  assert(
    api.status === 200 && Array.isArray(api.body.chapters) && api.body.chapters.length === 8,
    `(a) GET /chapters must serve the loaded data file (HTTP ${api.status})`
  );

  // 「哪些场景必须是 none」是显式快照集合：现实世界/收束场景的完整清单，
  // 实际 none 集合必须与之完全相等——多标（误压 dungeon/boss）与漏标
  // （删除标记）双向现形，不是子集、不是下限。
  const EXPECTED_NONE = new Set([
    "ch1_surface",
    "ch2_daily_quest",
    "ch3_association",
    "ch3_new_rank",
    "ch4_raid_party",
    "ch4_after",
    "ch5_quest",
    "ch6_survivors",
    "ch8_jeju",
    "ch8_epilogue",
  ]);
  const actualNone = new Set();
  for (const c of CHAPTERS.chapters) {
    for (const s of c.scenes) {
      if (s.encounters === "none") actualNone.add(s.id);
    }
  }
  {
    const missing = [...EXPECTED_NONE].filter((id) => !actualNone.has(id));
    const extra = [...actualNone].filter((id) => !EXPECTED_NONE.has(id));
    assert(
      missing.length === 0 && extra.length === 0,
      `(a) encounters:"none" set drifted — missing: [${missing.join(", ") || "-"}], extra: [${extra.join(", ") || "-"}]`
    );
  }

  // 全量场景 × 真实引擎 roll（保底顶格时钟 = 未标场景必出怪的确定性上界）：
  //   标 "none" → 必 null（标记被引擎真读，不是装饰字段）；
  //   未标 → 必有敌人（缺省回落旧行为，判怪没被整体关掉）；
  //   "none" 不得出现在 boss 场景（守关战被压住 = 主线软锁）。
  for (const c of CHAPTERS.chapters) {
    for (const s of c.scenes) {
      const atPity = encounter.roll({ chapterIndex: c.index, scene: s, clock: PITY_EDGE, seed: "f115" });
      if (s.encounters === "none") {
        assert(
          atPity === null,
          `(a) ${s.id} marked encounters:"none" but roll spawned ${atPity && atPity.name}`
        );
        assert(
          s.kind !== "boss",
          `(a) ${s.id} is a boss scene and must never be marked "none" (mainline soft-lock)`
        );
      } else {
        assert(
          atPity && atPity.hp > 0,
          `(a) unmarked scene ${s.id} (kind=${s.kind}) lost its pity-guaranteed encounter`
        );
      }
    }
  }
  console.log(`    (a) data layer: none-set == snapshot (${actualNone.size} scenes), roll() honors all marks`);
}

// ── (b) 行为负向：标记场景上攻击/落地/过门全部不刷怪 ────────────────
{
  const id = await makeSave("f115-calm");
  // 保底顶格 + 冷却归零：若没有标记，下一次掷点必出怪——「不出怪」只能
  // 归功于标记，不存在 RNG 侥幸。
  forge(id, {
    scene: "ch1_surface",
    boss_cleared_json: JSON.stringify(["ch1"]),
    encounter_clock: PITY_EDGE,
    encounter_cd: 0,
  });
  const s0 = (await fetchSaveView(id)).save;
  assert(
    s0.scene === "ch1_surface" && s0.combat === null,
    `(b) setup broken: scene=${s0.scene} combat=${JSON.stringify(s0.combat)}`
  );

  // 攻击 ×2：保底顶格的原地叫阵在医院也必须空挥。
  for (let i = 0; i < 2; i++) {
    const r = await act(id, "攻击");
    assert(
      !r.reply.content.includes(ENCOUNTER_MARK),
      `(b) attack#${i + 1} at ch1_surface spawned an encounter: ${r.reply.content.slice(-160)}`
    );
    assert(
      r.save.combat === null,
      `(b) attack#${i + 1} opened combat at ch1_surface: ${JSON.stringify(r.save.combat)}`
    );
    assert(
      r.reply.content.includes("没有可攻击的目标"),
      `(b) attack#${i + 1} must answer honestly (no target): ${r.reply.content.slice(-120)}`
    );
  }

  // 前进 #1：ch1 链尾过门 → ch2 链首（病房，标 none）——过门不得立刻开战。
  {
    const r = await act(id, "前进");
    assert(
      r.save.chapter === 2 && r.save.scene === "ch2_daily_quest",
      `(b) gate push should land on ch2_daily_quest, got ${r.save.scene} ch${r.save.chapter}`
    );
    assert(
      !r.reply.content.includes(ENCOUNTER_MARK),
      `(b) chapter-gate landing spawned an encounter: ${r.reply.content.slice(-160)}`
    );
    assert(
      r.save.combat === null,
      `(b) gate landing opened combat: ${JSON.stringify(r.save.combat)}`
    );
  }

  // 前进 #2：换一组落点——同章落地 + 保底顶格。无标记时 pity 必出怪，
  // 「不出怪」唯一解释是落点场景的标记（守关者已清，避开 boss 必中分支）。
  forge(id, {
    chapter: 3,
    scene: "ch3_retest",
    boss_cleared_json: JSON.stringify(["ch1", "ch3"]),
    encounter_clock: PITY_EDGE,
    encounter_cd: 0,
  });
  {
    const r = await act(id, "前进");
    assert(
      r.save.scene === "ch3_new_rank" && r.save.chapter === 3,
      `(b) in-chapter push should land on ch3_new_rank, got ${r.save.scene} ch${r.save.chapter}`
    );
    assert(
      !r.reply.content.includes(ENCOUNTER_MARK),
      `(b) landing on ch3_new_rank spawned an encounter at pity edge: ${r.reply.content.slice(-160)}`
    );
    assert(
      r.save.combat === null,
      `(b) landing opened combat at pity edge: ${JSON.stringify(r.save.combat)}`
    );
  }

  const after = (await fetchSaveView(id)).save;
  assert(after.combat === null, `(b) combat must stay null: ${JSON.stringify(after.combat)}`);
  console.log(`    (b) ch1_surface: 2x attack + 2x advance (gate + pity-edge landing) — zero encounters`);
}

// ── (c) 行为正向：未标记地下城场景必须仍能刷怪 ──────────────────────
{
  const id = await makeSave("f115-dungeon");
  forge(id, {
    scene: "ch1_law",
    boss_cleared_json: "[]",
    encounter_clock: 0,
    encounter_cd: 0,
  });
  // 从 ch1_law 连推：worship（掷点）→ statues（守关房，boss 必中兜底）——
  // 即使小怪掷点全空，≤2 步必在守关房撞上【遭遇】，循环有确定上界。
  let hit = null;
  for (let i = 0; i < 6 && !hit; i++) {
    // P204：ch1_law 标了 must_choose——advanceStep 自动补发主线选项。
    const r = await advanceStep(id);
    if (r.save.combat || r.reply.content.includes(ENCOUNTER_MARK)) hit = r;
  }
  assert(hit, `(c) dungeon scene never spawned an encounter within 6 advances (rolls globally off?)`);
  assert(
    hit.reply.content.includes(ENCOUNTER_MARK),
    `(c) combat began without the 【遭遇】 broadcast: ${hit.reply.content.slice(-160)}`
  );
  assert(
    hit.save.combat && hit.save.combat.enemy && hit.save.combat.enemy.hp > 0,
    `(c) spawned enemy missing/dead: ${JSON.stringify(hit.save.combat)}`
  );
  console.log(`    (c) positive path: ${hit.save.scene} spawned ${hit.save.combat.enemy.name} Lv.${hit.save.combat.enemy.level}`);
}

db.close();
ok("OK");
