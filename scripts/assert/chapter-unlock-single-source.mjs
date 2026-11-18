#!/usr/bin/env node
// F102 章节解锁口径单一事实源契约：
//
//   (a) 回包 = 数据：新档 GET /api/chapters?save_id=<id> 的每章
//       unlock.level / unlock.chapter 逐项 === chapters.json 的 unlock
//       （缺字段对齐 null）——回包不得出现写死数字（旧坑：Ch.8 写死 70、
//       回包另一个 40、数据第三个值，三处口径互不相认）。
//   (b) 门态 = 判定：unlock.state 与 unlockedFor 的 ok 同口径——
//       ok=false → "locked"；ok=true 且仍有未达前置 → "soft"；全满足 →
//       "open"。locked 之外的态其 hint/blocked_reasons 一律不含「锁定」。
//   (c) 软门现场（Lv.4 站 ch1 链尾、守关者已击杀——ch2 的 chapter 腿满足、
//       level 腿未达）：ch2 state==="soft"、hint 含「可强行进入」且不含
//       「锁定」；blocked_reasons 只列未达前置（不得复列「需完成第1章
//       主线」）；ch3 双腿未达 → "locked" 且双腿齐全。越门播报写「已强行
//       进入」并点名真实门槛——不得出现「锁定」「已开启」并存。
//   (d) 前端不再写死章节门文案：client/src 全部 .ts/.tsx（以及构建产物
//       client/dist 若存在）不得含 需 Lv.<数字> / 需完成第<数字>章 /
//       锁定·需 Lv.<数字> 这类字面量。
//
//   自起隔离实例：临时端口 + 临时 DB_PATH，不打线上、不占用 3020；
//   章尾/等级落点锻造走 DB 直写（同 soft-gate-wording.mjs 取径）——
//   锻造的是站位，过门结论仍走真实 /action。
//
//   旧码红证：地图写死「需 Lv.70」→ (a) FAIL；软门 hint 写「锁定」或
//   正文写「压制了传送门」→ (c) FAIL；MapPanel 自拼「需 Lv.X」→ (d) FAIL。
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

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f102-gate-"));
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

const { assert, ok, get, makeSave, act, fetchSaveView } = await import("./_http.mjs");
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
const CH1 = raw.chapters.find((c) => c.index === 1);
const CH1_TAIL = deriveMainPath(CH1).slice(-1)[0];
const unlockOf = (idx) => (raw.chapters.find((c) => c.index === idx) || {}).unlock || {};

// 判定腿独立 oracle：与 server/engine/chapters.js 的 unlockedFor 同一
// 语义（OR 软门），但从数据直推，不调用被测引擎——回包必须逐项对上。
function gateOracle(save, idx) {
  const req = unlockOf(idx);
  const levelReq = Number.isInteger(req.level) ? req.level : null;
  const chapterReq = Number.isInteger(req.chapter) ? req.chapter : null;
  const levelOk = levelReq === null ? true : save.level >= levelReq;
  const chapterOk = chapterReq === null ? true : save.chapter >= chapterReq;
  const ok =
    (levelReq !== null && save.level >= levelReq) ||
    (chapterReq !== null && save.chapter >= chapterReq) ||
    (levelReq === null && chapterReq === null);
  const blocked = [];
  if (chapterReq !== null && !chapterOk) blocked.push(`需完成第${chapterReq}章主线`);
  if (levelReq !== null && !levelOk) blocked.push(`需 Lv.${levelReq}`);
  const state = !ok ? "locked" : blocked.length === 0 ? "open" : "soft";
  return { level: levelReq, chapter: chapterReq, level_ok: levelOk, chapter_ok: chapterOk, ok, blocked, state };
}

