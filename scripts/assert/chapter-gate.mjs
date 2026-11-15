#!/usr/bin/env node
// F075 第1章 9 步章节门契约：
//   1) 新档连推 8 次「前进」后仍在第 1 章，chapter_progress === "8/9"，
//      且 next_choices 非空。
//   2) 第 9 次推进跨过章节门：chapter === 2，chapter_total 为 ch2 场景数。
//   3) /saves/:id/ending 在未到 ch8_epilogue 时一律 409（新档与第 2 章都验）。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API, assert, ok, post, get, makeSave } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const chapters = require(path.join(ROOT, "server", "engine", "chapters.js"));

const id = await makeSave("chapter-gate");

// 新档：未抵结局场景，结算门禁必须 409。
{
  const { status } = await get(`/saves/${id}/ending`);
  assert(status === 409, `fresh save ending should be 409, got ${status}`);
}

// 前 8 推：仍在第 1 章，进度走到 8/9。
let save = null;
for (let i = 0; i < 8; i++) {
  const { status, body } = await post("/action", { save_id: id, input: "前进" });
  assert(status === 200 && body && body.save, `advance ${i + 1} failed (HTTP ${status})`);
  save = body.save;
}
assert(save.chapter === 1, `after 8 pushes chapter should be 1, got ${save.chapter}`);
assert(
  save.chapter_progress === "8/9",
  `after 8 pushes chapter_progress should be "8/9", got ${save.chapter_progress}`
);
assert(
  Array.isArray(save.next_choices) && save.next_choices.length > 0,
  "next_choices must be non-empty at 8/9"
);

// 第 9 推：过门进入第 2 章，chapter_total 换成 ch2 的场景数。
{
  const { status, body } = await post("/action", { save_id: id, input: "前进" });
  assert(status === 200 && body && body.save, `advance 9 failed (HTTP ${status})`);
  save = body.save;
  const ch2 = chapters.getChapter(2);
  assert(save.chapter === 2, `after 9 pushes chapter should be 2, got ${save.chapter}`);
  assert(
    save.chapter_total === ch2.scenes.length,
    `chapter_total should be ch2 scene count ${ch2.scenes.length}, got ${save.chapter_total}`
  );
  assert(
    ch2.scenes.some((x) => x.id === save.scene),
    `scene should belong to ch2, got ${save.scene}`
  );
}

// 已进入第 2 章但仍未到 ch8_epilogue：结算门禁仍须 409。
{
  const { status } = await get(`/saves/${id}/ending`);
  assert(status === 409, `ending should still be 409 before epilogue, got ${status}`);
}

ok("OK");
