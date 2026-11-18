#!/usr/bin/env node
// F220 行动-叙事矛盾契约（点「探索前进」却被正文写成没动）：
//   CHAPTER_ENTRY_NOTES 注脚挂在「探索前进」的落地回包里——正文必须
//   与向前推进自洽，禁止「原地/听风/未耗」这类未推进措辞。
//
//   Part A · 新档从首屏起连点「前进」（= 前端「探索前进」按钮的
//     input，与 _http.mjs advanceStep 同一语义），直到落入 must_choose
//     门或安全上限 12 次：每次真实推进（非 refused）的回包新增正文
//     断言三禁词零命中；stage（save 无 stage 字段——用
//     chapter×100+chapter_steps 合成，chapter_steps 跨章归零故章序
//     放大保底）逐次打印且单调不减。被拒的点击不是推进（must_choose
//     门零位移零消耗），只核停落点、不计入推进步；首屏建档的旁白
//     日志同口径自检。
//   Part B · 注脚池按章轮换，Part A 只会命中 ch1 那一版——逐章锻造
//     「站本章主线链首」的存档（DB 直写 chapter/scene，同
//     chapter-unlock-single-source.mjs 取径），各点一次「前进」走真
//     实 /action：四版注脚 + 守关房变体全部覆盖，断言三禁词零命中
//     且真实落到本章链上第二幕。
//
//   自起隔离实例：临时端口 + 临时 DB_PATH，不打线上、不占 3020；
//   不依赖 AI（POST /action 规则解析「前进」是确定性路径）。
//   旧码红证：注脚池任一条回退「立在原地听风/未耗一丝力气」版本，
//   Part A 首点或 Part B 对应章必 FAIL，并点名点击序/章号与命中词。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f220-advance-"));
const DB_FILE = path.join(tmpDir, "game.db");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
process.env.API_BASE = `http://127.0.0.1:${PORT}/game/api`;
process.env.DB_PATH = DB_FILE;

const { assert, ok, fail, get, makeSave, act, fetchSaveView, mustChoosePick } = await import(
  "./_http.mjs"
);
const Database = require("better-sqlite3");

// ── 隔离实例：临时端口 + 临时库，进程退出即收尸 ─────────────────
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE },
  stdio: ["ignore", "pipe", "pipe"],
});
let childErr = "";
child.stderr.on("data", (d) => {
  childErr += d.toString();
});
function cleanup() {
  try {
    child.kill();
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

{
  const deadline = Date.now() + 20000;
  let up = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const r = await fetch(`${process.env.API_BASE}/health`);
      if (r.status === 200) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  assert(up, `isolated server did not come up on :${PORT} :: ${childErr.slice(-400)}`);
}

const db = new Database(DB_FILE);
db.pragma("foreign_keys = ON");

const BANNED = ["原地", "听风", "未耗"];
const hitBanned = (prose) => BANNED.filter((w) => prose.includes(w));

// 本回包新增正文：多行战报（replies）与单行（reply）同一口径拼接。
function newProse(r) {
  const rows = Array.isArray(r.replies) && r.replies.length ? r.replies : [r.reply];
  return rows.map((x) => String((x && x.content) || "")).join("\n");
}

// stage：save 无 stage 字段——chapter×100+chapter_steps 合成单调序。
const stageOf = (s) => Number(s.chapter) * 100 + Number(s.chapter_steps);

// 主线链独立推导（与 new-save-first-advance.mjs 同一口径，不经被测引擎）。
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

// ── Part A：新档首屏起连点「探索前进」直到 must_choose ────────────
const id = await makeSave("f220-copy");
const fresh = (await fetchSaveView(id)).save;
let prevStage = stageOf(fresh);

// 首屏建档步：开场旁白（narrator 日志）同样不得写「没动」。
{
  const { status, body } = await get(`/saves/${id}/log`);
  assert(status === 200 && body && Array.isArray(body.log), `GET log failed (HTTP ${status})`);
  const opening = body.log.map((r) => String(r.content || "")).join("\n");
  const hits = hitBanned(opening);
  assert(
    !hits.length,
    `first-screen prose has banned word(s) ${hits.join("/")} :: ${opening.slice(-240)}`
  );
}
console.log(
  `[click 0] fresh stage=${prevStage} scene=${fresh.scene} progress=${fresh.chapter_progress}`
);

let realAdvances = 0;
let hitMustChoose = false;
for (let i = 1; i <= 12; i++) {
  const r = await act(id, "前进");
  const s = r.save;
  const stage = stageOf(s);
  const prose = newProse(r);
  console.log(
    `[click ${i}] stage=${prevStage}->${stage} scene=${s.scene} refused=${r.refused === true}`
  );
  assert(
    stage >= prevStage,
    `click ${i}: stage regressed ${prevStage} -> ${stage} (scene=${s.scene} progress=${s.chapter_progress})`
  );
  prevStage = stage;
  if (r.refused === true) {
    // must_choose 门是契约终点（零位移零消耗）；其它拒绝属于推进死路。
    if (mustChoosePick(s.scene)) {
      hitMustChoose = true;
      break;
    }
    fail(
      `click ${i}: advance refused but scene ${s.scene} is not a must_choose gate :: ${prose.slice(-240)}`
    );
  }
  const hits = hitBanned(prose);
  assert(
    !hits.length,
    `click ${i}: advance prose says player didn't move — banned word(s) ${hits.join("/")} :: ${prose.slice(-240)}`
  );
  realAdvances++;
  // 遭遇开局后「前进」语义变掷逃（非确定性），超出本断言口径。
  if (s.combat) break;
}
assert(realAdvances >= 1, "no real advance step was exercised");
assert(hitMustChoose, `never reached must_choose within cap (realAdvances=${realAdvances})`);

// ── Part B：逐章链首锻造，四版注脚 + 守关房变体全覆盖 ─────────────
for (const c of raw.chapters) {
  const chain = deriveMainPath(c);
  assert(chain.length >= 2, `ch${c.index} main chain too short (${chain.length})`);
  const sid = await makeSave(`f220-ch${c.index}`);
  db.prepare("UPDATE saves SET chapter = ?, scene = ? WHERE id = ?").run(c.index, chain[0], sid);
  const r = await act(sid, "前进");
  const prose = newProse(r);
  assert(
    r.refused !== true,
    `ch${c.index}: head advance refused :: ${prose.slice(-240)}`
  );
  const hits = hitBanned(prose);
  assert(
    !hits.length,
    `ch${c.index} entry step: banned word(s) ${hits.join("/")} :: ${prose.slice(-240)}`
  );
  assert(
    r.save.scene === chain[1],
    `ch${c.index}: head advance should land ${chain[1]}, got ${r.save.scene}`
  );
  console.log(
    `[ch${c.index}] ${chain[0]} -> ${r.save.scene} stage=${stageOf(r.save)} :: ${prose.split("\n").pop().slice(0, 72)}`
  );
}

db.close();
ok("PASS: advance prose stays forward-consistent (fresh loop + all chapter entries)");