// /api/chapters 逐章对账：unlock 数值、判定腿、三态、blocked_reasons。
async function checkUnlockTable(save, tag) {
  const { status, body } = await get(`/chapters?save_id=${save.id}`);
  assert(status === 200 && body && Array.isArray(body.chapters), `${tag}: GET /chapters failed (HTTP ${status})`);
  for (const rc of raw.chapters) {
    const view = body.chapters.find((c) => c.index === rc.index);
    assert(view && view.unlock, `${tag}: ch${rc.index} unlock view missing`);
    const u = view.unlock;
    const want = gateOracle(save, rc.index);
    // (a) 单一事实源：回包数值逐项 === chapters.json
    assert(
      u.level === (rc.unlock && Number.isInteger(rc.unlock.level) ? rc.unlock.level : null),
      `${tag}: ch${rc.index} unlock.level=${u.level}, chapters.json=${JSON.stringify(rc.unlock)}`
    );
    assert(
      u.chapter === (rc.unlock && Number.isInteger(rc.unlock.chapter) ? rc.unlock.chapter : null),
      `${tag}: ch${rc.index} unlock.chapter=${u.chapter}, chapters.json=${JSON.stringify(rc.unlock)}`
    );
    // (b) 门态 = 判定：ok/state/两条腿与 oracle 逐项相同
    for (const k of ["ok", "level_ok", "chapter_ok"]) {
      assert(u[k] === want[k], `${tag}: ch${rc.index} unlock.${k}=${u[k]}, oracle=${want[k]} :: ${JSON.stringify(u)}`);
    }
    assert(
      u.state === want.state,
      `${tag}: ch${rc.index} unlock.state=${u.state}, oracle=${want.state} (ok=${want.ok} blocked=${want.blocked.length})`
    );
    const reasons = Array.isArray(u.blocked_reasons) ? u.blocked_reasons : [];
    assert(
      JSON.stringify(reasons) === JSON.stringify(want.blocked),
      `${tag}: ch${rc.index} blocked_reasons=${JSON.stringify(reasons)}, oracle=${JSON.stringify(want.blocked)}`
    );
    // 锁定措辞只允许出现在真锁态；soft/open 的 hint 不得含「锁定」。
    if (u.state !== "locked") {
      assert(
        !(u.hint || "").includes("锁定") && !reasons.some((r) => r.includes("锁定")),
        `${tag}: ch${rc.index} state=${u.state} but copy says 锁定: ${JSON.stringify(u)}`
      );
    }
    if (u.state === "soft") {
      assert(
        (u.hint || "").includes("可强行进入"),
        `${tag}: ch${rc.index} soft hint must say 可强行进入: ${u.hint}`
      );
    }
  }
  return body.chapters;
}

// ── (d) 静态检查：前端不得残留写死的章节门文案 ──────────────────
function scanDir(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) scanDir(p, out);
    else if (/\.(ts|tsx|js|html)$/.test(e.name)) out.push(p);
  }
  return out;
}
const HARD_GATE_RE = [/需\s*Lv\.\s*\d/, /需完成第\s*\d+\s*章/, /锁定\s*[·,，]?\s*需\s*Lv\.\s*\d/];
for (const dir of [path.join(ROOT, "client", "src"), path.join(ROOT, "client", "dist")]) {
  if (!fs.existsSync(dir)) continue;
  for (const file of scanDir(dir)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const re of HARD_GATE_RE) {
        const m = line.match(re);
        assert(
          !m,
          `(d) hardcoded chapter-gate copy in ${path.relative(ROOT, file)}:${i + 1}: "${m && m[0]}" :: ${line.trim().slice(0, 80)}`
        );
      }
    });
  }
}
{
  // MapPanel 连「动态拼接」也不许回来——前置条件只能渲染服务端 hint。
  const src = fs.readFileSync(path.join(ROOT, "client", "src", "panels", "MapPanel.tsx"), "utf8");
  assert(
    !/需完成第\$\{/.test(src) && !/需\s*Lv\.\s*\$\{/.test(src),
    "(d) MapPanel.tsx still assembles gate requirement strings (需完成第X章主线 / 需 Lv.X)"
  );
  // GATE_LABEL 的 soft 态不得渲染「锁定」。
  const labelBlock = src.match(/GATE_LABEL[^}]*}/s);
  assert(
    labelBlock && /soft:\s*"可强行进入"/.test(labelBlock[0]) && !/soft:\s*"锁定"/.test(labelBlock[0]),
    `(d) GATE_LABEL.soft must render 可强行进入, not 锁定: ${labelBlock && labelBlock[0]}`
  );
}

