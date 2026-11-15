#!/usr/bin/env node
// F075 章节门契约（主线链口径 + 软门显性化 + 负向覆盖）：
//   1) 新档 /saves/:id/ending 一律 409（未到 ch8_epilogue）。
//   2) 「观察」是免费环顾：scene / hp / mp 三不变（ch1_double_gate 与
//      ch1_law 两处都验——后者的 watch 分支 label 含「观察」字样，
//      正是上一轮把玩家传进 ch1_watch 的误命中点）。
//   3) 连推 7 次走满 ch1 主线链：chapter_progress === "7/7"，
//      chapter_completed === true，播报含「本章主线 7/7 完成」，仍在第 1 章。
//   4) 第 8 推过门进第 2 章：chapter_total = ch2 主线链长；
//      Lv1 软门显性化——播报含「等级未达 Lv.5」与压制提示，
//      save.chapter_unlock = {level:5, chapter:1, level_ok:false, hint:"需 Lv.5"}。
//   5) 双源一致：/saves/:id 的 chapter_steps / chapter_total 与
//      /saves/:id/quests 当前主线项 progress.current / target 逐位相同。
//   6) 负向终局：抵达 ch8_epilogue 后继续「前进」，回复不得重复结局正文。
//   期望值独立推导自 chapters.json，不调用被测引擎的 chapterPath。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, post, get, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

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
const EPILOGUE = "ch8_epilogue";
const epilogueFrag = stripWs(sceneTextById.get(EPILOGUE)).slice(0, 12);

async function advance(id) {
  const { status, body } = await post("/action", { save_id: id, input: "前进" });
  assert(status === 200 && body && body.reply && body.save, `advance failed (HTTP ${status})`);
  return body;
}

const id = await makeSave("chapter-gate");

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

// 观察负向：scene / hp / mp 必须三不变。
async function observeFree(tag) {
  const before = (await get(`/saves/${id}`)).body.save;
  const { status, body } = await post("/action", { save_id: id, input: "观察" });
  assert(status === 200 && body && body.reply && body.save, `${tag}: observe failed (HTTP ${status})`);
  const s = body.save;
  assert(s.scene === before.scene, `${tag}: 观察改写了 scene (${before.scene} -> ${s.scene})`);
  assert(s.hp === before.hp, `${tag}: 观察扣了 HP (${before.hp} -> ${s.hp})`);
  assert(s.mp === before.mp, `${tag}: 观察扣了 MP (${before.mp} -> ${s.mp})`);
  const frag = stripWs(sceneTextById.get(before.scene)).slice(0, 12);
  assert(stripWs(body.reply.content).includes(frag), `${tag}: observe reply missing scene text`);
}

// ── 1) 新档：ending 409 + 双源一致 ─────────────────────────────
{
  const { status } = await get(`/saves/${id}/ending`);
  assert(status === 409, `fresh save ending should be 409, got ${status}`);
  await dualSource("fresh");
}

// ── 2) 观察负向（两处场景）─────────────────────────────────────
await observeFree("observe@ch1_double_gate"); // choice[observe] label 含「观察」
await advance(id);
await advance(id); // 落在 ch1_law（旧版会误传送到 ch1_watch 的场景）
await observeFree("observe@ch1_law"); // choice[watch] label 含「观察」

// ── 3) 走满 ch1 主线链：再推 5 步到链尾 ────────────────────────
let last = null;
for (let i = 0; i < 5; i++) last = await advance(id);
{
  const s = last.save;
  assert(s.chapter === 1, `after ch1 chain chapter should be 1, got ${s.chapter}`);
  assert(s.scene === chains[1][6], `chain-end scene should be ${chains[1][6]}, got ${s.scene}`);
  assert(s.chapter_progress === "7/7", `chapter_progress should be "7/7", got ${s.chapter_progress}`);
  assert(s.chapter_completed === true, "chapter_completed should be true at chain end");
  assert(
    last.reply.content.includes("本章主线 7/7 完成"),
    `chain-end reply missing 完成播报: ${last.reply.content}`
  );
  await dualSource("ch1-end");
}

// ── 4) 链尾再推：过门进第 2 章，软门显性化 ────────────────────
{
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
  // Lv1 软门：放行但不得静默——播报与 saveView 都必须显性暴露。
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
  assert(cu.level_ok === false, `Lv1 into ch2 must expose level_ok === false, got ${cu.level_ok}`);
  assert(cu.hint === `需 Lv.${ch2Unlock.level}`, `chapter_unlock.hint should be 需 Lv.${ch2Unlock.level}, got ${cu.hint}`);
  await dualSource("ch2-enter");
}

// ── 5) 一路走到全篇终点（软门放行，沿途每章都应带压制提示）─────
let enteredCh3 = null;
{
  let save = null;
  for (let i = 0; i < 60; i++) {
    const { reply, save: s } = await advance(id);
    if (s.chapter === 3 && s.chapter_steps === 1 && !enteredCh3) enteredCh3 = reply.content;
    if (s.scene === EPILOGUE) {
      save = s;
      assert(
        reply.content.includes(`本章主线 ${chains[8].length}/${chains[8].length} 完成`),
        "epilogue arrival missing 完成播报"
      );
      break;
    }
    save = s;
  }
  assert(save && save.scene === EPILOGUE, `did not reach epilogue, stuck at ${save && save.scene}`);
  assert(save.cleared === true, "save.cleared should be true at epilogue");
}
assert(
  enteredCh3 && enteredCh3.includes(`等级未达 Lv.${raw.chapters.find((c) => c.index === 3).unlock.level}`),
  "ch3 gate reply missing its own 等级未达 hint"
);

// ── 6) 负向终局：结局正文只允许出现一次 ────────────────────────
for (let i = 0; i < 2; i++) {
  const { reply, save: s } = await advance(id);
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

ok("OK");
