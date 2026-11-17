#!/usr/bin/env node
// F152 软门文案契约（全是行为断言）：
//
//   (a) Lv < 门限的存档越过 ch1→ch2 软门 → 回包正文不得含「压制了传送门」，
//       必须含「强行进入」或「推荐 Lv.」，且点名 chapters.json 里的真实
//       门限（unlock.level 单一事实源，不写死数值）；
//   (b) /api/chapters 该章 unlock.hint 与正文同一事实源——同含
//       「强行进入」，且不再用没有数值解释的「受压制」措辞。
//
//   落点/击杀标记锻造走 DB 直写（同 chapter-gate.mjs 取径）：ch1 主线链
//   尾 + 守关者已击杀 + 等级压门限之下——过门硬门槛（守关者已清、前置
//   章已抵达）全部真实满足，只剩等级软门。
//
//   旧码必红：旧正文写「等级未达 Lv.5，系统压制了传送门——继续任务/战斗
//   提升等级」→ (a) FAIL；旧 hint「可强行进入（受压制）」→ (b) FAIL。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, get, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);

// 主线链独立推导（与 chapter-gate.mjs 同一口径，不调用被测引擎）。
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

const ch1 = raw.chapters.find((c) => c.index === 1);
const ch2 = raw.chapters.find((c) => c.index === 2);
const ch1Tail = deriveMainPath(ch1).slice(-1)[0];
const GATE_LV = ch2.unlock.level;
const BELOW = Math.max(1, GATE_LV - 2);

const id = await makeSave("soft-gate-wording");
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, level = ?, boss_cleared_json = ? WHERE id = ?"
).run(ch1Tail, BELOW, JSON.stringify([ch1.id]), id);

const before = (await fetchSaveView(id)).save;
assert(
  before.scene === ch1Tail && before.chapter === 1 && before.level === BELOW && !before.combat,
  `setup broken: scene=${before.scene} ch=${before.chapter} lv=${before.level}`
);
assert(before.level < GATE_LV, `setup broken: level ${before.level} not below gate Lv.${GATE_LV}`);

// ── (a) 越过软门：正文不得再说「压制了传送门」────────────────────
const r = await act(id, "前进");
const content = r.reply.content || "";
assert(r.save.chapter === 2, `gate push should land chapter 2, got ${r.save.chapter}`);
assert(
  !content.includes("压制了传送门"),
  `(a) soft-gate reply still says 压制了传送门: ${content.slice(0, 200)}`
);
assert(
  /强行进入|推荐 Lv\./.test(content),
  `(a) soft-gate reply must say 强行进入/推荐 Lv.: ${content.slice(0, 200)}`
);
assert(
  content.includes(`Lv.${GATE_LV}`),
  `(a) reply must name the real gate level from chapters.json (Lv.${GATE_LV}): ${content.slice(0, 200)}`
);

// ── (b) /api/chapters hint 与正文同一事实源 ─────────────────────
const map = await get(`/chapters?save_id=${id}`);
assert(map.status === 200, `GET /chapters failed (HTTP ${map.status})`);
const ch2v = (map.body.chapters || []).find((c) => c.index === 2);
assert(ch2v && ch2v.unlock, "ch2 unlock view missing from /chapters");
assert(
  typeof ch2v.unlock.hint === "string" && ch2v.unlock.hint.includes("强行进入"),
  `(b) hint must share the 强行进入 wording with the crossing prose: ${ch2v.unlock.hint}`
);
assert(
  !ch2v.unlock.hint.includes("受压制") && !ch2v.unlock.hint.includes("压制了传送门"),
  `(b) hint must drop the unexplained 受压制 wording: ${ch2v.unlock.hint}`
);
assert(
  ch2v.unlock.hint.includes(`Lv.${GATE_LV}`),
  `(b) hint must name the real gate level from chapters.json (Lv.${GATE_LV}): ${ch2v.unlock.hint}`
);

db.close();
ok("OK");
