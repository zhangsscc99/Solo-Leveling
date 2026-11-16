#!/usr/bin/env node
// F074 场景节点运行时契约（主线链口径）：
//   1) 新档 GET /saves/:id 即带 scene / scene_title / scene_index /
//      chapter_steps / chapter_total / chapter_progress / chapter_completed，
//      scene 为 ch1 主线链首场景，chapter_progress === "1/7"（7 = 链长，
//      支线场景 ch1_watch / ch1_death 不计入）。
//   2) POST /action {input:"前进"} 严格沿主线链推进 save.scene，
//      reply.content 必须含落点场景 text 的 ≥12 字原文片段，且不得含
//      「踩着碎石」模板句。（F124 口径：建档即写入链首——首推是章首
//      铺陈步落到第二幕；旧档 scene=NULL 才走自愈落点，见
//      new-save-first-advance.mjs。）
//   3) 连推 12 次：落点序列与独立推导的主线链逐位一致，chapter_steps
//      单调增（穿章时重置为 1 且 chapter+1）；落到链尾那一步
//      chapter_completed === true 且播报含「本章主线 N/N 完成」。
//   4) 链尾再推一次才过章节门：过门落到下一章链首（F117：过门零消耗、
//      scripted 不计步——下一章的步序从下一幕真实推进开始递增）。
//   期望值不经过被测的 chaptersEngine.chapterPath —— ch1 链 id 写死，
//   其余章节由本脚本直接读 chapters.json 沿 next_scene（缺失取首个指向
//   本章未到访场景的 choice.next）独立推导。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, get, makeSave, advanceTraverse } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

const TEMPLATE = "踩着碎石";
const stripWs = (s) => String(s || "").replace(/\s+/g, "");

// 场景正文也只从原始 JSON 取，整条断言不依赖被测引擎的任何函数。
const sceneTextById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneTextById.set(s.id, s.text);

// 独立 oracle：只读 chapters.json，不用引擎函数。
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

// ch1 主线链写死比对（审查点名）：支线 ch1_watch / ch1_death 不在其中。
const CH1_MAIN = [
  "ch1_double_gate",
  "ch1_law",
  "ch1_worship",
  "ch1_statues",
  "ch1_system",
  "ch1_awaken",
  "ch1_surface",
];
const chains = {};
for (const c of raw.chapters) chains[c.index] = deriveMainPath(c);
assert(
  JSON.stringify(chains[1]) === JSON.stringify(CH1_MAIN),
  `independent derivation disagrees with hardcoded ch1 chain: ${JSON.stringify(chains[1])}`
);
assert(chains[1].length === 7, `ch1 main chain should be 7 scenes, got ${chains[1].length}`);
assert(
  !chains[1].includes("ch1_watch") && !chains[1].includes("ch1_death"),
  "side scenes must not be on the main chain"
);

// 12 推的期望落点：新档已站在 ch1 链首（F124 建档写入真实场景），
// 首推 = 章首铺陈步落到链第二幕——ch1 链还剩 6 步 + 过门进 ch2 链 3 步
// （过门落链首计 1 步）+ 过门进 ch3 链 3 步。
const expected = [];
chains[1].slice(1).forEach((scene, i) =>
  expected.push({ chapter: 1, scene, steps: i + 2, total: 7 })
);
chains[2].slice(0, 3).forEach((scene, i) =>
  expected.push({ chapter: 2, scene, steps: i + 1, total: chains[2].length })
);
chains[3].slice(0, 3).forEach((scene, i) =>
  expected.push({ chapter: 3, scene, steps: i + 1, total: chains[3].length })
);
assert(expected.length === 12, "expected landing table misassembled");

const id = await makeSave("scene-advance");

