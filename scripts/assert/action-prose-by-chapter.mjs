#!/usr/bin/env node
// F092 动作文案按章节分层 + 短句观察契约：
//
//   1) ch1 与 ch8 的「潜行」文本必须不同，且 ch8 文本不含「石像/石门/石砖」
//      等第 1 章石殿词——章节分层不得回落到 ch1 文案。
//   2) ch8「观察」单次 <120 字、同场景两次不同、不复读场景正文前 12 字、
//      回复长度 < 场景正文 50%（变异断言：整幕复读判 FAIL）。
//   3) 同章的观察与潜行文本互不重复。
//   4) 既有 HP/MP 语义未变：观察免费（scene/hp/mp 三不变）、潜行扣 MP-5
//      不扣 HP。
//
// ch8 存档构造：Lv1 合法推进到第 8 章超预算——与 chapter-gate.mjs 同源
// 用 DB 落点：POST /saves 建新档后直接 UPDATE saves（chapter=8,
// scene=ch8_jeju），服务端 DB_PATH 与本脚本 DB_PATH 需指向同一库
// （例：PORT=3089 DB_PATH=/tmp/sl-f092.db node server/index.js，
//   再 API_BASE=... DB_PATH=/tmp/sl-f092.db node 本脚本）。
// 端点默认 _http.mjs 的 API_BASE（3020），可用
//   API_BASE=http://127.0.0.1:3089/game/api 覆盖。连跑两次结果一致。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const sceneTextById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneTextById.set(s.id, s.text);

const CH1_FORBIDDEN = ["石像", "石门", "石砖"];
const OBSERVE_TITLE_RE = /你放慢呼吸，重新审视「(.+?)」/;

// 同一存档两次观察：返回 [c1, c2]（去空白文本），并断言免费口径。
async function observeTwice(id, tag) {
  const before = (await fetchSaveView(id)).save;
  const r1 = await act(id, "观察");
  const s1 = r1.save;
  assert(s1.scene === before.scene, `${tag}: 观察改写了 scene (${before.scene} -> ${s1.scene})`);
  assert(s1.hp === before.hp, `${tag}: 观察扣了 HP (${before.hp} -> ${s1.hp})`);
  assert(s1.mp === before.mp, `${tag}: 观察扣了 MP (${before.mp} -> ${s1.mp})`);
  const r2 = await act(id, "观察");
  const s2 = r2.save;
  assert(s2.scene === before.scene && s2.hp === before.hp && s2.mp === before.mp,
    `${tag}: 第二次观察不再是免费环顾（scene/hp/mp 被改动）`);
  const c1 = stripWs(r1.reply.content);
  const c2 = stripWs(r2.reply.content);
  const sceneText = stripWs(sceneTextById.get(before.scene) || "");
  const frag = sceneText.slice(0, 12);
  for (const [i, c] of [c1, c2].entries()) {
    assert([...c].length < 120, `${tag}: 第${i + 1}次观察 ≥120 字（${[...c].length}）: ${c.slice(0, 80)}`);
    assert(!c.includes(frag), `${tag}: 第${i + 1}次观察复读场景正文（含「${frag}」）`);
    assert(
      [...c].length < [...sceneText].length * 0.5,
      `${tag}: 第${i + 1}次观察复述整幕（${[...c].length} >= ${[...sceneText].length}*0.5）`
    );
    const m = c.match(OBSERVE_TITLE_RE);
    assert(m, `${tag}: 第${i + 1}次观察未取 scene_title 开头: ${c.slice(0, 60)}`);
    const scene = raw.chapters.flatMap((ch) => ch.scenes).find((sc) => sc.id === before.scene);
    assert(
      scene && stripWs(m[1]) === stripWs(scene.title),
      `${tag}: 观察标题「${m[1]}」不是当前场景标题「${scene && scene.title}」`
    );
  }
  assert(c1 !== c2, `${tag}: 同场景连续两次观察文本必须不同`);
  return [c1, c2];
}

async function sneak(id, tag) {
  const before = (await fetchSaveView(id)).save;
  const r = await act(id, "潜行");
  const s = r.save;
  const expectMp = Math.max(0, before.mp - 5);
  assert(s.mp === expectMp, `${tag}: 潜行应扣 MP-5（${before.mp} -> ${s.mp}，期望 ${expectMp}）`);
  assert(s.hp === before.hp, `${tag}: 潜行不得扣 HP (${before.hp} -> ${s.hp})`);
  return stripWs(r.reply.content);
}

// 正文行（去数值尾注），供跨章比对。
const sneakResult = (c) => c.split("\n")[0];

// ── ch1：新档天然落 ch1 主线链首 ─────────────────────────────────
const ch1 = await makeSave("prose-ch1");
const sneak1 = sneakResult(await sneak(ch1, "ch1"));
await observeTwice(ch1, "ch1");

// ── ch8：DB 落点构造合法存档（见文件头注释）───────────────────────
const ch8 = await makeSave("prose-ch8");
const db = new Database(dbPath);
db.prepare("UPDATE saves SET chapter = 8, scene = ? WHERE id = ?").run("ch8_jeju", ch8);
db.close();
{
  const s = (await fetchSaveView(ch8)).save;
  assert(s.chapter === 8 && s.scene === "ch8_jeju", `ch8 落点构造失败: ${JSON.stringify({ chapter: s.chapter, scene: s.scene })}`);
}

const sneak8Full = await sneak(ch8, "ch8");
const sneak8 = sneakResult(sneak8Full);

// 1) 章节分层：ch1 ≠ ch8 潜行文案；ch8 不得含石殿词
assert(sneak8 !== sneak1, `ch1 与 ch8 潜行文案相同（章节未分层）: ${sneak8}`);
for (const w of CH1_FORBIDDEN) {
  assert(!sneak8Full.includes(w), `ch8 潜行文案含第 1 章词「${w}」: ${sneak8Full}`);
}

// 2) ch8 观察：两次不同 / <120 / 不复读 / 免费（observeTwice 已全断言）
const [obs8a] = await observeTwice(ch8, "ch8");

// 3) 同章观察与潜行文本互不重复
assert(
  obs8a !== sneak8 && !sneak8Full.includes(obs8a) && !obs8a.includes(sneak8),
  `ch8 观察与潜行文本互相重复`
);

// 4) HP/MP 语义未变：观察免费已在 observeTwice 断言；潜行 MP-5/HP 不变
//    已在 sneak() 断言。

ok("OK");
