#!/usr/bin/env node
// F096 章节门守关者校验 + 交战中「前进」=撤离不推进 契约（全是行为断言）：
//
//   (a) 纯前进不可通章：新档只点「前进」（交战自动=撤离掷逃，守关房靠
//       F095 再入冷却穿过），直到站上 ch1 主线链尾；再点「前进」→
//       save.chapter 仍为 1、chapter_progress 不变、正文含守关者真名
//       「石像守卫」（数据独立推导，非「守关者」占位）。
//   (a2) 收尾补丁：站链尾守关者未击杀连点 6 次「前进」= 零消耗拒绝——
//       hp/mp 逐位不变、chapter/scene/deaths 不变、日志零增长、正文每次
//       都含「本次没有消耗体力」且不含「体力消耗」。拒绝不再扣血，
//       「门口点前进直到死」这条死路被封死。
//   (b) 交战中「前进」不得推进：推进到 boss 房触发守关战，交战态连点
//       「前进」——每次响应 save.chapter 不变、save.scene 绝不越过
//       boss 房（只能停在本景或退到上一主线场景/回溯章首）、正文含
//       「撤离」、不含跨章开启播报；撤离成功后 boss 房再入冷却
//       （save.encounter_clock < 0，F095 逃生阀）照旧生效。
//   (c) 击杀后放行：真实打死 ch1 守关者（save.boss_cleared 含 ch1）后
//       站到链尾再推 → chapter === 2 且落到 ch2 主线链首场景。
//   (d) ch2 同口径：ch2 守关者未击杀时站上链尾（逃跑冷却穿房）再推 →
//       chapter 仍 2，正文点名「毒牙蛇」。
//
//   变异敏感性：把 server 里 bossRequirementMet 短路成 true → (a)(d) 的
//   章节门断言必 FAIL；给交战中「前进」重新接上 advanceOutcome → (b) 的
//   「scene 不得越过 boss 房 / 不得出现开启播报」必 FAIL；把任一拒绝分支
//   改回扣体力（patch: vit.patch）→ (a2) 的 hp/mp 不变断言必 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, fetchSaveView, get } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

// ── 独立 oracle：主线链与 boss 名只从数据文件推导，不调被测引擎 ──
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
const CH1_TAIL = CH1_PATH[CH1_PATH.length - 1];
const CH1_BOSS_SCENE = ch1.scenes.find((s) => s.kind === "boss");
const CH2_BOSS_SCENE = ch2.scenes.find((s) => s.kind === "boss");
assert(CH1_BOSS_SCENE && CH2_BOSS_SCENE, "oracle: ch1/ch2 boss scene missing");
assert(CH1_PATH.includes(CH1_BOSS_SCENE.id), "oracle: ch1 boss scene must be on main chain");
const CH1_BOSS_IDX = CH1_PATH.indexOf(CH1_BOSS_SCENE.id);
const CH2_BOSS_IDX = CH2_PATH.indexOf(CH2_BOSS_SCENE.id);
// boss 真名：遭遇表与 boss 场景标题同源——用场景标题（数据文件）做独立
// 期望，避免从被测 encounterEngine 拿 oracle。
const CH1_BOSS_NAME = CH1_BOSS_SCENE.title;
const CH2_BOSS_NAME = CH2_BOSS_SCENE.title;
assert(CH1_BOSS_NAME && CH2_BOSS_NAME, "oracle: boss scene title missing");
const GATE_OPEN = /第\d+章「[^」]+」开启/;
const idxIn = (pathList, sceneId) => pathList.indexOf(sceneId);

const HEAL_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);
const hasHealer = (inv) => (inv || []).some((r) => r.qty > 0 && HEAL_IDS.has(r.item_id));

// 只点「前进」推进，交战也点「前进」（=撤离掷逃）——复现第 5 轮 A/B
// 双档实测的玩家路径。死亡回溯不重置目标，继续点。
async function advanceUntil(id, cond, { max = 400, tag = "advanceUntil" } = {}) {
  let cur = null;
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(id);
    if (cond(s)) return { cur, save: s };
    cur = await act(id, "前进");
  }
  fail(`${tag}: ${max} actions without reaching condition`);
}

// 真实清场：低血嗑药 → 有可放技能放技能 → 普攻。击杀或阵亡都算收敛。
async function fightOut(id, { max = 60 } = {}) {
  let cur = null;
  for (let i = 0; i < max; i++) {
    const { save: s, inventory } = await fetchSaveView(id);
    if (!s.combat) return cur;
    const low = s.hp > 0 && s.hp <= Math.max(30, s.max_hp * 0.35);
    const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
    cur = await act(id, low && hasHealer(inventory) ? "使用道具" : castable ? `释放技能 ${castable.name}` : "攻击");
  }
  fail("fightOut: combat did not converge");
}

