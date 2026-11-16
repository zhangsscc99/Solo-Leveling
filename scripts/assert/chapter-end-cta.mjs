#!/usr/bin/env node
// F117 章尾「进入下一章」入口契约（UI + API 双源）：
//   a) DB 落点构造 ch1 链尾 7/7 + 守关者已击杀 → saveView.advance_mode
//      必须下发 "next_chapter"，save.next_chapter 带下一章号与章名
//      （章名从 chapters.json 取，不是写死字符串）；
//   b) 主按钮渲染「进入第2章 · <数据章名>」，不再显示「探索前进」；
//   c) 真点该按钮 → chapter 1→2、落到 ch2 链首、HP/MP 逐位不变、
//      最新日志行不含【遭遇】/「体力消耗」（过门不掷遭遇不扣体力）；
//   d) 反例：同一存档 DB 回拨到 5/7（守关者已击杀）→ advance_mode
//      退回 "advance"、主按钮恢复「探索前进」、不出现章尾入口；
//   e) 移动端 390×844 同一 CTA 可见且主按钮单行不撑高（F119 口径）。
// 期望值独立推导自 chapters.json，不调用被测引擎的 chapterPath。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert, launch } = await import("../e2e/lib.mjs");
const { fetchSaveView } = await import("./_http.mjs");
const { createRequire } = await import("node:module");
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
const CH2 = raw.chapters.find((c) => c.index === 2);
const CH2_PATH = deriveMainPath(CH2);
const TAIL = CH1_PATH[CH1_PATH.length - 1];
const MID5 = CH1_PATH[4]; // 5/7 反例站位
const CTA = `进入第2章 · ${CH2.title}`;

const NAME = `e2e-f117-${Date.now().toString(36)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);
const barBtn = (page, label) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

async function forgeTail(saveId) {
  db.prepare(
    "UPDATE saves SET chapter = 1, scene = ?, boss_cleared_json = ?, encounter_cd = 0 WHERE id = ?"
  ).run(TAIL, JSON.stringify(["ch1"]), saveId);
  db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
}

async function openAtTail(page, saveId) {
  await forgeTail(saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await settle(page, 600);
  const s = (await fetchSaveView(saveId)).save;
  assert(
    s.scene === TAIL && s.chapter_completed === true && !s.combat,
    `setup broken: scene=${s.scene} completed=${s.chapter_completed} combat=${JSON.stringify(s.combat)}`
  );
  // (a) 服务端语义：章尾入口字段
  assert(
    s.advance_mode === "next_chapter",
    `advance_mode must be "next_chapter" at cleared tail, got ${s.advance_mode}`
  );
  assert(
    s.next_chapter && s.next_chapter.index === 2 && s.next_chapter.title === CH2.title,
    `next_chapter must carry {index:2,title:${CH2.title}}, got ${JSON.stringify(s.next_chapter)}`
  );
  return s;
}

async function assertCtaButton(page) {
  // (b) 主按钮换标：进入第2章 · <数据章名>；探索前进退场
  const cta = barBtn(page, `进入第2章`);
  assert((await cta.count()) === 1, `CTA button「进入第2章」missing at 7/7`);
  const label = (await cta.innerText()).replace(/\s+/g, "");
  assert(
    label.includes(`进入第2章`) && label.includes(CH2.title),
    `CTA label should be「${CTA}」, got "${label}"`
  );
  assert(
    (await barBtn(page, "探索前进").count()) === 0,
    "main button still says「探索前进」at chapter end"
  );
  return cta;
}

async function body(page) {
  await createSave(page, NAME);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  const s0 = await openAtTail(page, saveId);
  const cta = await assertCtaButton(page);

  // ── (c) 真点 CTA：过门零消耗、不掷遭遇、chapter 1→2 ────────────
  await cta.click();
  await settle(page, 800);
  const s1 = (await fetchSaveView(saveId)).save;
  assert(s1.chapter === 2, `gate click should open ch2, got ch${s1.chapter}`);
  assert(
    s1.scene === CH2_PATH[0] && s1.chapter_steps === 1,
    `gate click should land on ch2 chain head ${CH2_PATH[0]}, got ${s1.scene} (${s1.chapter_steps})`
  );
  assert(
    s1.hp === s0.hp && s1.mp === s0.mp,
    `gate pass must be free: HP/MP ${s0.hp}/${s0.mp} -> ${s1.hp}/${s1.mp}`
  );
  const log = await fetch(`${process.env.API_BASE}/saves/${saveId}/log?limit=4`).then((r) =>
    r.json()
  );
  const lastReply = (log.log || []).filter((l) => l.role !== "user").pop();
  assert(lastReply, "no reply log row after gate click");
  assert(
    lastReply.content.includes("开启") || lastReply.content.includes(`第2章`),
    `gate reply missing 开启播报: ${lastReply.content.slice(-200)}`
  );
  assert(
    !lastReply.content.includes("【遭遇】") && !lastReply.content.includes("体力消耗"),
    `gate pass must not roll encounter or print vitals cost: ${lastReply.content.slice(-200)}`
  );

  // ── (d) 反例：5/7 没有章尾入口 ────────────────────────────────
  db.prepare("UPDATE saves SET chapter = 1, scene = ?, boss_cleared_json = ? WHERE id = ?").run(
    MID5,
    JSON.stringify(["ch1"]),
    saveId
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await settle(page, 600);
  const s2 = (await fetchSaveView(saveId)).save;
  assert(
    s2.chapter_progress === `5/${CH1_PATH.length}` && s2.chapter_completed === false,
    `counterexample setup broken: ${s2.chapter_progress} completed=${s2.chapter_completed}`
  );
  assert(
    s2.advance_mode === "advance",
    `advance_mode at 5/7 must be "advance", got ${s2.advance_mode}`
  );
  assert(
    (await barBtn(page, "探索前进").count()) === 1,
    "main button should be「探索前进」at 5/7"
  );
  assert(
    (await barBtn(page, "进入第").count()) === 0,
    "chapter-end CTA leaked at 5/7"
  );
}

async function mobileCheck() {
  // ── (e) 390×844：CTA 可见、主按钮单行（不撑高操作区，F119 口径）──
  const pwBrowser = await launch();
  try {
    const ctx = await pwBrowser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN" });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    await createSave(page, `${NAME}-m`);
    const saveId = await page.evaluate(() =>
      Number(localStorage.getItem("solo_leveling_save_id"))
    );
    await forgeTail(saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page, 600);
    const cta = barBtn(page, "进入第2章");
    assert((await cta.count()) === 1, "mobile: CTA「进入第2章」missing at 390×844");
    const box = await cta.boundingBox();
    assert(box, "mobile: CTA has no boundingBox");
    assert(
      box.height <= 60,
      `mobile: CTA wrapped/taller than one line (height=${box.height}px)`
    );
    assert(box.x >= -0.5 && box.x + box.width <= 390.5, `mobile: CTA out of viewport: ${JSON.stringify(box)}`);
    await ctx.close();
  } finally {
    await pwBrowser.close().catch(() => {});
  }
}

run("chapter-end-cta", async ({ page }) => {
  await body(page);
  await mobileCheck();
});
