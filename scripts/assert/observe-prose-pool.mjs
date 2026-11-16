#!/usr/bin/env node
// F133 场景叙述名 + 观察文案池契约：
//
//   (a) 同一场景连续 3 次「环顾四周」回复文本互不相同（按存档观察计数轮转，
//       池 <3 条时本断言必 FAIL——池被缩减回 2 条的变异在这里炸出来）。
//   (b) 任一观察回复不得出现「玩家」/TODO/undefined——title 是内部占位串
//       的场景必须走 narr_name，缺了 narr_name 就会念出内部串（变异：把
//       ch1_awaken 的 narr_name 删掉，本断言在 (d1) 与运行时双双 FAIL）。
//   (c) 单次回复 <120 字（含「你放慢呼吸，重新审视「X」。」前缀），且不
//       复读场景正文——不得包含场景正文前 12 字。
//   (d) 变异敏感（不自指假绿）：
//       d1) 静态数据：任何 title 命中占位黑名单的场景必须带非占位
//           narr_name；删掉 narr_name → FAIL。
//       d2) 数据层：prose 池每章 observe ≥4 条；缩减回 2 条 → FAIL。
//       d3) 引擎层：validateChapters 必须拒绝 narr_name=占位串的注入
//           （变异数据现场构造，白名单被删/放宽时 FAIL）。
//       d4) 运行时：ch1_awaken 的观察回复必须念 narr_name「冰冷的石殿」，
//           且 saveView.scene_title 与正文同源（API 字段不变名、走新口径）。
//
// 存档构造与 action-prose-by-chapter.mjs 同源：POST /saves 建新档后 sqlite
// 直改 scene 落点（服务端 DB_PATH 与本脚本 DB_PATH 需指向同一库，例：
//   PORT=3089 DB_PATH=/tmp/sl-f133.db node server/index.js
//   API_BASE=http://127.0.0.1:3089/game/api DB_PATH=/tmp/sl-f133.db \
//     node scripts/assert/observe-prose-pool.mjs）。
// 端点默认 _http.mjs 的 API_BASE（3020），允许 API_BASE 覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const proseEngine = require(path.join(ROOT, "server", "engine", "prose.js"));
const chaptersEngine = require(path.join(ROOT, "server", "engine", "chapters.js"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const sceneById = new Map();
for (const c of raw.chapters) for (const s of c.scenes) sceneById.set(s.id, s);

const FORBIDDEN_RE = /「玩家」|TODO|undefined/i;
const PLACEHOLDER = new Set(["玩家", "todo", "undefined", "null", "test", "占位"]);

// ── (d2) 数据层：每章 observe 池 ≥4 条 + GENERIC 兜底同口径 ─────────
for (const idx of [1, 2, 3, 4, 5, 6, 7, 8]) {
  const pool = proseEngine.poolFor(idx).observe;
  assert(
    Array.isArray(pool) && pool.length >= 4,
    `ch${idx} observe 池应 ≥4 条，实际 ${Array.isArray(pool) ? pool.length : "非数组"}`
  );
}
assert(
  proseEngine.GENERIC.observe.length >= 4,
  `GENERIC observe 池应 ≥4 条，实际 ${proseEngine.GENERIC.observe.length}`
);

// ── (d1) 静态数据：title 是占位串的场景必须有合法 narr_name ──────────
for (const scene of sceneById.values()) {
  if (PLACEHOLDER.has(String(scene.title || "").trim().toLowerCase())) {
    assert(
      typeof scene.narr_name === "string" &&
        scene.narr_name.trim() !== "" &&
        !PLACEHOLDER.has(scene.narr_name.trim().toLowerCase()),
      `${scene.id}：title「${scene.title}」是占位串但 narr_name 缺失/仍是占位（${JSON.stringify(scene.narr_name)}）`
    );
  }
}

// ── (d3) 引擎层：narr_name=占位串必须被 load 校验拒绝 ────────────────
{
  const mutated = JSON.parse(JSON.stringify(raw));
  mutated.chapters[0].scenes.find((s) => s.id === "ch1_double_gate").narr_name = "玩家";
  const r = chaptersEngine.validateChapters(mutated);
  assert(!r.ok && r.errors.some((e) => e.includes("narr_name")), "变异注入 narr_name=玩家 必须校验失败");
  for (const bad of ["TODO", "undefined"]) {
    const m2 = JSON.parse(JSON.stringify(raw));
    m2.chapters[0].scenes.find((s) => s.id === "ch1_double_gate").narr_name = bad;
    const r2 = chaptersEngine.validateChapters(m2);
    assert(!r2.ok, `变异注入 narr_name=${bad} 必须校验失败`);
  }
  // 反向护栏：真数据本身必须过校验（白名单不能误伤现状）。
  const real = chaptersEngine.validateChapters(raw);
  assert(real.ok, `真数据校验应通过: ${real.errors.join("; ")}`);
}

// 同一场景连续 3 次「环顾四周」：全部断言 (a)(b)(c)，返回文本数组。
async function observeThrice(id, tag, sceneId) {
  const sv = await fetchSaveView(id);
  assert(
    sv.save.scene === sceneId,
    `${tag}: 落点应为 ${sceneId}，实际 ${sv.save.scene}（combat=${!!sv.save.combat}）`
  );
  const scene = sceneById.get(sceneId);
  const sceneFrag = stripWs(scene.text).slice(0, 12);
  const texts = [];
  for (let i = 0; i < 3; i++) {
    const { reply, save } = await act(id, "环顾四周");
    assert(
      save.scene === sceneId && !save.combat,
      `${tag}: 第${i + 1}次观察改动了世界（scene=${save.scene} combat=${!!save.combat}）`
    );
    const c = stripWs(reply.content);
    assert(!FORBIDDEN_RE.test(c), `${tag}: 第${i + 1}次观察含占位串: ${c.slice(0, 80)}`);
    assert(
      [...c].length < 120,
      `${tag}: 第${i + 1}次观察 ≥120 字（${[...c].length}）: ${c.slice(0, 80)}`
    );
    assert(
      !c.includes(sceneFrag),
      `${tag}: 第${i + 1}次观察复读场景正文（含「${sceneFrag}」）`
    );
    texts.push(c);
  }
  assert(
    new Set(texts).size === 3,
    `${tag}: 同一场景连续 3 次观察必须互不相同，实际: ${JSON.stringify(texts)}`
  );
  return texts;
}

// ── 运行时 (a)(b)(c)：新档天然落 ch1 链首 ──────────────────────────
const s1 = await makeSave("observe-pool-ch1");
await observeThrice(s1, "ch1_double_gate", "ch1_double_gate");

// ── (d4) ch1_awaken：title=「玩家」的场景必须念 narr_name ────────────
const s2 = await makeSave("observe-pool-awaken");
{
  const db = new Database(dbPath);
  db.prepare("UPDATE saves SET scene = ? WHERE id = ?").run("ch1_awaken", s2);
  db.close();
  const sv = await fetchSaveView(s2);
  assert(
    sv.save.scene === "ch1_awaken",
    `ch1_awaken 落点构造失败: scene=${sv.save.scene}`
  );
  // API 字段不变名：scene_title 仍表示显示名，但口径走 narr_name。
  const expectName = sceneById.get("ch1_awaken").narr_name;
  assert(
    sv.save.scene_title === expectName,
    `scene_title 应走 narr_name 口径「${expectName}」，实际「${sv.save.scene_title}」`
  );
  const texts = await observeThrice(s2, "ch1_awaken", "ch1_awaken");
  for (const c of texts) {
    assert(
      c.includes(`「${expectName}」`),
      `ch1_awaken 观察必须念叙述名「${expectName}」而非内部 title: ${c.slice(0, 80)}`
    );
  }
}

ok("OK");
