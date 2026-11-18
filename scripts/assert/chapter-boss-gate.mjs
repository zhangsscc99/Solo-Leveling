#!/usr/bin/env node
// F096 章节门守关者校验 + 交战中「前进」=撤离不推进 + 收尾折返契约
// （全是行为断言）：
//
//   (a) 纯前进不可越过守关者：守关者未击杀时玩家位置不得越过 boss
//       场景（收尾等价口径）——新档只点「前进」（交战自动=撤离掷逃，
//       房内再推被出口零消耗拒回），60 步内 scene 永不落在守关房之后、
//       chapter 恒 1、守关战必然被触发过。
//   (b) 交战中「前进」不得推进：推进到 boss 房触发守关战，交战态连点
//       「前进」——每次响应 save.chapter 不变、save.scene 绝不越过
//       boss 房（只能停在本景或退到上一主线场景/回溯章首）、正文含
//       「撤离」、不含跨章开启播报；撤离成功后 boss 房再入冷却
//       （save.encounter_clock < 0，F095 逃生阀）照旧生效。
//   (c)/(h) 击杀后放行：真实打死 ch1 守关者（save.boss_cleared 含 ch1）
//       后站到链尾再推 → chapter === 2 且落到 ch2 主线链首场景。
//   (d) ch2 同口径：ch2 boss 房即链尾——房内守关者未击杀时「前进」
//       被出口零消耗拒回（refused、原地不动、不写日志，F106 口径），
//       「攻击」叫阵能把守关者逼回战场（逃生阀不没收「想打」的权利）。
//   (f) 章尾折返再战：save.scene 在本章主线链尾且守关者未击杀时，
//       「前进」不再只拒绝——折返回本章 boss 场景，落地即真打
//       （combat.enemy.name = 守关者真名）、encounter_clock 清零、
//       正常移动体力代价照付、saveView.advance_mode ===
//       "retreat_to_boss" 驱动前端换标「折返守关者」。
//   (g) 不再允许「穿过守关者」：boss 房撤离成功后再连点「前进」，
//       每次落点都不得越过 boss 场景（①冷却期进房不强制重遇=F095
//       逃生阀照旧；②房内出口被守关者封住一律零消耗拒回原地——
//       F106 口径，连点不再耗死；③房内「攻击」叫阵=主动挑战，守关战
//       当面成形）——怎么走都绕不过守关者。
//
//   (f)/(g) 注：收尾口径下「章尾+守关者未击杀」已无法由真实路径构造
//   ——「进 boss 房→撤离→继续前进」只能走到房内就被出口挡回，此状态
//   仅存于线上旧档（save 550 死路），故 (f)(d) 用 DB 落点复刻并在此注明。
//
//   F106 口径变更：房内「前进」由「退回上一景并扣体力」改为零消耗
//   refused（线上实测房内连点被原地耗死——见 FEATURES F106）。出路
//   只剩击败守关者：房内「攻击」= 主动叫阵（forceBoss 压过再入冷却），
//   (d)(g) 的再截停路径由「走回去再遇」改为「叫阵再战」。
//
//   变异敏感性：把 (1) 折返分支改回旧「拒绝」→ (f) 必 FAIL（scene 不动、
//   无 combat）；去掉 (2) 房内/越线拦截 → (a)(d)(g) 必 FAIL（位置越过
//   boss 场景）；房内拒绝退回「退位扣费」旧口径 → (d)(g) 的
//   refused/零消耗断言必 FAIL；给交战中「前进」重新接上 advanceOutcome
//   → (b) 的「scene 不得越过 boss 房」必 FAIL；折返分支不给
//   encounter_clock=0 或不传 forceBoss → (f) 的 combat/clock 断言必 FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, makeSave, act, fetchSaveView, get, advanceStep } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

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
    // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
    cur = await advanceStep(id);
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

