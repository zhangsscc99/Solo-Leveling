#!/usr/bin/env node
// F075 章节门契约（主线链口径 + 软门显性化 + 负向覆盖）。
//
//   口径变更（F096）：章节门并入守关者击杀校验——交战中「前进」不再推进
//   （=撤离掷逃，守关战成功撤回上一主线场景），纯掷逃无法绕过守关者。
//   因此原「第 8 推过门进第 2 章」用例改为「先真实击杀 ch1 守关者再推
//   过门」；过门前置击杀是新增的硬门槛，不是放宽断言。
//   终章段同样变更：8 章全程练级通关（ch5–ch8 守关者等级 Lv.13–25）超出
//   本断言预算——合法推进实测到第 3 章后，与 ending-closure.mjs 同源用
//   DB 落点 ch8_aftermath（守关者全记的合法存档态），最后一推仍走真实
//   /action 落到 epilogue；抵达播报 / 通关字段 / 拒绝口径 / 结算门禁
//   全部照旧断言真实接口。
//
//   1) 新档 /saves/:id/ending 一律 409（未到 ch8_epilogue）。
//   2) 「观察」是免费环顾：scene / hp / mp 三不变（ch1_double_gate 与
//      ch1_law 两处都验——后者的 watch 分支 label 含「观察」字样，
//      正是上一轮把玩家传进 ch1_watch 的误命中点）。
//      F092/F101 口径变更：观察回复从「复读场景正文」改为「场景内短句
//      观察」——两次观察文本互不相同、单次 <120 字、标题取 scene_title
//      而非敌人名；负向上回包不得含场景正文前 12 字、不得与正文开头逐
//      字相同/是其逐字前缀，且长度必须 < 场景正文 50%（变异断言：复读
//      整幕判 FAIL）。
//   3) 走满 ch1 主线链：chapter_progress === "7/7"，
//      chapter_completed === true，播报含「本章主线 7/7 完成」，仍在第 1 章。
//      守关战必打（fightBoss）——击杀后才具备过门资格。
//   4) 链尾再推：ch1 守关者已击杀 → 过门进第 2 章：chapter_total = ch2
//      主线链长；Lv 软门显性化——播报含「等级未达 Lv.5」与压制提示，
//      save.chapter_unlock 带 {level:5, chapter:1, level_ok:false}。
//      F116 口径：软门放行不再以「能进门就是绿」收尾——过门前先断
//      /api/chapters 的 unlock.state === "soft"（地图不得写「锁定」）、
//      blocked_reasons 只含未达前置（已通关的前置章不得复列）、hint
//      由服务端下发并含「可强行进入」诚实表述。
//   5) 双源一致：/saves/:id 的 chapter_steps / chapter_total 与
//      /saves/:id/quests 当前主线项 progress.current / target 逐位相同。
//   6) 合法推进到第 3 章：ch2 守关者（链尾毒牙蛇）真实击杀后过门，
//      进门播报带「等级未达 Lv.10」压制提示。
//   7) 负向终局：抵达 ch8_epilogue 后继续「前进」，回复不得重复结局正文。
//   期望值独立推导自 chapters.json，不调用被测引擎的 chapterPath。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, fail, post, get, makeSave, act, clearCombat, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const sceneTextById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneTextById.set(s.id, s.text);

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

const chains = {};
for (const c of raw.chapters) chains[c.index] = deriveMainPath(c);
const CH2_LEN = chains[2].length;
const ch2Unlock = raw.chapters.find((c) => c.index === 2).unlock;
const ch3Unlock = raw.chapters.find((c) => c.index === 3).unlock;
const EPILOGUE = "ch8_epilogue";
const epilogueFrag = stripWs(sceneTextById.get(EPILOGUE)).slice(0, 12);
const HEAL_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);

