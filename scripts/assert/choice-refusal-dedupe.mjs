#!/usr/bin/env node
// P206 must_choose 拒绝正文去重（连点「前进」不再整屏复读选项清单）：
//
//   a) 新档真实推进到 ch1_law，连发 6 次裸「前进」：
//      · 每次都 refused、零消耗——scene/hp/mp/xp 六次全不变；
//      · 日志里含「必须做出选择」的完整拒绝正文 ≤ 1 条（首条照落，
//        后续同场景同选项集合的重复拒绝不再写库）；
//      · 回包 save.next_choices 仍 ≥ 2（选项键不随去重消失）。
//   b) 显式「选择 1」照常落地推进（去重不得把出路一并吞掉）。
//   c) 推进到第二个 must_choose 场景（ch1_statues，守关战真杀后），
//      裸「前进」再被拒时完整正文重新出现——去重键按场景+选项指纹，
//      不是全局一次性静音。
//
//   旧码红证：旧码每次拒绝都落整条正文，(a) 计得 6 条 → FAIL。
//   期望值独立读 chapters.json（场景 id / 选项 label），不经被测引擎。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  ok,
  fail,
  makeSave,
  act,
  get,
  fetchSaveView,
  advanceTraverse,
  clearCombat,
} from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

const sceneById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneById.set(s.id, s);
assert(sceneById.get("ch1_law")?.must_choose === true, "oracle broken: ch1_law must_choose");
assert(sceneById.get("ch1_statues")?.must_choose === true, "oracle broken: ch1_statues must_choose");

// 含完整拒绝正文的日志行数（「必须做出选择」是 P204 门措辞指纹）。
async function refusalLogCount(id) {
  const { status, body } = await get(`/saves/${id}/log?limit=200`);
  assert(status === 200 && Array.isArray(body.log), `GET log failed (HTTP ${status})`);
  return body.log.filter((r) => /必须做出选择/.test(r.content || "")).length;
}

// 推进到目标场景并脱战（与 choice-gate 同口径：守关房落地必开战，
// 就地真打；阵亡回溯拉回章首则重新推进）。
async function driveToCleared(id, sceneId, tries = 90) {
  for (let i = 0; i < tries; i++) {
    const { save: s } = await fetchSaveView(id);
    if (s.scene === sceneId) {
      if (s.combat) await clearCombat(id);
      const after = (await fetchSaveView(id)).save;
      if (after.scene === sceneId && !after.combat) return after;
      continue;
    }
    await advanceTraverse(id);
  }
  fail(`driveToCleared: never reached ${sceneId} (stuck at ${(await fetchSaveView(id)).save.scene})`);
}

const id = await makeSave("p206-choice-dedupe");
console.log(`[setup] save_id=${id}`);

// ── (a) ch1_law 连发 6 次「前进」─────────────────────────────────
await driveToCleared(id, "ch1_law");
const pre = (await fetchSaveView(id)).save;
assert(
  pre.scene === "ch1_law" && !pre.combat,
  `setup broken: scene=${pre.scene} combat=${JSON.stringify(pre.combat)}`
);
const baseCount = await refusalLogCount(id);

for (let i = 0; i < 6; i++) {
  const r = await act(id, "前进");
  assert(
    r.refused === true,
    `(a) push#${i + 1} must be refused, got ${JSON.stringify(r.refused)} :: ${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.scene === "ch1_law" && r.save.hp === pre.hp && r.save.mp === pre.mp && r.save.xp === pre.xp,
    `(a) push#${i + 1} 拒绝不是零消耗：scene ${r.save.scene} hp ${pre.hp}->${r.save.hp} ` +
      `mp ${pre.mp}->${r.save.mp} xp ${pre.xp}->${r.save.xp}`
  );
  const choices = Array.isArray(r.save.next_choices) ? r.save.next_choices : [];
  assert(
    choices.length >= 2,
    `(a) push#${i + 1} 去重不得吞掉选项键：next_choices=${JSON.stringify(choices)}`
  );
}

const after6 = await refusalLogCount(id);
assert(
  after6 - baseCount <= 1,
  `(a) 6 次重复拒绝在日志里落了 ${after6 - baseCount} 条「必须做出选择」正文（应 ≤ 1）——` +
    `拒绝刷屏旧毛病仍在（旧码红证位）`
);
assert(
  after6 - baseCount >= 1,
  `(a) 首次拒绝正文没落库（计得 ${after6 - baseCount} 条）——去重把首条也吞了`
);
console.log(`    (a) 6 连点：拒绝正文落库 ${after6 - baseCount} 条，scene/hp/mp/xp 全冻结`);

// ── (b) 显式「选择 1」仍落地 ────────────────────────────────────
{
  const r = await act(id, "选择 1");
  assert(
    r.refused !== true && r.save.scene !== "ch1_law",
    `(b) 「选择 1」应正常落地推进，实际 refused=${JSON.stringify(r.refused)} scene=${r.save.scene}`
  );
  console.log(`    (b) 「选择 1」落地 → scene=${r.save.scene}`);
}

// ── (c) 第二个 must_choose 场景（ch1_statues）拒绝正文重新出现 ──
await driveToCleared(id, "ch1_statues");
const preC = await refusalLogCount(id);
const rc = await act(id, "前进");
assert(rc.refused === true, `(c) ch1_statues 裸「前进」必须 refused: ${JSON.stringify(rc.refused)}`);
assert(
  /必须做出选择/.test(rc.reply.content || ""),
  `(c) 换场景后拒绝应重新给出完整正文（含「必须做出选择」）: ${rc.reply.content.slice(-160)}`
);
for (const lb of (sceneById.get("ch1_statues").choices || []).map((c) => c.label)) {
  assert(
    rc.reply.content.includes(lb),
    `(c) ch1_statues 拒绝正文缺真实选项名「${lb}」: ${rc.reply.content.slice(0, 160)}`
  );
}
const postC = await refusalLogCount(id);
assert(
  postC - preC === 1,
  `(c) 换场景后首次拒绝应再落一条完整正文（计得 ${postC - preC}）——` +
    `去重键写成了全局一次性，换场景后被永久静音`
);
console.log(`    (c) ch1_statues：换场景后拒绝正文重新落库（键 = scene + 选项指纹）`);

ok("OK");