// ── (a) 纯前进不可通章 ────────────────────────────────────────────
{
  const id = await makeSave("f096-no-kill");
  const { save: atTail } = await advanceUntil(id, (s) => s.scene === CH1_TAIL && !s.combat, {
    tag: "(a) reach ch1 tail",
  });
  assert(atTail.chapter === 1, `(a) chapter drifted before gate: ${atTail.chapter}`);
  const r = await act(id, "前进");
  assert(
    r.save.chapter === 1,
    `(a) gate let an unkilled-guardian save through: chapter ${r.save.chapter}`
  );
  assert(r.save.scene === CH1_TAIL, `(a) gate refusal moved scene: ${r.save.scene}`);
  assert(
    r.save.chapter_progress === atTail.chapter_progress,
    `(a) chapter_progress changed ${atTail.chapter_progress} -> ${r.save.chapter_progress}`
  );
  assert(
    r.reply.content.includes("守关者"),
    `(a) refusal missing 守关者 wording: ${r.reply.content.slice(-200)}`
  );
  assert(
    r.reply.content.includes(CH1_BOSS_NAME),
    `(a) refusal missing real boss name「${CH1_BOSS_NAME}」: ${r.reply.content.slice(-200)}`
  );
  assert(
    r.reply.content.includes("击败"),
    `(a) refusal must give an actionable next step (击败…): ${r.reply.content.slice(-200)}`
  );
  assert(!GATE_OPEN.test(r.reply.content), `(a) refusal leaked a chapter-open broadcast`);

  // ── (a2) 收尾补丁：拒绝零消耗——连点 6 次不得扣血、不得写日志 ──
  // 旧口径每次点击 HP-3/MP-2，连点 ~12 次即死亡回溯清空主线进度
  // （「门锁了还扣你血」死路）。新口径 patch 为 null、路由短路不写日志。
  const logLen = async () => {
    const { status, body } = await get(`/saves/${id}/log`);
    assert(status === 200 && body && Array.isArray(body.log), `(a2) log fetch failed (HTTP ${status})`);
    return body.log.length;
  };
  const log0 = await logLen();
  for (let i = 0; i < 6; i++) {
    const before = (await fetchSaveView(id)).save;
    const rr = await act(id, "前进");
    const s = rr.save;
    assert(s.hp === before.hp, `(a2) refusal drained hp on click ${i + 1}: ${before.hp} -> ${s.hp}`);
    assert(s.mp === before.mp, `(a2) refusal drained mp on click ${i + 1}: ${before.mp} -> ${s.mp}`);
    assert(s.chapter === before.chapter, `(a2) refusal moved chapter: ${before.chapter} -> ${s.chapter}`);
    assert(s.scene === before.scene, `(a2) refusal moved scene: ${before.scene} -> ${s.scene}`);
    assert(s.deaths === before.deaths, `(a2) refusal killed the player: deaths ${before.deaths} -> ${s.deaths}`);
    assert(
      rr.reply.content.includes("没有消耗体力"),
      `(a2) refusal reply missing 没有消耗体力 on click ${i + 1}: ${rr.reply.content.slice(-200)}`
    );
    assert(
      !rr.reply.content.includes("体力消耗"),
      `(a2) refusal reply leaked 体力消耗 wording: ${rr.reply.content.slice(-200)}`
    );
    assert(!GATE_OPEN.test(rr.reply.content), `(a2) refusal leaked a chapter-open broadcast`);
  }
  assert(
    (await logLen()) === log0,
    `(a2) refusal wrote log rows: ${log0} -> ${await logLen()}（没发生的事不写）`
  );
}