// ── (a) 纯前进不可越过守关者 ────────────────────────────────────
// 收尾等价口径：守关者未击杀时位置不得越过 boss 场景——纯「前进」的
// 落点序列永远在守关房及其之前（撤离撤回上一景 / 冷却期进房被出口
// 挡回 / 冷却走尽被守关战截停），链尾只存在于守关者被击杀之后。
{
  const id = await makeSave("f096-no-kill");
  let sawBoss = false;
  for (let i = 0; i < 60; i++) {
    const r = await advanceStep(id);
    const s = r.save;
    assert(s.chapter === 1, `(a) advance crossed the chapter: ${s.chapter}`);
    const idx = idxIn(CH1_PATH, s.scene);
    assert(
      idx === -1 || idx <= CH1_BOSS_IDX,
      `(a) advance slipped past the guardian: ${s.scene} (idx ${idx} > ${CH1_BOSS_IDX})`
    );
    if (s.combat && s.combat.enemy && s.combat.enemy.boss) sawBoss = true;
    assert(!GATE_OPEN.test(r.reply.content), `(a) leaked a chapter-open broadcast`);
    const cleared = Array.isArray(s.boss_cleared) ? s.boss_cleared : [];
    assert(
      !cleared.includes("ch1"),
      "(a) pure 前进 must never kill the guardian (combat-advance is flee-only)"
    );
  }
  assert(sawBoss, "(a) 60 advances never met the guardian — the wall wasn't exercised");
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

// ── (c)/(h) 击杀 ch1 守关者后放行 ───────────────────────────────
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
    else await advanceStep(id);
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

  // ── (d) ch2 同口径：守关房即链尾，房内被出口零消耗拒回 ──────────
  // ch2 boss 房即链尾：守关者未击杀时人站在房内（DB 落点——该状态经
  // 冷却期穿房而来，收尾口径下真实路径已不可达）再推「前进」必须被
  // 守关者零消耗拒回（F106：旧口径退位扣费已废）；房内「攻击」叫阵
  // 则把守关者逼回战场（F095 逃生阀不没收「想打」的权利）。
  db.prepare("UPDATE saves SET scene = ?, encounter_clock = -1 WHERE id = ?").run(
    CH2_PATH[CH2_PATH.length - 1],
    id
  );
  // 过门落地可能掷出小怪遭遇——清掉交战态，复刻「冷却期穿房停在房内」的落点。
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  const d0 = (await fetchSaveView(id)).save;
  assert(
    d0.scene === CH2_PATH[CH2_PATH.length - 1] && d0.chapter === 2 && !d0.combat,
    `(d) setup broken: ${d0.scene} ch${d0.chapter}`
  );
  const d1 = await act(id, "前进");
  assert(d1.refused === true, `(d) in-room push must be refused, got: ${JSON.stringify(d1.refused)}`);
  assert(d1.save.chapter === 2, `(d) in-room push changed chapter: ${d1.save.chapter}`);
  assert(
    d1.save.scene === CH2_PATH[CH2_BOSS_IDX],
    `(d) sealed exit must keep the save inside ${CH2_PATH[CH2_BOSS_IDX]}, got ${d1.save.scene}`
  );
  assert(
    d1.save.hp === d0.hp && d1.save.mp === d0.mp,
    `(d) sealed-exit refusal must be free: ${d0.hp}/${d0.mp} -> ${d1.save.hp}/${d1.save.mp}`
  );
  assert(
    d1.reply.content.includes("守关者") || d1.reply.content.includes(CH2_BOSS_NAME),
    `(d) sealed-exit reply must name the guardian「${CH2_BOSS_NAME}」: ${d1.reply.content.slice(-200)}`
  );
  assert(
    !d1.reply.content.includes("体力消耗"),
    `(d) refused reply must not log a vitals cost: ${d1.reply.content.slice(-200)}`
  );
  assert(!GATE_OPEN.test(d1.reply.content), `(d) leaked a chapter-open broadcast`);
  // 「攻击」叫阵 = 主动挑战：守关者被逼回战场（forceBoss 压过再入冷却），
  // 这是房内玩家唯一的出路——拒绝不是死路。
  const reengaged = await act(id, "攻击");
  assert(
    reengaged.save.combat && reengaged.save.combat.enemy && reengaged.save.combat.enemy.boss,
    `(d) in-room challenge must start the guardian fight: ${JSON.stringify(reengaged.save.combat)}`
  );
  assert(
    reengaged.save.scene === CH2_PATH[CH2_BOSS_IDX],
    `(d) re-engagement should happen inside ${CH2_PATH[CH2_BOSS_IDX]}, got ${reengaged.save.scene}`
  );
  assert(
    reengaged.save.combat.enemy.name === CH2_BOSS_NAME,
    `(d) re-engaged enemy should be「${CH2_BOSS_NAME}」, got ${reengaged.save.combat.enemy.name}`
  );
}