// F096 合法推进驱动：守关战必打（不过门的硬门槛），小怪打得动就杀攒级
// 撑血线、其余「前进」掷逃（撤离不推进，只脱离交战）；自由点全堆体力
// 撑血池，血危先嗑药/休息。死亡回溯把场景拉回章首——不计入推进，
// 每次 advance 都等到场景或章节真实变化才返回。
const _geared = new Set();
async function advance(id, { fightCap = 8, max = 600 } = {}) {
  let prevSig = null;
  let stale = 0;
  for (let i = 0; i < max; i++) {
    const { save: s, inventory, equipment } = await fetchSaveView(id);
    const c = s.combat || {};
    const sig = [s.scene, s.chapter, s.hp, s.mp, s.level, c.seq, c.turn, c.enemy && c.enemy.hp].join("|");
    stale = sig === prevSig ? stale + 1 : 0;
    prevSig = sig;
    assert(stale < 6, `advance: stalled — state unchanged (scene=${s.scene} ch=${s.chapter})`);
    if (!_geared.has(id)) {
      _geared.add(id);
      const slots = [equipment && equipment.weapon && equipment.weapon.id, equipment && equipment.armor && equipment.armor.id];
      for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
        if ((inventory || []).some((r) => r.item_id === itemId && r.qty > 0) && !slots.includes(itemId)) {
          await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
        }
      }
    }
    if (s.free_points > 0) await post(`/saves/${id}/spend`, { stat: "vitality" });
    const hasHealer = (inventory || []).some((r) => r.qty > 0 && HEAL_IDS.has(r.item_id));
    if (s.combat) {
      const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
      const lowHp = s.hp > 0 && s.hp <= Math.max(30, s.max_hp * 0.35);
      const mobLv = 2 + 5 * (s.chapter - 1);
      const farmable = !isBoss && s.level < fightCap && mobLv <= s.level + 4 && s.hp > s.max_hp * 0.35;
      const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
      let input;
      if (lowHp && hasHealer) input = "使用道具";
      else if (isBoss || farmable) input = castable ? `释放技能 ${castable.name}` : "攻击";
      else input = "前进"; // 撤离掷逃：成功只脱离交战，不推进主线
      const r = await act(id, input);
      if (r.save.scene !== s.scene || r.save.chapter !== s.chapter) return r;
      continue;
    }
    // 残血先回血：休息配额优先，耗尽退回药水直补。
    if (s.hp > 0 && s.hp < s.max_hp * 0.9) {
      if (s.rest && s.rest.available === true) {
        await act(id, "休息");
        continue;
      }
      const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_IDS.has(r.item_id));
      if (heal) {
        const { status } = await post(`/saves/${id}/item`, { item_id: heal.item_id, op: "use" });
        if (status === 200) continue;
      }
    }
    return await act(id, "前进");
  }
  fail(`advance: ${max} actions without a scene change`);
}

const id = await makeSave("chapter-gate");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// 双源一致性：/saves/:id 与 /saves/:id/quests 对同一存档必须逐位相同。
async function dualSource(tag) {
  const [sv, qs] = await Promise.all([get(`/saves/${id}`), get(`/saves/${id}/quests`)]);
  assert(sv.status === 200 && qs.status === 200, `${tag}: dual-source fetch failed`);
  const s = sv.body.save;
  const main = qs.body.main.find((q) => q.chapter === s.chapter);
  assert(main && main.status === "active", `${tag}: active main quest missing for ch${s.chapter}`);
  assert(
    main.progress.current === s.chapter_steps,
    `${tag}: saves chapter_steps=${s.chapter_steps} vs quests current=${main.progress.current}`
  );
  assert(
    main.progress.target === s.chapter_total,
    `${tag}: saves chapter_total=${s.chapter_total} vs quests target=${main.progress.target}`
  );
}

