#!/usr/bin/env node
// F116 解锁口径一致性契约（API 门态 + 地图面板文案 + 前端源码静态检查，
// 三条并用）：
//   a) /api/chapters?save_id 的 unlock 必须带服务端门态：
//      level_ok:false 且另一条腿已满足 → state === "soft"（软门放行），
//      hint 含「可强行进入」或「推荐」、绝不含「锁定」；
//      blocked_reasons 只含尚未满足的前置——已通关的前置章（chapter_ok）
//      不得再被列为锁定原因；
//   b) 两条腿都不满足 → state === "locked"，blocked_reasons 双腿齐全；
//   c) Playwright 打开地图面板：软门节点不得出现「锁定」字样，
//      须含「可强行进入」或「推荐」；真锁节点仍写「锁定」+「需」字前置；
//   d) 前端不再自拼门禁文案：MapPanel.tsx 源码里不得残留
//      需完成第${…}章主线 / 需 Lv.${…} 的模板拼接。
// 场景取自 F116 复现态：Lv.3 玩家站在 ch1 链尾（守关者已击杀）——
// ch2 门软放行、ch3 门真锁，正是「写锁定却能进」的矛盾现场。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { get, fetchSaveView } = await import("./_http.mjs");
const { createRequire } = await import("node:module");
const fs = await import("node:fs");
const path = await import("node:path");
const { fileURLToPath } = await import("node:url");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const raw = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

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
const TAIL = CH1_PATH[CH1_PATH.length - 1];
const CH2_UNLOCK = raw.chapters.find((c) => c.index === 2).unlock;
const CH3_UNLOCK = raw.chapters.find((c) => c.index === 3).unlock;

const NAME = `e2e-f116-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// ── (d) 静态检查：前端不再自拼门禁文案 ──────────────────────────
{
  const src = fs.readFileSync(path.join(ROOT, "client", "src", "panels", "MapPanel.tsx"), "utf8");
  assert(
    !/需完成第\$\{/.test(src) && !/需\s*Lv\.\s*\$\{/.test(src),
    "MapPanel.tsx still hardcodes gate requirement strings (需完成第X章主线 / 需 Lv.X)"
  );
}

async function apiChecks(saveId) {
  const { status, body } = await get(`/chapters?save_id=${saveId}`);
  assert(status === 200 && body && Array.isArray(body.chapters), `GET chapters failed (HTTP ${status})`);
  const ch2 = body.chapters.find((c) => c.index === 2);
  const ch3 = body.chapters.find((c) => c.index === 3);
  assert(ch2 && ch3, "chapters payload missing ch2/ch3");

  // (a) 软门：level_ok:false 但前置章已通关 → soft，不是「锁定」
  const u2 = ch2.unlock;
  assert(
    u2.state === "soft",
    `ch2 gate state must be "soft" (met chapter leg, unmet level leg), got ${u2.state}`
  );
  assert(
    u2.level_ok === false && u2.chapter_ok === true,
    `ch2 gate legs should be level_ok=false chapter_ok=true: ${JSON.stringify(u2)}`
  );
  assert(typeof u2.hint === "string" && u2.hint.length > 0, "ch2 soft gate missing hint");
  assert(!u2.hint.includes("锁定"), `soft hint must not say 锁定: ${u2.hint}`);
  assert(
    /可强行进入|推荐/.test(u2.hint),
    `soft hint must honestly say 可强行进入/推荐: ${u2.hint}`
  );
  const r2 = Array.isArray(u2.blocked_reasons) ? u2.blocked_reasons : [];
  assert(r2.length === 1, `ch2 blocked_reasons should carry exactly the unmet leg: ${JSON.stringify(r2)}`);
  assert(
    r2.some((r) => r.includes(`Lv.${CH2_UNLOCK.level}`)),
    `ch2 blocked_reasons must name the level req: ${JSON.stringify(r2)}`
  );
  assert(
    !r2.some((r) => /完成第\d+章主线/.test(r)),
    `ch2 blocked_reasons must not re-list the satisfied chapter leg: ${JSON.stringify(r2)}`
  );

  // (b) 真锁：双腿都未满足 → locked，blocked_reasons 双腿齐全
  const u3 = ch3.unlock;
  assert(u3.state === "locked", `ch3 gate state must be "locked", got ${u3.state}`);
  const r3 = Array.isArray(u3.blocked_reasons) ? u3.blocked_reasons : [];
  assert(
    r3.some((r) => r.includes(`第${CH3_UNLOCK.chapter}章`)),
    `ch3 blocked_reasons missing chapter leg: ${JSON.stringify(r3)}`
  );
  assert(
    r3.some((r) => r.includes(`Lv.${CH3_UNLOCK.level}`)),
    `ch3 blocked_reasons missing level leg: ${JSON.stringify(r3)}`
  );
  assert(u3.hint && u3.hint.includes("需"), `locked hint should carry requirement text: ${u3.hint}`);
}

run("map-lock-consistency", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // F116 复现态：Lv.3、人站 ch1 链尾、守关者已击杀（软门现场）
  db.prepare(
    "UPDATE saves SET level = 3, scene = ?, boss_cleared_json = ? WHERE id = ?"
  ).run(TAIL, JSON.stringify(["ch1"]), saveId);
  const s0 = (await fetchSaveView(saveId)).save;
  assert(
    s0.chapter === 1 && s0.scene === TAIL && s0.level === 3,
    `setup broken: ch${s0.chapter} ${s0.scene} Lv.${s0.level}`
  );

  await apiChecks(saveId);

  // ── (c) 地图面板：软门节点不得写「锁定」───────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.locator(".btn-group-sys .btn", { hasText: "地图" }).first().click();
  await page.waitForSelector(".map-list .map-node");
  await settle(page, 400);

  const nodes = page.locator(".map-list .map-node");
  const ch2Node = nodes.nth(1);
  const ch2Text = (await ch2Node.innerText()).replace(/\s+/g, "");
  assert(
    !ch2Text.includes("锁定"),
    `soft-gated ch2 must not say 锁定 on the map: "${ch2Text.slice(0, 80)}"`
  );
  assert(
    /可强行进入|推荐/.test(ch2Text),
    `soft-gated ch2 must honestly say 可强行进入/推荐: "${ch2Text.slice(0, 80)}"`
  );

  // 真锁节点（ch3）仍写锁定 + 前置条件
  const ch3Node = nodes.nth(2);
  const ch3Text = (await ch3Node.innerText()).replace(/\s+/g, "");
  assert(ch3Text.includes("锁定"), `locked ch3 must say 锁定: "${ch3Text.slice(0, 80)}"`);
  assert(ch3Text.includes("需"), `locked ch3 missing requirement text: "${ch3Text.slice(0, 80)}"`);

  // 全图口径：不存在「既写锁定又写可强行进入」的自相矛盾节点
  const allText = await nodes.allInnerTexts();
  for (const [i, t] of allText.entries()) {
    const flat = t.replace(/\s+/g, "");
    assert(
      !(flat.includes("锁定") && flat.includes("可强行进入")),
      `node ${i + 1} shows both 锁定 and 可强行进入 (contradiction): "${flat.slice(0, 80)}"`
    );
  }
});
