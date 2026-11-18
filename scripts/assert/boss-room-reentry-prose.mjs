#!/usr/bin/env node
// F125 逃跑后重入守关房的文案一致性（全是行为断言）：
//
//   (a) 真实路径：走到守关房触发守关战 → 交战态「逃跑」成功撤回上一
//       主线场景（F095 逃生阀）→ 再点「前进」重入守关房——
//       回包 hp/mp 与重入前一致（零消耗）、不复读开场战叙述
//       （不含「拳落下来」「腿骨断裂」）、不含「残骸」、combat=null、
//       advance_mode=challenge_boss。
//   (b) 再入播报是「回到守关房」类中性描述：含守关者真名与「未倒下」
//       事实，且与 boss 场景首次进场正文不同。
//   (c) 房内「观察」与「攻击」叫阵回包在 boss_cleared 不含本章 boss 时
//       一律不得出现「残骸」「白骨」「尸体」等已击杀措辞；叫阵必须
//       真把守关战接起来（不软锁）。
//   (d) 逃跑成功撤回上一场景的回包同样不得出现「残骸」——守关者从未
//       被击杀，凝聚的是它本身而不是残骸。
//
//   叫阵失败/撤离失败会吃反击、可能阵亡回溯章首——驱动带重走预算，
//   回溯后重新推进到守关房再来，不静默磨到上限。
//
//   变异敏感性：删掉 advanceWithEncounter 的 F125 再入改写 → (a) 的
//   零消耗/开场白/残骸断言必红；回退「残骸」措辞 → (c)(d) 必红；删掉
//   advanceMode 的 challenge_boss 口子 → (a) 的 advance_mode 断言必红。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, fetchSaveView, advanceStep } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

// ── 独立 oracle：主线链与守关者真名只从数据文件推导 ──────────────
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
const CH1_PATH = deriveMainPath(ch1);
const CH1_BOSS_SCENE = ch1.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS_SCENE && CH1_PATH.includes(CH1_BOSS_SCENE.id), "oracle: ch1 boss scene must be on main chain");
const CH1_BOSS_IDX = CH1_PATH.indexOf(CH1_BOSS_SCENE.id);
const CH1_PREV = CH1_PATH[CH1_BOSS_IDX - 1];
const CH1_BOSS_NAME = CH1_BOSS_SCENE.title;
assert(CH1_BOSS_NAME, "oracle: boss scene title missing");

// 已击杀措辞黑名单：守关者未进 boss_cleared 时一个都不许出现。
const DEAD_WORDS = ["残骸", "白骨", "尸体"];
// 开场战特征句：ch1 守关房场景正文的标志性措辞（数据文件原文）。
const OPENING_MARKS = ["拳落下来", "腿骨断裂"];
assert(
  OPENING_MARKS.every((w) => CH1_BOSS_SCENE.text.includes(w)),
  "oracle: ch1 boss opening marks drifted — update OPENING_MARKS"
);
const noDeadWords = (text, tag) => {
  for (const w of DEAD_WORDS) {
    assert(!String(text || "").includes(w), `${tag}: reply must not say「${w}」while guardian still stands: ${String(text).slice(-200)}`);
  }
};

// 走到守关房：小怪遭遇掷逃（失败挨一下可能阵亡——回溯后从章首重走），
// 落进 boss 场景即停。返回落进房内那一刻的 save（通常已带守关战）。
async function walkToBossRoom(id, { max = 300 } = {}) {
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(id);
    if (s.scene === CH1_BOSS_SCENE.id) return s;
    if (s.combat) {
      await act(id, "逃跑");
      continue;
    }
    await advanceStep(id);
  }
  fail("walkToBossRoom: budget exhausted before reaching the guardian room");
}

// 守关战里掷逃直至真实撤离成功（撤回上一主线场景、挂再入冷却）。
// 撤离失败吃反击；阵亡回溯则重走守关房再开一局。返回撤离成功后的回包。
async function fleeFromGuardian(id, { rounds = 8 } = {}) {
  for (let round = 0; round < rounds; round++) {
    let s = await walkToBossRoom(id);
    if (!s.combat || !s.combat.enemy || !s.combat.enemy.boss) {
      // 冷却期落进房内不开战——原地「攻击」叫阵把守关者逼回战场。
      const r = await act(id, "攻击");
      s = r.save;
    }
    assert(
      s.combat && s.combat.enemy && s.combat.enemy.boss,
      `fleeFromGuardian: guardian fight never engaged: ${JSON.stringify(s.combat)}`
    );
    for (let i = 0; i < 40; i++) {
      const before = (await fetchSaveView(id)).save;
      if (!before.combat) break;
      const r = await act(id, "逃跑");
      const cur = r.save;
      if (cur.combat) continue; // 掷逃失败，回合照推
      if (cur.hp > 0 && cur.deaths === before.deaths && cur.scene === CH1_PREV) {
        return r; // 真实撤离成功
      }
      break; // 阵亡回溯或异常脱离——重走一轮
    }
  }
  fail("fleeFromGuardian: never observed a successful guardian flee within budget");
}