// 观察负向：scene / hp / mp 必须三不变。交战中「观察」会被服务端改判
// 为战斗提示——先就地清场（原地击杀，不移动）再验。
// F092/F101 口径：观察是短句环顾而非复读正文——断言两次回复互不相同、
// 单次 <120 字、标题念 saveView.scene_title 而非敌人名；负向上回包不得
// 含场景正文前 12 字片段、不得与正文开头逐字相同、不得是正文逐字前缀，
// 且长度 < 场景正文 50%——实现改回整幕复读时本断言与变异断言同时 FAIL。
async function observeFree(tag) {
  const s0 = (await get(`/saves/${id}`)).body.save;
  const enemyName =
    s0.combat && s0.combat.enemy ? String(s0.combat.enemy.name || "") : "";
  if (s0.combat) await clearCombat(id);
  const before = (await get(`/saves/${id}`)).body.save;
  const sceneText = stripWs(sceneTextById.get(before.scene) || "");
  const frag = sceneText.slice(0, 12);
  const sceneTitle = stripWs(before.scene_title);
  const texts = [];
  for (let n = 1; n <= 2; n++) {
    const r = await post("/action", { save_id: id, input: "观察" });
    assert(
      r.status === 200 && r.body && r.body.reply && r.body.save,
      `${tag}: 第${n}次 observe failed (HTTP ${r.status})`
    );
    const s = r.body.save;
    assert(s.scene === before.scene, `${tag}: 第${n}次观察改写了 scene (${before.scene} -> ${s.scene})`);
    assert(s.hp === before.hp, `${tag}: 第${n}次观察扣了 HP (${before.hp} -> ${s.hp})`);
    assert(s.mp === before.mp, `${tag}: 第${n}次观察扣了 MP (${before.mp} -> ${s.mp})`);
    const c = stripWs(r.body.reply.content);
    // 负向（整幕复读特征，任一命中即 FAIL）：含正文前 12 字片段 / 与
    // 正文开头逐字相同 / 是正文逐字前缀 / 长度达到正文一半。
    assert(
      !c.includes(frag),
      `${tag}: 第${n}次观察回复与场景正文前12字完全相同——复读正文（含「${frag}」）: ${c.slice(0, 80)}`
    );
    assert(
      !(sceneText.startsWith(c) && [...c].length >= 12),
      `${tag}: 第${n}次观察回包是场景正文的逐字前缀（整幕复读）`
    );
    assert(
      [...c].length < [...sceneText].length * 0.5,
      `${tag}: 第${n}次观察复述了整幕正文（${[...c].length} >= ${[...sceneText].length}*0.5）`
    );
    assert(
      [...c].length < 120,
      `${tag}: 第${n}次观察回复超过 120 字（${[...c].length}）: ${c.slice(0, 80)}`
    );
    // 标题口径：「X」内必须念 saveView.scene_title；若进场前有交战，
    // 标题不得念敌人名（旧口径会把标题写成敌名）。
    assert(
      sceneTitle !== "" && c.includes(`「${sceneTitle}」`),
      `${tag}: 第${n}次观察标题必须念 scene_title「${before.scene_title}」: ${c.slice(0, 80)}`
    );
    assert(
      !(enemyName && stripWs(enemyName) !== sceneTitle && c.includes(`「${stripWs(enemyName)}」`)),
      `${tag}: 第${n}次观察标题念了敌人名「${enemyName}」而非 scene_title: ${c.slice(0, 80)}`
    );
    texts.push(c);
  }
  assert(
    texts[0] !== texts[1],
    `${tag}: 同场景连续两次观察文本必须不同，实际重文: ${texts[0].slice(0, 80)}`
  );
}

// ── 1) 新档：ending 409 + 双源一致 ─────────────────────────────
{
  const { status } = await get(`/saves/${id}/ending`);
  assert(status === 409, `fresh save ending should be 409, got ${status}`);
  await dualSource("fresh");
}

// ── 2) 观察负向（两处场景）─────────────────────────────────────
await observeFree("observe@ch1_double_gate"); // choice[observe] label 含「观察」
// F124 口径：新档建档即站在链首（不再是首推自愈落点）——一推即落
// ch1_law（旧版会误传送到 ch1_watch 的场景）。
await advance(id);
await observeFree("observe@ch1_law"); // choice[watch] label 含「观察」

// ── 3) 走满 ch1 主线链到链尾：守关战在途中被真实击杀 ────────────
// 撤离不推进——掷逃守关战会撤退回上一景，靠 F095 再入冷却穿房是旧口径；
// 本脚本让驱动在守关战里真打，沿途顺带击杀小怪攒级。
let tailReply = null;
for (let i = 0; i < 80; i++) {
  const r = await advance(id);
  const s = r.save;
  if (s.scene === chains[1][6]) {
    tailReply = r;
    break;
  }
}
assert(tailReply, `never reached ch1 tail, stuck at ${(await fetchSaveView(id)).save.scene}`);
{
  const s = tailReply.save;
  assert(s.chapter === 1, `after ch1 chain chapter should be 1, got ${s.chapter}`);
  assert(s.scene === chains[1][6], `chain-end scene should be ${chains[1][6]}, got ${s.scene}`);
  assert(s.chapter_progress === "7/7", `chapter_progress should be "7/7", got ${s.chapter_progress}`);
  assert(s.chapter_completed === true, "chapter_completed should be true at chain end");
  assert(
    tailReply.reply.content.includes("本章主线 7/7 完成"),
    `chain-end reply missing 完成播报: ${tailReply.reply.content}`
  );
  // F096：过门资格前置——ch1 守关者此时必须已被击杀（驱动全程真打守关战）。
  const cleared = Array.isArray(s.boss_cleared) ? s.boss_cleared : [];
  assert(
    cleared.includes("ch1"),
    `ch1 guardian must be killed before the gate push: boss_cleared=${JSON.stringify(cleared)}`
  );
  await dualSource("ch1-end");
}

