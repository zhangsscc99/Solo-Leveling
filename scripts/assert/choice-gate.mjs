#!/usr/bin/env node
// P204 must_choose 门契约（关键抉择不得被「探索前进」整屏跳过）：
//   a) 新档沿主线真实推进到 ch1_statues（守关战真打）——杀完后裸按
//      「前进」必须 refused：scene/hp/mp/xp/advance_streak 全不变，正文
//      命中「必须…选择」并列出真实选项名（endure/reach）。
//   b) 「选择 endure」落到 ch1_system 后裸按「前进」同样 refused，
//      且正文同时出现两个真实选项名（accept/refuse 的 label 原文）。
//   c) 「选择 accept」照走 F196 管线：落 ch1_awaken、播报 XP +30、
//      日志落【线索·system_bound】（effects 真入账）。
//   d) 未标 must_choose 的 ch1_double_gate 裸按「前进」仍推进到
//      ch1_law——证明不是一刀切。
// 旧码红证：服务端不认 must_choose 时 (a)(b) 的裸「前进」直接推进，
//   r.refused !== true → FAIL；脚本在新/旧码上都可运行（穿越驱动只对
//   refused 响应补发显式选项，旧码恒退回纯「前进」）。
// 期望值独立推导自 chapters.json（scene id / choices.label 原文比对），
// 不经被测引擎。
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

// 推进到目标场景并脱战（守关房落地必开战：就地真打；阵亡回溯场景被
// 拉回章首则重新推进——80 步足够收敛）。
async function driveToCleared(id, sceneId, tries = 80) {
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

// 裸「前进」在 must_choose 场景必须是零消耗拒绝：位移/体力/经验/疾行
// 全冻结，正文命中门措辞并列出每个真实选项 label。
async function assertMustChooseRefusal(id, sceneId) {
  const scene = sceneById.get(sceneId);
  assert(scene, `oracle broken: scene ${sceneId} missing`);
  const labels = (scene.choices || []).map((c) => c.label);
  assert(labels.length >= 1, `${sceneId}: choices missing`);

  const pre = (await fetchSaveView(id)).save;
  assert(
    pre.scene === sceneId && !pre.combat,
    `${sceneId}: setup broken (scene=${pre.scene} combat=${JSON.stringify(pre.combat)})`
  );

  const r = await act(id, "前进");
  const c = r.reply.content || "";
  assert(
    r.refused === true,
    `${sceneId}: 裸「前进」未被拒绝（refused=${JSON.stringify(r.refused)} scene=${r.save.scene}）——must_choose 门未生效（旧码红证位）`
  );
  assert(
    r.save.scene === sceneId,
    `${sceneId}: 被拒却移动了 scene ${pre.scene} -> ${r.save.scene}`
  );
  assert(
    r.save.hp === pre.hp && r.save.mp === pre.mp,
    `${sceneId}: 被拒却扣了体力 hp ${pre.hp}->${r.save.hp} mp ${pre.mp}->${r.save.mp}`
  );
  assert(r.save.xp === pre.xp, `${sceneId}: 被拒却动了 xp ${pre.xp} -> ${r.save.xp}`);
  assert(
    (r.save.advance_streak || 0) === (pre.advance_streak || 0),
    `${sceneId}: 被拒却记了疾行 ${pre.advance_streak} -> ${r.save.advance_streak}`
  );
  assert(
    /(必须|需要)[^。\n]*选择/.test(c),
    `${sceneId}: 拒绝正文未命中「必须/需要…选择」: ${c.slice(0, 160)}`
  );
  for (const lb of labels) {
    assert(c.includes(lb), `${sceneId}: 拒绝正文缺真实选项名「${lb}」: ${c.slice(0, 160)}`);
  }
  console.log(`    ${sceneId} 拒绝正文: ${c.split("\n")[0].slice(0, 120)}`);

  // 存档重取复核： refused 不产任何落库副作用。
  const post = (await fetchSaveView(id)).save;
  assert(
    post.scene === pre.scene && post.hp === pre.hp && post.mp === pre.mp && post.xp === pre.xp,
    `${sceneId}: 拒绝后存档与事前不一致`
  );
  return r;
}

const id = await makeSave("p204-choice-gate");

// ── (a) ch1_statues（boss 已真杀）裸「前进」→ refused ─────────────
await driveToCleared(id, "ch1_statues");
await assertMustChooseRefusal(id, "ch1_statues");

// ── (b) 显式选项跨过 → ch1_system 裸「前进」→ refused ─────────────
{
  const rc = await act(id, "选择 endure");
  assert(
    rc.save.scene === "ch1_system",
    `选择 endure 应落 ch1_system，实际 ${rc.save.scene}（${String(rc.reply.content).slice(0, 80)}）`
  );
  await assertMustChooseRefusal(id, "ch1_system");
}

// ── (c) 「选择 accept」：落 ch1_awaken + effects 真入账 ────────────
{
  const pre = (await fetchSaveView(id)).save;
  const r = await act(id, "选择 accept");
  assert(
    r.save.scene === "ch1_awaken",
    `选择 accept 应落 ch1_awaken，实际 ${r.save.scene}（${String(r.reply.content).slice(0, 80)}）`
  );
  assert(
    String(r.reply.content).includes("XP +30"),
    `accept 回包缺 XP +30 入账播报: ${String(r.reply.content).slice(-160)}`
  );
  const post = (await fetchSaveView(id)).save;
  // xp 同级净 +30；若跨级则 level 必须上行（effects 已入账的两种真实形态）。
  assert(
    post.xp === pre.xp + 30 || post.level > pre.level,
    `accept 后 xp 未入账：xp ${pre.xp}->${post.xp} level ${pre.level}->${post.level}`
  );
  const { status, body } = await get(`/saves/${id}/log?limit=50`);
  assert(status === 200 && body && Array.isArray(body.log), `GET log failed (HTTP ${status})`);
  assert(
    body.log.some((row) => String(row.content || "").includes("【线索·system_bound】")),
    "存档日志缺【线索·system_bound】——accept.effects.flag 未落账"
  );
  console.log(`    accept 落地: scene=${post.scene} xp=${post.xp} level=${post.level} flag=system_bound ✓`);
}

// ── (d) 未标 must_choose 的 ch1_double_gate：裸「前进」仍推进 ──────
{
  const id2 = await makeSave("p204-gate-free");
  const s0 = (await fetchSaveView(id2)).save;
  assert(s0.scene === "ch1_double_gate", `新档应站在 ch1_double_gate，实际 ${s0.scene}`);
  const r = await act(id2, "前进");
  assert(
    r.refused !== true && r.save.scene === "ch1_law",
    `未标场景「前进」应推进到 ch1_law，实际 scene=${r.save.scene} refused=${JSON.stringify(r.refused)}`
  );
  console.log(`    未标场景前进: ${s0.scene} -> ${r.save.scene} ✓`);
}

ok("PASS: must_choose 场景拒绝无 choice 的「前进」并列出选项；显式选择照走 F196 管线");
