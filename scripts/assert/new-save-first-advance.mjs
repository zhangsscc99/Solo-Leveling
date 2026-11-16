#!/usr/bin/env node
// F124 新档首点契约（修法选型：建档即写入真实链首 + 章首铺陈步零消耗）：
//   a) POST /saves 之后 GET /saves/:id：save.scene 必须非 null 且等于
//      ch1 主线链首——「1/7」自此是真实站位而非自愈影子位；
//   b) 第一次 POST /action「前进」→ scene 真实变化（推进到链上第二幕）、
//      chapter_steps 严格 +1、回包不含【遭遇】、HP/MP 逐位不变、
//      无「体力消耗」注脚；
//   c) 每日「推进战线」不得空结算：daily_advance.progress.current 仍为 0
//      （scripted 铺陈步不产 advance 事件）；
//   d) 异常自愈同口径：DB 把 scene 置 NULL（旧档残留态）再「前进」→
//      落回链首、同样零消耗不掷遭遇——账本不写没发生的步数。
// 期望值独立推导自 chapters.json，不调用被测引擎的 chapterPath。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, get, post, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

// 独立 oracle：只读 chapters.json 沿 next_scene / choice.next 推导主线链。
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
const CH1_PATH = deriveMainPath(raw.chapters.find((c) => c.index === 1));
assert(CH1_PATH.length >= 2, `oracle: ch1 main chain too short (${CH1_PATH.length})`);
const ENTRY = CH1_PATH[0];
const SECOND = CH1_PATH[1];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

// ── a) 建档即写真实链首 ─────────────────────────────────────────
const id = await makeSave("f124-first");
const fresh = (await fetchSaveView(id)).save;
assert(fresh.scene === ENTRY, `fresh save.scene should be ${ENTRY}, got ${fresh.scene}`);
assert(
  fresh.chapter_steps === 1 && fresh.chapter_progress === `1/${CH1_PATH.length}`,
  `fresh progress should be 1/${CH1_PATH.length}, got ${fresh.chapter_progress}`
);
const dbRow = db.prepare("SELECT scene FROM saves WHERE id = ?").get(id);
assert(dbRow && dbRow.scene === ENTRY, `DB scene should be ${ENTRY}, got ${dbRow && dbRow.scene}`);

// ── b) 首推：真实位移 + 零消耗 + 不掷遭遇 ───────────────────────
const r = await act(id, "前进");
assert(
  r.save.scene === SECOND && r.save.scene !== fresh.scene,
  `first advance should move ${ENTRY} -> ${SECOND}, got ${fresh.scene} -> ${r.save.scene}`
);
assert(
  r.save.chapter_steps === fresh.chapter_steps + 1,
  `chapter_steps should increment ${fresh.chapter_steps} -> ${r.save.chapter_steps}`
);
assert(
  !r.reply.content.includes("【遭遇】"),
  `first advance must not roll an encounter: ${r.reply.content.slice(-200)}`
);
assert(
  r.save.hp === fresh.hp && r.save.mp === fresh.mp,
  `first advance must be free: HP/MP ${fresh.hp}/${fresh.mp} -> ${r.save.hp}/${r.save.mp}`
);
assert(
  !r.reply.content.includes("体力消耗"),
  `first advance must not print a vitals cost: ${r.reply.content.slice(-200)}`
);

// ── c) 每日「推进战线」不空结算 ─────────────────────────────────
const { status, body } = await get(`/saves/${id}/quests`);
assert(status === 200 && body && Array.isArray(body.daily), `GET quests failed (HTTP ${status})`);
const dailyAdvance = body.daily.find((q) => q.id === "daily_advance");
assert(dailyAdvance, "daily_advance quest missing");
assert(
  dailyAdvance.progress.current === 0,
  `scripted entry step must not settle 推进战线: ${JSON.stringify(dailyAdvance.progress)}`
);

// ── d) 旧档 NULL 自愈同口径：落回链首、零消耗、不掷遭遇 ──────────
const idB = await makeSave("f124-legacy");
db.prepare("UPDATE saves SET scene = NULL WHERE id = ?").run(idB);
const legacy = (await fetchSaveView(idB)).save;
const rb = await act(idB, "前进");
assert(
  rb.save.scene === ENTRY,
  `legacy NULL scene should self-heal to ${ENTRY}, got ${rb.save.scene}`
);
assert(
  rb.save.hp === legacy.hp && rb.save.mp === legacy.mp,
  `self-heal must be free: ${legacy.hp}/${legacy.mp} -> ${rb.save.hp}/${rb.save.mp}`
);
assert(
  !rb.reply.content.includes("【遭遇】") && !rb.reply.content.includes("体力消耗"),
  `self-heal must not roll encounter or print vitals cost: ${rb.reply.content.slice(-200)}`
);

db.close();
ok("OK");