// ── 4) 链尾再推：守关者已击杀 → 过门进第 2 章，软门显性化 ───────
// F116：过门前先断地图口径——level_ok:false 的软门在 /api/chapters 里
// 必须是 "soft"（不得写「锁定」），blocked_reasons 只列未达前置。
{
  const { save: s0 } = await fetchSaveView(id);
  if (s0.combat) await clearCombat(id);
  const mapRes = await get(`/chapters?save_id=${id}`);
  assert(mapRes.status === 200, `GET chapters for gate view failed (HTTP ${mapRes.status})`);
  const ch2Gate = mapRes.body.chapters.find((c) => c.index === 2);
  assert(ch2Gate && ch2Gate.unlock, "ch2 gate view missing from /chapters");
  assert(
    ch2Gate.unlock.state === "soft",
    `ch2 soft gate must report state "soft" (map must not say 锁定), got ${ch2Gate.unlock.state}`
  );
  assert(
    ch2Gate.unlock.level_ok === false && ch2Gate.unlock.chapter_ok === true,
    `ch2 gate legs should be level_ok=false chapter_ok=true: ${JSON.stringify(ch2Gate.unlock)}`
  );
  assert(
    typeof ch2Gate.unlock.hint === "string" && !ch2Gate.unlock.hint.includes("锁定"),
    `soft gate hint must not say 锁定: ${ch2Gate.unlock.hint}`
  );
  assert(
    /可强行进入|推荐/.test(ch2Gate.unlock.hint),
    `soft gate hint must honestly say 可强行进入/推荐: ${ch2Gate.unlock.hint}`
  );
  const reasons2 = ch2Gate.unlock.blocked_reasons || [];
  assert(
    reasons2.some((r) => r.includes(`Lv.${ch2Unlock.level}`)) &&
      !reasons2.some((r) => /完成第\d+章主线/.test(r)),
    `ch2 blocked_reasons must name only the unmet level leg: ${JSON.stringify(reasons2)}`
  );

  const { reply, save: s } = await advance(id);
  assert(s.chapter === 2, `after gate push chapter should be 2, got ${s.chapter}`);
  assert(s.chapter_total === CH2_LEN, `chapter_total should be ch2 chain ${CH2_LEN}, got ${s.chapter_total}`);
  assert(
    chains[2].includes(s.scene) && s.chapter_steps === 1,
    `gate push should land on ch2 chain head, got ${s.scene} (${s.chapter_steps})`
  );
  assert(
    reply.content.includes(`第2章`) && reply.content.includes("开启"),
    `gate reply missing 开启播报: ${reply.content}`
  );
  // 软门：放行但不得静默——播报与 saveView 都必须显性暴露。
  assert(
    reply.content.includes(`等级未达 Lv.${ch2Unlock.level}`),
    `gate reply missing 等级未达 hint: ${reply.content}`
  );
  assert(
    reply.content.includes("系统压制了传送门——继续任务/战斗提升等级"),
    `gate reply missing suppression text: ${reply.content}`
  );
  const cu = s.chapter_unlock;
  assert(cu && typeof cu === "object", "chapter_unlock missing from saveView");
  assert(cu.level === ch2Unlock.level, `chapter_unlock.level should be ${ch2Unlock.level}, got ${cu.level}`);
  assert(cu.chapter === ch2Unlock.chapter, `chapter_unlock.chapter should be ${ch2Unlock.chapter}, got ${cu.chapter}`);
  assert(cu.level_ok === false, `below-gate save must expose level_ok === false, got ${cu.level_ok}`);
  // F116：chapter_unlock 与 /api/chapters 同一事实源——软门三态 +
  // 服务端文案 + 未达前置（已满足的 chapter 腿不得复列）。
  assert(cu.state === "soft", `chapter_unlock.state should be "soft", got ${cu.state}`);
  assert(
    typeof cu.hint === "string" && !cu.hint.includes("锁定") && /可强行进入|推荐/.test(cu.hint),
    `chapter_unlock.hint must be honest soft-gate text (no 锁定): ${cu.hint}`
  );
  const cuReasons = cu.blocked_reasons || [];
  assert(
    cuReasons.some((r) => r.includes(`Lv.${ch2Unlock.level}`)) &&
      !cuReasons.some((r) => /完成第\d+章主线/.test(r)),
    `chapter_unlock.blocked_reasons must name only the unmet leg: ${JSON.stringify(cuReasons)}`
  );
  // 地图口径跨章复核：站在 ch2 里，ch3 的前置章腿已满足 → 同样 soft，
  // blocked_reasons 不得复列「完成第2章主线」。
  const mapAfter = await get(`/chapters?save_id=${id}`);
  const ch3Gate = (mapAfter.body.chapters || []).find((c) => c.index === 3);
  assert(
    ch3Gate && ch3Gate.unlock && ch3Gate.unlock.state === "soft",
    `ch3 gate from inside ch2 should be soft, got ${ch3Gate && ch3Gate.unlock && ch3Gate.unlock.state}`
  );
  const reasons3 = ch3Gate.unlock.blocked_reasons || [];
  assert(
    !reasons3.some((r) => r.includes(`第${ch3Unlock.chapter}章`)) &&
      reasons3.some((r) => r.includes(`Lv.${ch3Unlock.level}`)),
    `ch3 blocked_reasons must drop the satisfied chapter leg: ${JSON.stringify(reasons3)}`
  );
  await dualSource("ch2-enter");
}

