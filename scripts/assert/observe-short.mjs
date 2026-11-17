#!/usr/bin/env node
// F101 验收断言：「观察」短句口径独立 verify（与 chapter-gate.mjs 的
// observeFree 同口径，但独立成脚本——FEATURES.md 的 verify 行指向本文件）。
//
//   旧口径缺陷：`observeFree()` 曾断言「观察回复必须包含场景正文前 12
//   字」——等于把 F092 要消灭的「整幕复读」写成绿线（复读越多越绿）。
//   F092 修复后观察是「scene_title + 本章 prose 池短句」。本断言校验：
//     1) 新档同场景连发 3 次「观察」：三条文本两两不同（池 <3 条必红）；
//     2) 每条去空白后 < 120 字；
//     3) 每条标题念 saveView.scene_title——「X」内必须是场景显示名；
//     4) 负向（整幕复读特征，任一命中即 FAIL）：回包不得含场景正文
//        前 12 字片段、不得是场景正文的逐字前缀（≥12 字）、长度不得
//        达到正文 50%。
//   「观察」是免费环顾：scene / hp / mp 三不变、不得产生交战。
//
//   期望值独立推导：当前场景 id 取自 `GET /saves/:id` 回包，场景正文从
//   server/data/chapters.json 直读（不经引擎/不读回包文本）。旧码红证：
//   pre-F092 服务端「观察」= 标题行 + 整幕正文复读，命中断言 4。
//
// 用法（_http.mjs 默认 http://127.0.0.1:3020/game/api，用 API_BASE 覆盖）：
//   PORT=3094 DB_PATH=/tmp/fd22.db node server/index.js &
//   API_BASE=http://127.0.0.1:3094/game/api DB_PATH=/tmp/fd22.db \
//     node scripts/assert/observe-short.mjs
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const sceneById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneById.set(s.id, s);

const id = await makeSave("os"); // assert-os-<b36> ≤ 20 字，服务端同名 409 规避
const sv = await fetchSaveView(id);
const s0 = sv.save;
assert(s0 && s0.scene, "fresh save missing scene");
assert(!s0.combat, `fresh save unexpectedly in combat at ${s0.scene}`);

const scene = sceneById.get(s0.scene);
assert(scene && typeof scene.text === "string", `unknown scene ${s0.scene} in chapters.json`);
const sceneText = stripWs(scene.text);
const frag = sceneText.slice(0, 12);
const title = stripWs(s0.scene_title);
assert(title !== "", `saveView.scene_title missing at ${s0.scene}`);

const texts = [];
for (let i = 1; i <= 3; i++) {
  const { reply, save } = await act(id, "观察");
  assert(
    save.scene === s0.scene && !save.combat,
    `第${i}次观察改动了世界（scene=${save.scene} combat=${!!save.combat}）`
  );
  assert(
    save.hp === s0.hp && save.mp === s0.mp,
    `第${i}次观察扣了 HP/MP（${s0.hp}/${s0.mp} -> ${save.hp}/${save.mp}）`
  );
  const c = stripWs(reply.content);
  // 负向断言先行（整幕复读特征）：旧码在这里直接红。
  assert(
    !c.includes(frag),
    `第${i}次观察回包与场景正文前12字完全相同——整幕复读（含「${frag}」）: ${c.slice(0, 80)}`
  );
  assert(
    !(sceneText.startsWith(c) && [...c].length >= 12),
    `第${i}次观察回包是场景正文的逐字前缀（${[...c].length} 字，整幕复读特征）`
  );
  assert(
    [...c].length < [...sceneText].length * 0.5,
    `第${i}次观察复述了整幕正文（${[...c].length} >= ${[...sceneText].length}*0.5）`
  );
  assert(
    [...c].length < 120,
    `第${i}次观察 ≥120 字（${[...c].length}）: ${c.slice(0, 80)}`
  );
  assert(
    c.includes(`「${title}」`),
    `第${i}次观察标题必须念 scene_title「${title}」: ${c.slice(0, 80)}`
  );
  texts.push(c);
}
assert(
  new Set(texts).size === 3,
  `同场景连续 3 次观察必须两两不同，实际: ${JSON.stringify(texts.map((t) => t.slice(0, 40)))}`
);

ok("OK");
