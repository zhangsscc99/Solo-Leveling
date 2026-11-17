#!/usr/bin/env node
// F196 假选项收口契约（两选项同 next 的场景，A/B 必须可区分）：
//   对 ch1_double_gate / ch2_daily_quest / ch2_penalty_gate 各开两个独立
//   新档（相同 player_name 前缀、不同后缀），分别口述「选择 1」「选择 2」。
//   1) 两次回包正文首段（选项 lead）必须不相同——逐字相同打印
//      `[ASSERT] choice A/B identical prose: <场景>` 并退出 1（旧码红证）。
//   2) 三个场景里至少一个在两档之间产生可观察差异：动作前后 hp/mp 增量、
//      背包件数、或本动作新落的【线索·flag】。
//   3) 两档落地 chapter/scene 必须一致且等于 options 共同的 next（拓扑
//      与旧行为同一口径）。
//   4) 「选择」在旧码上是未知指令——两档都不离开当前场景时按「场景未
//      移动」红掉（旧码红证的第二路）。
//   期望值不经过被测引擎：choice.next / lead 全从 chapters.json 原样读。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  ok,
  fail,
  makeSave,
  act,
  fetchSaveView,
  advanceTraverse,
  clearCombat,
} from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

const sceneById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneById.set(s.id, s);

const TARGETS = [
  { tag: "dg", sceneId: "ch1_double_gate" },
  { tag: "dq", sceneId: "ch2_daily_quest" },
  { tag: "pg", sceneId: "ch2_penalty_gate" },
];

for (const t of TARGETS) {
  const scene = sceneById.get(t.sceneId);
  assert(scene, `scene not found in chapters.json: ${t.sceneId}`);
  const choices = Array.isArray(scene.choices) ? scene.choices : [];
  assert(choices.length >= 2, `${t.sceneId}: fewer than 2 choices`);
  assert(
    choices[0].next === choices[1].next && typeof choices[0].next === "string",
    `${t.sceneId}: fixture drifted — choices no longer share the same next`
  );
  t.expectedNext = choices[0].next;
}

// 战斗感知推进到目标场景（穿越守关战/遭遇战由 advanceTraverse 处理），
// 落点带交战先就地清场，保证下一步「选择」不被交战拒绝。
async function driveTo(id, sceneId) {
  for (let i = 0; i < 80; i++) {
    const { save: s } = await fetchSaveView(id);
    if (s.scene === sceneId) {
      if (s.combat) await clearCombat(id);
      return;
    }
    await advanceTraverse(id);
  }
  fail(`driveTo: never reached ${sceneId}`);
}

const flagRe = /【线索·([a-z0-9_]+)】/g;
const flagsIn = (content) => {
  const out = new Set();
  for (const m of String(content || "").matchAll(flagRe)) out.add(m[1]);
  return out;
};

let anyObservableDiff = false;

for (const t of TARGETS) {
  const idA = await makeSave(`f196-${t.tag}-a`);
  const idB = await makeSave(`f196-${t.tag}-b`);
  await driveTo(idA, t.sceneId);
  await driveTo(idB, t.sceneId);

  const preA = (await fetchSaveView(idA)).save;
  const preB = (await fetchSaveView(idB)).save;
  assert(preA.scene === t.sceneId && preB.scene === t.sceneId, `${t.sceneId}: drive failed`);

  const ra = await act(idA, "选择 1");
  const rb = await act(idB, "选择 2");

  // 首段差异（lead 独占段）：逐字相同 = 旧码/数据未生效。
  const firstA = String(ra.reply.content || "").split("\n")[0].trim();
  const firstB = String(rb.reply.content || "").split("\n")[0].trim();
  if (firstA === firstB) {
    fail(`choice A/B identical prose: ${t.sceneId}`);
  }

  // 拓扑：两档落到同一个预期节点（options 共同的 next）。
  assert(
    ra.save.scene === t.expectedNext && rb.save.scene === t.expectedNext,
    `${t.sceneId}: landing drift — A=${ra.save.scene} B=${rb.save.scene} expected ${t.expectedNext}`
  );
  assert(
    ra.save.chapter === rb.save.chapter,
    `${t.sceneId}: chapter drift — A=${ra.save.chapter} B=${rb.save.chapter}`
  );

  // 可观察差异：动作前后 hp/mp 增量差、背包件数差、本动作新落 flag 差。
  const postA = await fetchSaveView(idA);
  const postB = await fetchSaveView(idB);
  const dHpA = ra.save.hp - preA.hp;
  const dHpB = rb.save.hp - preB.hp;
  const dMpA = ra.save.mp - preA.mp;
  const dMpB = rb.save.mp - preB.mp;
  const invA = (postA.inventory || []).reduce((n, r) => n + (r.qty || 0), 0);
  const invB = (postB.inventory || []).reduce((n, r) => n + (r.qty || 0), 0);
  const fA = flagsIn(ra.reply.content);
  const fB = flagsIn(rb.reply.content);
  const flagDiff =
    [...fA].some((f) => !fB.has(f)) || [...fB].some((f) => !fA.has(f));

  const diff =
    dHpA !== dHpB || dMpA !== dMpB || invA !== invB || flagDiff;
  if (diff) anyObservableDiff = true;
  console.log(
    `[check] ${t.sceneId}: A(选择1)→${ra.save.scene} Δhp=${dHpA} Δmp=${dMpA} flags=${[...fA].join(",") || "-"} | ` +
      `B(选择2)→${rb.save.scene} Δhp=${dHpB} Δmp=${dMpB} flags=${[...fB].join(",") || "-"} | diff=${diff}`
  );
}

assert(
  anyObservableDiff,
  "no observable difference across all scenes (hp/mp deltas, inventory, flags all identical)"
);

ok("PASS: choice branching A/B differs (lead prose + settlement), topology preserved");