// ── 5) 合法推进到第 3 章：ch2 守关者（链尾毒牙蛇）真杀后过门 ─────
// ch2 boss 场景即链尾：落点必触发守关战，驱动真打；击杀后站尾再推过门。
let enteredCh3 = null;
for (let i = 0; i < 120 && !enteredCh3; i++) {
  const { reply, save: s } = await advance(id);
  if (s.chapter === 3 && s.chapter_steps === 1) enteredCh3 = reply.content;
}
assert(enteredCh3, `never reached ch3 — ch2 gate stayed shut (leveling loop broke)`);
assert(
  enteredCh3.includes(`等级未达 Lv.${ch3Unlock.level}`),
  `ch3 gate reply missing its own 等级未达 hint: ${enteredCh3}`
);
await dualSource("ch3-enter");

// ── 6) 终章段：DB 落点 ch8_aftermath（守关者全记的合法态），最后一推
// 走真实 /action 落到 epilogue——抵达播报 / 通关字段照旧断言。 ─────
{
  db.prepare(
    "UPDATE saves SET chapter = 8, scene = ?, boss_cleared_json = ? WHERE id = ?"
  ).run("ch8_aftermath", JSON.stringify(raw.chapters.map((c) => c.id)), id);
  const { save: s0 } = await fetchSaveView(id);
  assert(s0.scene === "ch8_aftermath" && !s0.combat, `epilogue setup broken: ${s0.scene}`);
  const { reply, save } = await act(id, "前进");
  assert(save.scene === EPILOGUE, `final push should land on ${EPILOGUE}, got ${save.scene}`);
  assert(
    reply.content.includes(`本章主线 ${chains[8].length}/${chains[8].length} 完成`),
    "epilogue arrival missing 完成播报"
  );
  assert(save.cleared === true, "save.cleared should be true at epilogue");
}

// ── 7) 负向终局：结局正文只允许出现一次 ────────────────────────
for (let i = 0; i < 2; i++) {
  const { reply, save: s } = await act(id, "前进");
  assert(
    !stripWs(reply.content).includes(epilogueFrag),
    `post-ending push ${i + 1} repeated the epilogue text`
  );
  assert(
    reply.content.includes("终章"),
    `post-ending push ${i + 1} should give closing hint, got: ${reply.content}`
  );
  assert(s.scene === EPILOGUE && s.chapter === 8, `post-ending push ${i + 1} moved the save`);
}

// 已到结局场景：结算门禁应放行。
{
  const { status } = await get(`/saves/${id}/ending`);
  assert(status === 200, `ending should be 200 at epilogue, got ${status}`);
}

db.close();
ok("OK");