// ── (f) 章尾折返再战 ────────────────────────────────────────────
// save.scene 在 ch1 主线链尾且守关者未击杀：DB 落点复刻线上 save 550
// 死路（收尾口径下真实路径不可达，见文件头注）。
{
  const id = await makeSave("f096-tail-retreat");
  db.prepare(
    "UPDATE saves SET scene = ?, boss_cleared_json = '[]', encounter_clock = -1 WHERE id = ?"
  ).run(CH1_TAIL, id);
  const view = await fetchSaveView(id);
  assert(
    view.save.scene === CH1_TAIL && !view.save.combat,
    `(f) setup broken: ${view.save.scene} combat=${JSON.stringify(view.save.combat)}`
  );
  // 主按钮模式由服务端按主线链位置下发——章尾守关者未击杀时必须给
  // retreat_to_boss（前端据此换标「折返守关者」，不猜场景）。
  assert(
    view.save.advance_mode === "retreat_to_boss",
    `(f) advance_mode should be "retreat_to_boss" at guarded tail, got ${view.save.advance_mode}`
  );
  const before = view.save;
  const r = await act(id, "前进");
  const s = r.save;
  assert(s.chapter === 1, `(f) retreat changed chapter: ${s.chapter}`);
  assert(
    s.scene === CH1_BOSS_SCENE.id,
    `(f) retreat should land on boss scene ${CH1_BOSS_SCENE.id}, got ${s.scene}`
  );
  assert(
    s.combat && s.combat.enemy && s.combat.enemy.boss === true,
    `(f) retreat landing must start the real guardian fight: ${JSON.stringify(s.combat)}`
  );
  assert(
    s.combat.enemy.name === CH1_BOSS_NAME,
    `(f) landing enemy should be「${CH1_BOSS_NAME}」, got ${s.combat.enemy && s.combat.enemy.name}`
  );
  assert(
    s.encounter_clock >= 0,
    `(f) boss-room re-entry cooldown must be cleared on landing, got ${s.encounter_clock}`
  );
  assert(
    r.reply.content.includes("折返") && r.reply.content.includes(`「${CH1_BOSS_SCENE.title}」`),
    `(f) retreat reply missing 折返/落点名: ${r.reply.content.slice(-200)}`
  );
  // 正常移动代价照付——折返是真走回去，不得是零消耗拒绝。
  assert(
    s.hp === before.hp - 3 && s.mp === before.mp - 2,
    `(f) retreat should cost normal movement vitals: ${before.hp}/${before.mp} -> ${s.hp}/${s.mp}`
  );
  assert(
    r.reply.content.includes("体力消耗"),
    `(f) retreat reply missing 体力消耗: ${r.reply.content.slice(-200)}`
  );
}