// ── (a)+(b) 新档全表对账 ────────────────────────────────────────
const freshId = await makeSave("f102-single-source");
{
  const { save } = await fetchSaveView(freshId);
  const chapters = await checkUnlockTable(save, "fresh");
  // 新档现场：ch1 门开、ch2 软门（chapter 腿已满足）、ch3+ 真锁。
  const at = (i) => chapters.find((c) => c.index === i).unlock;
  assert(at(1).state === "open", `fresh ch1 gate should be open, got ${at(1).state}`);
  assert(at(2).state === "soft", `fresh ch2 gate should be soft, got ${at(2).state}`);
  assert(at(3).state === "locked" && at(8).state === "locked", "fresh ch3..ch8 must be locked");
}

// ── (c) 软门现场：Lv.4 站 ch1 链尾、守关者已击杀 ────────────────
const id = await makeSave("f102-soft-gate");
const CH2_LEVEL = unlockOf(2).level;
assert(
  Number.isInteger(CH2_LEVEL) && CH2_LEVEL >= 2,
  `scenario needs ch2 unlock.level >= 2, got ${CH2_LEVEL}`
);
const BELOW = CH2_LEVEL - 1; // Lv.4：level 腿未达、chapter 腿已满足的软门现场
db.prepare(
  "UPDATE saves SET chapter = 1, scene = ?, level = ?, boss_cleared_json = ? WHERE id = ?"
).run(CH1_TAIL, BELOW, JSON.stringify([CH1.id]), id);

const staged = (await fetchSaveView(id)).save;
assert(
  staged.chapter === 1 && staged.scene === CH1_TAIL && staged.level === BELOW && !staged.combat,
  `setup broken: scene=${staged.scene} ch=${staged.chapter} lv=${staged.level}`
);

{
  const chapters = await checkUnlockTable(staged, "soft-site");
  const u2 = chapters.find((c) => c.index === 2).unlock;
  assert(u2.state === "soft", `ch2 gate must be soft at Lv.${BELOW}, got ${u2.state}`);
  assert(
    typeof u2.hint === "string" && u2.hint.includes("可强行进入") && !u2.hint.includes("锁定"),
    `ch2 soft hint must say 可强行进入 and never 锁定: ${u2.hint}`
  );
  const r2 = u2.blocked_reasons || [];
  assert(
    r2.length === 1 && r2[0].includes(`Lv.${CH2_LEVEL}`) && !/完成第\d+章主线/.test(r2[0]),
    `(c) ch2 blocked_reasons must list only the unmet level leg: ${JSON.stringify(r2)}`
  );
  // 双腿未达的真锁对照：ch3 必须 locked 且双腿齐全。
  const u3 = chapters.find((c) => c.index === 3).unlock;
  const r3 = u3.blocked_reasons || [];
  assert(
    u3.state === "locked" && r3.length === 2 &&
      r3.some((r) => r.includes(`第${unlockOf(3).chapter}章`)) &&
      r3.some((r) => r.includes(`Lv.${unlockOf(3).level}`)),
    `(c) ch3 locked gate must carry both unmet legs: ${JSON.stringify(u3)}`
  );
}

// ── (c) 越门：播报写「已强行进入」，不得与「锁定/已开启」并存 ────
{
  const { reply, save } = await act(id, "前进");
  const content = reply.content || "";
  assert(save.chapter === 2, `gate push should land chapter 2, got ${save.chapter}`);
  assert(
    content.includes("已强行进入") && content.includes(`Lv.${CH2_LEVEL}`),
    `crossing prose must say 已强行进入 and name the real gate Lv.${CH2_LEVEL}: ${content.slice(0, 200)}`
  );
  assert(
    !content.includes("压制了传送门"),
    `crossing prose still carries the self-contradicting 压制了传送门: ${content.slice(0, 200)}`
  );
  assert(
    !content.includes("锁定") && !content.includes("已开启"),
    `crossing prose must not mix 锁定/已开启 with 已强行进入: ${content.slice(0, 200)}`
  );
  const cu = save.chapter_unlock;
  assert(cu && cu.state === "soft", `post-crossing chapter_unlock should be soft, got ${cu && cu.state}`);
  assert(
    typeof cu.crossing === "string" && cu.crossing.includes("已强行进入") &&
      !cu.crossing.includes("已开启") && !cu.crossing.includes("锁定"),
    `chapter_unlock.crossing must say 已强行进入 (not 已开启/锁定): ${cu && cu.crossing}`
  );
  // 进门后全表再对账：ch2 的 ok/state 与数值口径仍逐项贴住数据。
  await checkUnlockTable(save, "post-crossing");
}

db.close();
ok("OK");