// ── 1) 新档视图字段 ──────────────────────────────────────────────
{
  const { status, body } = await get(`/saves/${id}`);
  assert(status === 200 && body && body.save, `GET save failed (HTTP ${status})`);
  const s = body.save;
  assert(s.scene === CH1_MAIN[0], `fresh save scene should be ${CH1_MAIN[0]}, got ${s.scene}`);
  assert(s.scene_index === 0, `scene_index should be 0, got ${s.scene_index}`);
  assert(s.chapter_steps === 1, `chapter_steps should be 1, got ${s.chapter_steps}`);
  assert(s.chapter_total === 7, `chapter_total should be 7, got ${s.chapter_total}`);
  assert(s.chapter_progress === "1/7", `chapter_progress should be "1/7", got ${s.chapter_progress}`);
  assert(s.chapter_completed === false, "chapter_completed should be false on fresh save");
  assert(Array.isArray(s.next_choices), "next_choices must be an array");
}

// ── 2/3/4) 连推 12 个真实落点 ────────────────────────────────────
// 交战中「前进」= 撤离掷逃（失败原地挨回合，阵亡回溯章首）——每次逻辑
// 推进由 advanceTraverse 展开成真实操作序列（打得动的小怪就地击杀攒级
// 撑血线、其余掷逃、血危先嗑药/休息）。死亡回溯会把场景拉回章首——
// 不计入落点序列，继续推进直到精确落在期望场景才记一次。
const results = [];
for (let i = 0; i < expected.length; i++) {
  const exp = expected[i];
  let body = null;
  for (let t = 0; t < 40; t++) {
    body = await advanceTraverse(id, { fightCap: 8 });
    if (body.save.scene === exp.scene && body.save.chapter === exp.chapter) break;
  }
  assert(
    body && body.save.scene === exp.scene && body.save.chapter === exp.chapter,
    `push ${i + 1}: never reached ${exp.scene} (stuck at ${body && body.save.scene})`
  );
  results.push({ content: body.reply.content, save: body.save });
}

for (let i = 0; i < results.length; i++) {
  const { content, save } = results[i];
  const exp = expected[i];
  assert(save.chapter === exp.chapter, `push ${i + 1}: chapter ${save.chapter} != ${exp.chapter}`);
  assert(save.scene === exp.scene, `push ${i + 1}: scene ${save.scene} != ${exp.scene}`);
  assert(
    save.chapter_steps === exp.steps,
    `push ${i + 1}: chapter_steps ${save.chapter_steps} != ${exp.steps}`
  );
  assert(
    save.chapter_progress === `${exp.steps}/${exp.total}`,
    `push ${i + 1}: chapter_progress ${save.chapter_progress} != ${exp.steps}/${exp.total}`
  );
  // 落点场景真实 text 的 ≥12 字片段必须在正文里，模板句必须死绝。
  const text = sceneTextById.get(save.scene);
  assert(typeof text === "string", `push ${i + 1}: unknown landed scene ${save.scene}`);
  const frag = stripWs(text).slice(0, 12);
  assert(frag.length >= 12, `scene ${save.scene} text too short to verify`);
  assert(
    stripWs(content).includes(frag),
    `push ${i + 1}: reply does not contain scene text of ${save.scene}`
  );
  assert(!content.includes(TEMPLATE), `push ${i + 1}: fixed template sentence leaked`);
  // 链尾落点 = chapter_completed + 完成播报；其余步一律 false。
  const atEnd = exp.steps === exp.total;
  assert(
    save.chapter_completed === atEnd,
    `push ${i + 1}: chapter_completed ${save.chapter_completed} != ${atEnd}`
  );
  if (atEnd) {
    assert(
      content.includes(`本章主线 ${exp.total}/${exp.total} 完成`),
      `push ${i + 1}: missing 完成播报`
    );
  }
}

// 负向：12 段正文两两不重（同一段正文不得出现两次，含跨章）。
const texts = results.map((r) => r.content);
assert(new Set(texts).size === texts.length, "duplicate narration detected across pushes");

ok("OK");