// ── (g) 不再允许「穿过守关者」────────────────────────────────────
// 真实路径：进 boss 房触发守关战 → 「前进」撤离成功（撤回上一景、挂
// 再入冷却）→ 再连点 3 次「前进」+ 持续跟进——每一步落点都不得越过
// 守关者，守关战必然再度当面成形。
{
  const id = await makeSave("f096-no-bypass");
  let fled = false;
  for (let round = 0; round < 6 && !fled; round++) {
    await advanceUntil(id, (s) => Boolean(s.combat && s.combat.enemy && s.combat.enemy.boss), {
      tag: "(g) reach boss combat",
    });
    for (let i = 0; i < 25 && !fled; i++) {
      const before = (await fetchSaveView(id)).save;
      if (!before.combat) break;
      const r = await act(id, "前进");
      const s = r.save;
      assert(
        s.chapter === 1,
        `(g) combat-advance changed chapter: ${s.chapter}`
      );
      if (!s.combat && s.hp > 0 && s.deaths === before.deaths) fled = true;
    }
  }
  assert(fled, "(g) never observed a successful boss flee within the retry budget");
  {
    const s = (await fetchSaveView(id)).save;
    assert(s.encounter_clock < 0, `(g) F095 escape valve lost: clock ${s.encounter_clock}`);
    assert(
      s.scene === CH1_PATH[CH1_BOSS_IDX - 1],
      `(g) boss flee should retreat to ${CH1_PATH[CH1_BOSS_IDX - 1]}, got ${s.scene}`
    );
  }
  // ① 冷却期再进 boss 房：F095 逃生阀照旧，不强制重遇同一守关者。
  const step1 = await act(id, "前进");
  assert(step1.save.chapter === 1, `(g) step1 changed chapter: ${step1.save.chapter}`);
  assert(
    step1.save.scene === CH1_BOSS_SCENE.id,
    `(g) step1 should land inside the boss room ${CH1_BOSS_SCENE.id}, got ${step1.save.scene}`
  );
  assert(
    !step1.save.combat || !step1.save.combat.enemy || !step1.save.combat.enemy.boss,
    `(g) step1: cooldown re-entry must not force the same boss`
  );
  // ② 房内再前进：出口被守关者封住——F106 零消耗拒回，连点多少次都
  // 原地不动、耗不死人；且每次回包都把 challenge_boss 出路带在身上
  // （F121：前端据此把主按钮换标「叫阵守关者」，房内不再是死路）。
  for (let k = 0; k < 4; k++) {
    const stepK = await act(id, "前进");
    assert(stepK.save.chapter === 1, `(g) sealed push#${k + 1} changed chapter: ${stepK.save.chapter}`);
    assert(
      stepK.refused === true,
      `(g) sealed push#${k + 1} must be refused, got ${JSON.stringify(stepK.refused)}`
    );
    assert(
      stepK.save.scene === CH1_BOSS_SCENE.id,
      `(g) sealed push#${k + 1} slipped out of ${CH1_BOSS_SCENE.id}: ${stepK.save.scene}`
    );
    assert(
      stepK.save.hp === step1.save.hp && stepK.save.mp === step1.save.mp,
      `(g) sealed push#${k + 1} was not free: ${step1.save.hp}/${step1.save.mp} -> ${stepK.save.hp}/${stepK.save.mp}`
    );
    assert(
      stepK.save.advance_mode === "challenge_boss",
      `(g) sealed push#${k + 1} must keep the challenge_boss exit: ${stepK.save.advance_mode}`
    );
  }
  // ③ 出路仍在：房内「攻击」叫阵把守关者逼回战场——拒绝不是死路。
  const reengaged = await act(id, "攻击");
  assert(
    reengaged.save.combat && reengaged.save.combat.enemy && reengaged.save.combat.enemy.boss,
    `(g) in-room challenge never re-engaged the guardian: ${JSON.stringify(reengaged.save.combat)}`
  );
  assert(
    reengaged.save.scene === CH1_BOSS_SCENE.id,
    `(g) re-engagement should happen inside ${CH1_BOSS_SCENE.id}, got ${reengaged.save.scene}`
  );
  assert(
    reengaged.save.combat.enemy.name === CH1_BOSS_NAME,
    `(g) re-engaged enemy should be「${CH1_BOSS_NAME}」, got ${reengaged.save.combat.enemy.name}`
  );
}

db.close();
ok("OK");
