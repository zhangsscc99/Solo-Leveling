#!/usr/bin/env node
// P203 观察探索进度契约（全是行为断言）：
//
//   线上实测（第 36 轮走查）：同一场景连点三次「环顾四周」，三次正文都好
//   且互不相同，但句尾三次逐字相同——「（仍可说「观察」再看一处，或说
//   「前进」）」。观察没有任何累计感，也从没给过实质线索。
//
//   断言（DB 落点 ch1_law——该场景无一次性发现物，三次观察都走实体细节
//   路径，契约面最干净；锻造取径与 action-prose-by-chapter 同源）：
//     a) 三次观察正文互不相同；
//     b) 元提示「仍可说「观察」再看一处」在同一存档内最多出现一次
//        （第 1 次），其后收束不得逐字复读该提示；
//     c) 第 2 次起正文带可见探索进度（「探索 2/3」形态），第 3 次含
//        探索 3/3 且带一条实质线索（【线索】段）；
//     d) 正文仍以「场景名」开头（「<narr_name>」——，F092/F178 契约不
//        打红）、不含「重新审视」；
//     e) 观察仍然免费：三次下来 HP/MP/scene/combat 全不变。
//
//   旧码红证：旧实现每次观察尾部都挂同一句 OBSERVE_TAIL——(b) 元提示
//   出现 3 次即 FAIL，(c) 无进度/线索同 FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 需与运行实例指向同一库（落点锻造直写 saves 表）。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

const OBSERVE_MARK = "仍可说「观察」再看一处";
const PROGRESS_RE = /探索\s*[23]\/3/;
const scene = CHAPTERS.chapters[0].scenes.find((s) => s.id === "ch1_law");
assert(scene, "oracle: ch1_law missing in chapters.json");
const narrName = scene.narr_name || scene.title;

const id = await makeSave("p203-obs");
{
  const db = new Database(dbPath);
  db.prepare("UPDATE saves SET scene = ? WHERE id = ?").run("ch1_law", id);
  db.close();
}
const s0 = (await fetchSaveView(id)).save;
assert(s0.scene === "ch1_law" && !s0.combat, `setup: 落点应为 ch1_law 且无交战: ${JSON.stringify({ scene: s0.scene, combat: s0.combat })}`);

const texts = [];
for (let i = 1; i <= 3; i++) {
  const r = await act(id, "环顾四周");
  const text = r.reply.content;
  texts.push(text);
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene && !r.save.combat,
    `(e) 第${i}次观察不再是免费环顾（hp/mp/scene/combat 被改动）`
  );
  assert(
    text.startsWith(`「${narrName}」——`),
    `(d) 第${i}次观察未以「${narrName}」——开头: ${text.slice(0, 60)}`
  );
  assert(!text.includes("重新审视"), `(d) 第${i}次观察回归旧模板句「重新审视」`);
  console.log(`    第${i}次观察：${text.replace(/\s+/g, "")}`);
}

// ── (a) 三次正文互不相同 ─────────────────────────────────────────
assert(
  new Set(texts).size === 3,
  `(a) 同一场景连续 3 次观察必须互不相同: ${JSON.stringify(texts.map((t) => t.slice(0, 40)))}`
);

// ── (b) 元提示同一存档内最多出现一次 ────────────────────────────
const metaHits = texts.filter((t) => t.includes(OBSERVE_MARK)).length;
assert(
  metaHits <= 1,
  `(b) 元提示「${OBSERVE_MARK}」在同一存档出现 ${metaHits} 次（应 ≤1）`
);
assert(
  texts[0].includes(OBSERVE_MARK),
  `(b) 第 1 次观察应携带一次性元提示「${OBSERVE_MARK}」: ${texts[0].slice(-80)}`
);

// ── (c) 可见进度 + 第 3 次实质线索 ──────────────────────────────
assert(
  /探索\s*2\/3/.test(texts[1]),
  `(c) 第 2 次观察应带探索进度「探索 2/3」: ${texts[1].slice(-80)}`
);
assert(
  /探索\s*3\/3/.test(texts[2]) && texts[2].includes("【线索】"),
  `(c) 第 3 次观察应带探索进度 3/3 与一条实质线索【线索】: ${texts[2].slice(-120)}`
);

ok("observe-exploration OK");