// ── (b) 交战中「前进」= 撤离，绝不推进主线 ────────────────────────
{
  const id = await makeSave("f096-combat-flee");
  let fledOk = false;
  // 允许多轮：撤离失败连吃反击可能阵亡回溯——回溯后重进 boss 房再来，
  // 直到至少观察到一次真实撤离成功（撤退到上一主线场景）。
  for (let round = 0; round < 6 && !fledOk; round++) {
    await advanceUntil(id, (s) => Boolean(s.combat && s.combat.enemy && s.combat.enemy.boss), {
      tag: "(b) reach boss combat",
    });
    for (let i = 0; i < 25; i++) {
      const before = (await fetchSaveView(id)).save;
      if (!before.combat) break;
      const r = await act(id, "前进");
      const s = r.save;
      assert(s.chapter === 1, `(b) combat-advance changed chapter: ${s.chapter}`);
      const newIdx = idxIn(CH1_PATH, s.scene);
      assert(
        newIdx === -1 || newIdx <= CH1_BOSS_IDX,
        `(b) combat-advance moved FORWARD past the guardian room: ${before.scene} -> ${s.scene}`
      );
      assert(
        r.reply.content.includes("撤离"),
        `(b) combat-advance reply missing 撤离 wording: ${r.reply.content.slice(-200)}`
      );
      assert(!GATE_OPEN.test(r.reply.content), `(b) combat-advance leaked a chapter-open broadcast`);
      if (!s.combat) {
        // 收敛只有两种诚实出路：撤离成功（撤退/原地脱离，hp>0）或阵亡回溯。
        if (s.hp > 0 && s.deaths === before.deaths) {
          fledOk = true;
          assert(
            s.encounter_clock < 0,
            `(b) F095 escape valve lost: encounter_clock ${s.encounter_clock} after boss flee`
          );
          assert(
            s.scene === CH1_PATH[CH1_BOSS_IDX - 1],
            `(b) boss flee should retreat to previous chain scene ${CH1_PATH[CH1_BOSS_IDX - 1]}, got ${s.scene}`
          );
        }
        break;
      }
      assert(s.combat.turn === before.combat.turn + 1, `(b) failed flee must consume a turn`);
    }
  }
  assert(fledOk, "(b) never observed a successful 撤离 within the retry budget");
}

// ── (c) 击杀 ch1 守关者后放行 ─────────────────────────────────────
{
  const id = await makeSave("f096-kill-pass");
  let cleared = null;
  for (let i = 0; i < 300 && !cleared; i++) {
    const { save: s } = await fetchSaveView(id);
    if (Array.isArray(s.boss_cleared) && s.boss_cleared.includes("ch1")) {
      cleared = s;
      break;
    }
    if (s.combat) await fightOut(id);
    else await act(id, "前进");
  }
  assert(cleared, "(c) never killed the ch1 guardian within budget");
  // 站到链尾再推：过门进 ch2 且落在 ch2 主线链首。
  await advanceUntil(id, (s) => s.scene === CH1_TAIL && !s.combat, { tag: "(c) reach ch1 tail" });
  const r = await act(id, "前进");
  assert(r.save.chapter === 2, `(c) gate should open after boss kill, chapter ${r.save.chapter}`);
  assert(
    r.save.scene === CH2_PATH[0],
    `(c) gate should land on ch2 chain head ${CH2_PATH[0]}, got ${r.save.scene}`
  );
  assert(GATE_OPEN.test(r.reply.content), `(c) missing chapter-open broadcast: ${r.reply.content.slice(-160)}`);

  // ── (d) ch2 同口径：未击杀守关者站链尾 → 不放行 ──────────────────
  // ch2 boss 房即链尾：进房强制开战 → 「前进」撤离撤回 penalty_gate →
  // 冷却期再进房不遇敌站上链尾 → 再推被门拦下。
  await advanceUntil(id, (s) => s.scene === CH2_PATH[CH2_BOSS_IDX] && Boolean(s.combat), {
    tag: "(d) reach ch2 boss combat",
  });
  // 撤离直到脱战（撤回上一场景）。
  for (let i = 0; i < 30; i++) {
    const { save: s } = await fetchSaveView(id);
    if (!s.combat) break;
    const r = await act(id, "前进");
    assert(r.save.chapter === 2, `(d) combat-advance changed chapter: ${r.save.chapter}`);
    const newIdx = idxIn(CH2_PATH, r.save.scene);
    assert(
      newIdx === -1 || newIdx <= CH2_BOSS_IDX,
      `(d) combat-advance moved forward: ${s.scene} -> ${r.save.scene}`
    );
    assert(r.reply.content.includes("撤离"), `(d) missing 撤离 wording`);
    assert(!GATE_OPEN.test(r.reply.content), `(d) leaked chapter-open broadcast`);
  }
  // 冷却期内再进 boss 房（不遇敌），站上链尾。
  await advanceUntil(id, (s) => s.scene === CH2_PATH[CH2_PATH.length - 1] && !s.combat, {
    tag: "(d) stand on ch2 tail",
  });
  const d = await act(id, "前进");
  assert(
    d.save.chapter === 2,
    `(d) ch2 gate let an unkilled-guardian save through: chapter ${d.save.chapter}`
  );
  assert(d.save.scene === CH2_PATH[CH2_PATH.length - 1], `(d) refusal moved scene: ${d.save.scene}`);
  assert(
    d.reply.content.includes("守关者") && d.reply.content.includes(CH2_BOSS_NAME),
    `(d) refusal must name「${CH2_BOSS_NAME}」: ${d.reply.content.slice(-200)}`
  );
  assert(!GATE_OPEN.test(d.reply.content), `(d) refusal leaked a chapter-open broadcast`);
}

ok("OK");
