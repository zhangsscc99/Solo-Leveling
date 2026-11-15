#!/usr/bin/env node
// F074 场景节点运行时契约：
//   1) 新档 GET /saves/:id 即带 scene / scene_title / scene_index /
//      chapter_steps / chapter_total / chapter_progress / next_choices，
//      scene 为 ch1 主线首个场景，chapter_progress === "1/9"。
//   2) POST /action {input:"前进"} 必须真实推进 save.scene，reply.content
//      必须含落点场景 text 的 ≥12 字原文片段，且不得含「踩着碎石」模板句。
//      （新档首推是老存档自愈落点：scene 列由 NULL 写入本章首场景。）
//   3) 连推 12 次：每次落点场景与上一次不同、正文与上一次不同，
//      chapter_steps 在本章内单调增（穿章时重置为 1 且 chapter+1）。
//   4) 第 9 次推进后 chapter === 2 且落点场景属于 ch2。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, assert, ok, post, get, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chapters = require(path.join(ROOT, "server", "engine", "chapters.js"));

const TEMPLATE = "踩着碎石";
const stripWs = (s) => String(s || "").replace(/\s+/g, "");

const id = await makeSave("scene-advance");

// ── 1) 新档视图字段 ──────────────────────────────────────────────
{
  const { status, body } = await get(`/saves/${id}`);
  assert(status === 200 && body && body.save, `GET save failed (HTTP ${status})`);
  const s = body.save;
  const first = chapters.chapterPath(chapters.getChapter(1))[0];
  assert(s.scene === first.id, `fresh save scene should be ${first.id}, got ${s.scene}`);
  assert(s.scene_title === first.title, `scene_title missing/wrong: ${s.scene_title}`);
  assert(s.scene_index === 0, `scene_index should be 0, got ${s.scene_index}`);
  assert(s.chapter_steps === 1, `chapter_steps should be 1, got ${s.chapter_steps}`);
  assert(s.chapter_total === 9, `chapter_total should be 9, got ${s.chapter_total}`);
  assert(
    s.chapter_progress === "1/9",
    `chapter_progress should be "1/9", got ${s.chapter_progress}`
  );
  assert(Array.isArray(s.next_choices), "next_choices must be an array");
}

// ── 2/3/4) 连推 12 次 ────────────────────────────────────────────
const results = [];
for (let i = 0; i < 12; i++) {
  const { status, body } = await post("/action", { save_id: id, input: "前进" });
  assert(status === 200 && body && body.reply && body.save, `advance ${i + 1} failed (HTTP ${status})`);
  results.push({ content: body.reply.content, save: body.save });
}

// 每推：落点场景真实 text 的 ≥12 字片段必须在正文里，模板句必须死绝。
for (let i = 0; i < results.length; i++) {
  const { content, save } = results[i];
  const scene = chapters.getScene(save.scene);
  assert(scene, `push ${i + 1}: unknown landed scene ${save.scene}`);
  const frag = stripWs(scene.text).slice(0, 12);
  assert(frag.length >= 12, `scene ${scene.id} text too short to verify`);
  assert(
    stripWs(content).includes(frag),
    `push ${i + 1}: reply does not contain scene text of ${scene.id}`
  );
  assert(!content.includes(TEMPLATE), `push ${i + 1}: fixed template sentence leaked`);
}

// 第 1 推是自愈落点（写入首场景），第 2 推起每次都必须换场景、换正文、步数前进。
assert(
  results[0].save.scene === chapters.chapterPath(chapters.getChapter(1))[0].id,
  `push 1 should self-heal to first scene, got ${results[0].save.scene}`
);
for (let i = 1; i < results.length; i++) {
  const prev = results[i - 1].save;
  const cur = results[i].save;
  assert(
    cur.scene !== prev.scene,
    `push ${i + 1}: scene did not change (${cur.scene})`
  );
  assert(
    results[i].content !== results[i - 1].content,
    `push ${i + 1}: narration identical to previous`
  );
  const progressed =
    (cur.chapter === prev.chapter && cur.chapter_steps === prev.chapter_steps + 1) ||
    (cur.chapter === prev.chapter + 1 && cur.chapter_steps === 1);
  assert(
    progressed,
    `push ${i + 1}: chapter_steps not monotonic (${prev.chapter}:${prev.chapter_steps} -> ${cur.chapter}:${cur.chapter_steps})`
  );
}

// 负向：全部 12 段正文两两不重（同一段正文不得连续出现两次）。
const texts = results.map((r) => r.content);
assert(new Set(texts).size === texts.length, "duplicate narration detected across pushes");

// 第 9 推：跨过章节门进入第 2 章，落点属于 ch2。
{
  const s = results[8].save;
  const ch2 = chapters.getChapter(2);
  assert(s.chapter === 2, `after 9 pushes chapter should be 2, got ${s.chapter}`);
  assert(
    ch2.scenes.some((x) => x.id === s.scene),
    `after 9 pushes scene should belong to ch2, got ${s.scene}`
  );
}

ok("OK");