// ── (a)/(b) 撤离 → 零消耗重入 → 中性播报 ──────────────────────────
{
  const id = await makeSave("f125-reentry");
  const fled = await fleeFromGuardian(id);
  const after = fled.save;
  assert(after.scene === CH1_PREV, `(a) flee should retreat to ${CH1_PREV}, got ${after.scene}`);
  assert(after.encounter_clock < 0, `(a) F095 escape valve lost: clock ${after.encounter_clock}`);
  noDeadWords(fled.reply.content, "(d) flee reply");
  const cleared = Array.isArray(after.boss_cleared) ? after.boss_cleared : [];
  assert(!cleared.includes("ch1"), "(a) test premise broken: guardian must not be dead");

  // 重入守关房：回包不得扣 HP/MP、不得复读开场战、不得说「残骸」。
  const re = await act(id, "前进");
  const s = re.save;
  assert(s.scene === CH1_BOSS_SCENE.id, `(a) re-entry should land inside ${CH1_BOSS_SCENE.id}, got ${s.scene}`);
  assert(
    s.hp === after.hp && s.mp === after.mp,
    `(a) re-entry must be free: ${after.hp}/${after.mp} -> ${s.hp}/${s.mp}`
  );
  assert(s.combat === null, `(a) cooldown re-entry must not start combat: ${JSON.stringify(s.combat)}`);
  assert(
    s.advance_mode === "challenge_boss",
    `(a) re-entry must keep advance_mode=challenge_boss, got ${s.advance_mode}`
  );
  for (const w of OPENING_MARKS) {
    assert(
      !re.reply.content.includes(w),
      `(b) re-entry replayed the battle-opening prose「${w}」: ${re.reply.content.slice(-200)}`
    );
  }
  assert(
    !re.reply.content.includes(CH1_BOSS_SCENE.text.slice(0, 20)),
    "(b) re-entry must not replay the first-entry scene text"
  );
  noDeadWords(re.reply.content, "(a) re-entry reply");
  assert(
    re.reply.content.includes(CH1_BOSS_NAME),
    `(b) re-entry reply must name the guardian「${CH1_BOSS_NAME}」: ${re.reply.content.slice(-200)}`
  );
  assert(
    /未倒下|没有倒下|尚未倒下/.test(re.reply.content),
    `(b) re-entry reply must state the guardian still stands: ${re.reply.content.slice(-200)}`
  );
  const reentryCleared = Array.isArray(s.boss_cleared) ? s.boss_cleared : [];
  assert(
    !reentryCleared.includes("ch1"),
    "(a) re-entry must not mark the guardian cleared"
  );

  // ── (c) 房内观察/叫阵在守关者未倒下时不得出现已击杀措辞；叫阵要真接战 ──
  const obs = await act(id, "观察");
  noDeadWords(obs.reply.content, "(c) observe reply");
  const reengaged = await act(id, "攻击");
  assert(
    reengaged.save.combat && reengaged.save.combat.enemy && reengaged.save.combat.enemy.boss,
    `(c) in-room challenge must re-engage the guardian: ${JSON.stringify(reengaged.save.combat)}`
  );
  assert(
    reengaged.save.combat.enemy.name === CH1_BOSS_NAME,
    `(c) challenged enemy should be「${CH1_BOSS_NAME}」, got ${reengaged.save.combat.enemy.name}`
  );
  assert(
    reengaged.save.scene === CH1_BOSS_SCENE.id,
    `(c) challenge should happen inside ${CH1_BOSS_SCENE.id}, got ${reengaged.save.scene}`
  );
  noDeadWords(reengaged.reply.content, "(c) challenge reply");

  // ── 轮换断言：第二次撤离再入必须给出与第一次不同的中性播报 ──
  const fled2 = await fleeFromGuardian(id);
  const after2 = fled2.save;
  assert(after2.scene === CH1_PREV, `(rotation) flee should retreat to ${CH1_PREV}, got ${after2.scene}`);
  noDeadWords(fled2.reply.content, "(d) second flee reply");
  const re2 = await act(id, "前进");
  assert(re2.save.scene === CH1_BOSS_SCENE.id, `(rotation) should re-enter ${CH1_BOSS_SCENE.id}`);
  assert(
    re2.save.hp === after2.hp && re2.save.mp === after2.mp,
    `(rotation) second re-entry must be free: ${after2.hp}/${after2.mp} -> ${re2.save.hp}/${re2.save.mp}`
  );
  noDeadWords(re2.reply.content, "(rotation) second re-entry reply");
  assert(
    re2.reply.content !== re.reply.content,
    `(rotation) re-entry prose must rotate between at least 2 variants, got the same line twice: ${re2.reply.content.slice(-160)}`
  );
  assert(
    re2.reply.content.includes(CH1_BOSS_NAME) && /未倒下|没有倒下|尚未倒下/.test(re2.reply.content),
    `(rotation) second re-entry reply must still name the standing guardian: ${re2.reply.content.slice(-200)}`
  );
}

ok("boss-room-reentry-prose OK");
