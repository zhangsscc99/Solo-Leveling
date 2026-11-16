#!/usr/bin/env node
// F114 死亡回溯后场景指针与章节步数必须是一本账：
//   (a) DB 落点构造「1章 4/7 且场景在 boss 战」的存档——站位 ch1_statues
//       （主线链第 4 幕守关房）+ boss_cleared 已含 ch1（守关者曾击杀、
//       重进守关房再战属合法存档态）+ combat 行写入守关者实体、hp=1，
//       另把 main_steps 写成 7 作陈旧高水位陷阱（旧口径下回溯后计数会
//       恒定在 7——新口径必须忽略它）。真实「攻击」打到 HP 0 → settleDeath
//       全链路回溯。断言：
//         · 回溯落点 = 本章链首入口（ch1_double_gate，scene_index === 0）
//           ——F095 已验收的入口回溯契约（F114「退两幕」系回归，F122 改回）；
//         · 回包与 GET /saves/:id 双源一致：scene_index + 1 === chapter_steps；
//         · 死亡播报落点名 = saves 回包 scene_title（本用例落点正是链首
//           入口，正文必须出现「的入口」——播报与存档同账，不写死）。
//   (b) 回溯后把击杀冷却拉高压制遭遇掷点（排除 RNG 噪声，只验步数口径），
//       连点「前进」3 次：chapter_steps 严格单调递增到 ≥4（回溯后从 1
//       起，不得原地不动）；每次响应若 scene 与请求前相同，正文不得
//       出现「体力消耗」。
//   (c) 反向断言贯穿全程：任何一次响应 scene_index + 1 !== chapter_steps
//       立即 FAIL——把双账当期望值写死也 FAIL（初始 fixture 的 steps
//       必须由站位推导为 4，不得被 main_steps=7 的高水位顶上去）。
//   主线链 oracle 只从 chapters.json 独立推导，不调被测引擎。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
// boss 实体由遭遇表同源生成——与 tryEncounter 落地开战写进 combat 行
// 的是同一个实体形状，fixture 不是期望值 oracle，可直接复用引擎。
const encounterEngine = require(path.join(ROOT, "server", "engine", "encounter.js"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// ── 独立 oracle：ch1 主线链只沿 next_scene / 首个未到访 choice 推导 ──
const ch1 = raw.chapters.find((c) => c.index === 1);
const PATH = [];
{
  const byId = new Map(ch1.scenes.map((s) => [s.id, s]));
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
const TOTAL = PATH.length;
const BOSS_SCENE = ch1.scenes.find((s) => s.kind === "boss");
assert(BOSS_SCENE, "oracle: ch1 boss scene missing");
const BOSS_IDX = PATH.indexOf(BOSS_SCENE.id);
assert(BOSS_IDX === 3, `oracle: ch1 boss scene should sit at chain idx 3, got ${BOSS_IDX}`);
// F095 入口回溯契约：落点 = 本章主线链首（F114「退两幕」系回归，F122 改回）。
const EXPECT_LANDING_IDX = 0;
const EXPECT_LANDING = PATH[EXPECT_LANDING_IDX];

const VITALS_COST = /（体力消耗 [^）]*）/;

// (c) 反向断言：双账一出现立即 FAIL——每个存档快照都要过这道关。
function checkLedger(s, tag) {
  assert(
    s.scene_index + 1 === s.chapter_steps,
    `${tag}: 双账复活——scene_index=${s.scene_index}(${s.scene}) vs chapter_steps=${s.chapter_steps}`
  );
}

// ── (a) boss 战里打到 HP 0 → 回溯后位置与计数同退 ──────────────────
const id = await makeSave("f114-respawn");
const boss = { ...encounterEngine.spawnBoss(1), seq: 1 };
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, hp = 1, level = 2, deaths = 1, " +
    "main_steps = 7, encounter_cd = 9, encounter_clock = 0, boss_cleared_json = ? WHERE id = ?"
).run(BOSS_SCENE.id, JSON.stringify([ch1.id]), id);
db.prepare("INSERT INTO combat (save_id, enemy_json, turn) VALUES (?, ?, 1)").run(
  id,
  JSON.stringify(boss)
);

{
  const s0 = (await fetchSaveView(id)).save;
  assert(s0.scene === BOSS_SCENE.id && s0.scene_index === BOSS_IDX,
    `(a) setup broken: scene ${s0.scene} idx ${s0.scene_index}`);
  // 陈旧高水位不得再顶起计数：4/7 就是 4/7，不是 7/7。
  checkLedger(s0, "(a) pre-death");
  assert(s0.chapter_steps === 4, `(a) fixture should read 4/${TOTAL}, got ${s0.chapter_steps}`);
  assert(s0.combat && s0.combat.enemy, "(a) setup broken: boss combat row missing");
}

let died = null;
for (let i = 0; i < 30 && !died; i++) {
  const r = await act(id, "攻击");
  if (r.save.deaths >= 2) died = r;
}
assert(died, "(a) 30 combat turns never killed the player");
const rep = died.reply.content;
assert(rep.includes("倒下"), `(a) missing 倒下 broadcast: ${rep.slice(-300)}`);
assert(rep.includes("回溯"), `(a) missing 回溯 broadcast: ${rep.slice(-300)}`);
assert(died.save.combat === null, "(a) stale combat after death");

// 落点：本章链首入口 idx0（F095 契约，与倒下位置无关）。
assert(
  died.save.scene === EXPECT_LANDING,
  `(a) rewind should land on ${EXPECT_LANDING} (idx ${EXPECT_LANDING_IDX}), got ${died.save.scene}`
);
checkLedger(died.save, "(a) post-death");
assert(
  died.save.chapter_steps === EXPECT_LANDING_IDX + 1,
  `(a) post-death steps should be ${EXPECT_LANDING_IDX + 1}, got ${died.save.chapter_steps}`
);
// 播报落点文本必须取真实 save.scene：落点即链首入口，场景名与「的入口」
// 都必须出现在正文里——播报与存档同账，不写死。
assert(
  rep.includes(`「${died.save.scene_title}」`),
  `(a) rewind broadcast must name the real landing「${died.save.scene_title}」: ${rep.slice(-300)}`
);
assert(
  rep.includes("的入口"),
  `(a) landing IS the entry (idx ${EXPECT_LANDING_IDX}) — broadcast must say 的入口: ${rep.slice(-300)}`
);
// GET /saves/:id 双源一致。
const view = (await fetchSaveView(id)).save;
assert(
  view.scene === died.save.scene && view.scene_index === died.save.scene_index &&
    view.chapter_steps === died.save.chapter_steps,
  `(a) /saves/:id diverged from action reply: ` +
    `${view.scene}/${view.scene_index}/${view.chapter_steps} vs ` +
    `${died.save.scene}/${died.save.scene_index}/${died.save.chapter_steps}`
);
checkLedger(view, "(a) /saves/:id");

// ── (b) 回溯后连点 3 次「前进」：计数严格递增到 ≥5，无位移不扣费 ──
// 死亡把 encounter_cd 清零了——重新拉高压制遭遇掷点，本段只验步数口径。
db.prepare("UPDATE saves SET encounter_cd = 9 WHERE id = ?").run(id);
let prevSteps = view.chapter_steps;
let prevScene = view.scene;
for (let i = 0; i < 3; i++) {
  const r = await act(id, "前进");
  const s = r.save;
  checkLedger(s, `(b) push ${i + 1}`);
  assert(
    s.chapter_steps > prevSteps,
    `(b) push ${i + 1}: chapter_steps stuck at ${s.chapter_steps} (was ${prevSteps})`
  );
  if (s.scene === prevScene) {
    assert(
      !VITALS_COST.test(r.reply.content),
      `(b) push ${i + 1}: no movement but vitals were charged: ${r.reply.content.slice(-200)}`
    );
  }
  prevSteps = s.chapter_steps;
  prevScene = s.scene;
}
assert(
  prevSteps >= EXPECT_LANDING_IDX + 4,
  `(b) after 3 pushes chapter_steps should reach >=${EXPECT_LANDING_IDX + 4}, got ${prevSteps}`
);

db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
db.prepare("DELETE FROM saves WHERE id = ?").run(id);
db.close();
ok("OK");
