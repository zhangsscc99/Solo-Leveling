#!/usr/bin/env node
// F219 must_choose 拒绝文案「方向说反 + 逐字重复」：
//
//   真实玩家走查（390px）：must_choose 场景连点「前进」，旧文案
//   「仍需做出选择——点上方选项」两处出错——① 方位说反（剧情选项组
//   实际渲染在行动行下方）；② 第 2、3 次拒绝逐字相同，等于刷屏。
//
//   a) API：新档 DB 落点 ch1_law（must_choose 场景，oracle 取自
//      chapters.json），连发 3 次裸「前进」：
//        · 三条拒绝正文两两不同（逐字符比较）；
//        · 三条都不含方位指代（上方/上面/往上/向上/下方/下面/往下/向下）；
//        · 每次都 refused、HP/MP 零消耗；
//        · 拒绝正文不落库口径不变（P206）：第 1 次 +1 条非 user 日志，
//          第 2、3 次 +0（连点不得把日志刷成拒绝清单）。
//   b) DOM（Playwright 390×844）：同口径落点后真点「探索前进」，
//      新落的系统播报行不得含方位词；实测选项组 top > 行动行 top
//      （选项在下方）时含「上方」类措辞直接 FAIL；选项组应被点亮
//      一次性高亮（.attn）作为位置指认。
//
//   旧码红证：旧码第 2、3 次拒绝逐字相同（(a) 两两不同 FAIL）且文案
//   含「点上方选项」（方位词 FAIL）。数据与期望独立读 chapters.json，
//   不经被测引擎。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，E2E_BASE_URL 默认
//   http://127.0.0.1:3020/game，可用环境变量覆盖。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { assert, ok, fail, get, makeSave, act, fetchSaveView } = await import("./_http.mjs");
const { run, createSave } = await import("../e2e/lib.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const Database = require("better-sqlite3");
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");

// 独立 oracle：第 1 章首个 must_choose 场景与它的真实选项 label。
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
assert(MC && Array.isArray(MC.choices) && MC.choices.length >= 2, "oracle: ch1 must_choose scene missing");
const LABELS = MC.choices.map((c) => c.label);

// 方位指代全集：无论选项组实测在行动行上方还是下方，拒绝文案一律
// 不得再用方向词指路（指路职责移交给选项组一次性高亮）。
const DIRECTION = /上方|上面|往上|向上|下方|下面|往下|向下/;
const UPWARD = /上方|上面|往上|向上/;

// 非 user 日志行数（拒绝正文落库口径 = 系统/旁白行是否多写）。
async function nonUserLogCount(id) {
  const { status, body } = await get(`/saves/${id}/log?limit=200`);
  assert(status === 200 && Array.isArray(body.log), `GET log failed (HTTP ${status})`);
  return body.log.filter((r) => r && r.role !== "user").length;
}

function toMustChoose(id) {
  const db = new Database(dbPath);
  try {
    db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(MC.id, id);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  } finally {
    db.close();
  }
}

// ── (a) API：连点 3 次「前进」──────────────────────────────────
const id = await makeSave("f219-must-choose-copy");
console.log(`[setup] save_id=${id} scene=${MC.id}`);
toMustChoose(id);
const pre = (await fetchSaveView(id)).save;
assert(
  pre.scene === MC.id && !pre.combat,
  `setup broken: scene=${pre.scene} combat=${JSON.stringify(pre.combat)}`
);

const texts = [];
let prevNonUser = await nonUserLogCount(id);
for (let i = 0; i < 3; i++) {
  const r = await act(id, "前进");
  const text = String((r.reply && r.reply.content) || "");
  texts.push(text);
  assert(r.refused === true, `(a) push#${i + 1} must be refused: ${JSON.stringify(r.refused)}`);
  assert(
    r.save.scene === MC.id && r.save.hp === pre.hp && r.save.mp === pre.mp,
    `(a) push#${i + 1} 拒绝不是零消耗：scene ${r.save.scene} hp ${pre.hp}->${r.save.hp} mp ${pre.mp}->${r.save.mp}`
  );
  assert(
    !DIRECTION.test(text),
    `(a) push#${i + 1} 拒绝文案仍含方位指代：${text.slice(0, 160)}`
  );
  const nonUser = await nonUserLogCount(id);
  const want = i === 0 ? 1 : 0;
  const delta = nonUser - prevNonUser;
  assert(
    delta === want,
    `(a) push#${i + 1} 拒绝正文落库口径变了：非 user 日志 +${delta}（期望 +${want}）——` +
      `拒绝刷屏或首条被吞`
  );
  prevNonUser = nonUser;
  console.log(`    (a) push#${i + 1}: refused 零消耗、非 user 日志 +${delta}… ${text.slice(0, 60)}`);
}
assert(
  texts[0] !== texts[1] && texts[1] !== texts[2] && texts[0] !== texts[2],
  `(a) 3 次拒绝文案未做到两两不同：${JSON.stringify(texts)}`
);
// 第 2 次（清单重列版）应带出真实选项名——指路必须指到真实可点项。
for (const lb of LABELS) {
  assert(
    texts[0].includes(lb) || texts[1].includes(lb),
    `(a) 前两次拒绝都没列出真实选项名「${lb}」：${JSON.stringify(texts.map((t) => t.slice(0, 80)))}`
  );
}
console.log(`    (a) 3 条拒绝文案两两不同、无方位词、日志口径不变`);

// ── (b) DOM 390×844：真点「探索前进」───────────────────────────
run(
  "must-choose-copy",
  async ({ page }) => {
    const name = `e2e-f219-${Date.now().toString(36)}`;
    await createSave(page, name);
    const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
    assert(saveId > 0, "save_id missing in localStorage");
    toMustChoose(saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForSelector(".btn-group-choice");
    await page.waitForTimeout(600);

    // 选项组与行动行的实测相对位置（oracle：文案方位是否说反的几何
    // 依据，与玩家走查同一口径）。
    const actionGroup = page.locator(".btn-group", { has: page.locator(".btn", { hasText: "探索前进" }) }).first();
    const choiceGroup = page.locator(".btn-group-choice").first();
    const aBox = await actionGroup.boundingBox();
    const cBox = await choiceGroup.boundingBox();
    assert(aBox && cBox, `action/choice group missing: action=${JSON.stringify(aBox)} choice=${JSON.stringify(cBox)}`);
    const choiceBelow = cBox.y > aBox.y;

    // 日志行不是 .holo（.holo 是觉醒/接入浮窗）；拒绝正文落在 .stage-col
    // 的普通子节点里。基线 = stage-col 子节点数，命中变化后再取末条正文。
    const kidsBefore = await page.evaluate(
      () => document.querySelector(".stage-col").children.length
    );
    const holoBefore = kidsBefore;
    await actionGroup.locator(".btn", { hasText: "探索前进" }).click();
    // 高亮只亮 1.4s——必须在取样正文之前先抓住 .attn 类，否则采样时
    // 早已褪掉（旧断言在 20s 后才看 DOM，永远看不到）。
    await page.waitForSelector(".btn-group-choice.attn", { timeout: 8000 });
    const attn = await page.locator(".btn-group-choice.attn").count();
    await page.waitForFunction(
      (n) => document.querySelector(".stage-col").children.length > n,
      holoBefore
    );
    const line = await page.evaluate(
      () => document.querySelector(".stage-col").lastElementChild.innerText
    );

    assert(
      !DIRECTION.test(line),
      `(b) 390 下拒绝播报仍含方位指代：${line.slice(0, 160)}`
    );
    assert(
      !(choiceBelow && UPWARD.test(line)),
      `(b) 选项组实测在行动行下方（choiceTop=${cBox.y} > actionTop=${aBox.y}），` +
        `文案却仍让玩家「往上看」：${line.slice(0, 160)}`
    );
    // 位置指认的替代实现：被拒瞬间选项组挂一次性高亮类（attn）。
    assert(attn === 1, `(b) 拒绝后选项组未出现一次性高亮（.btn-group-choice.attn 计 ${attn}）`);
    console.log(`    (b) 390×844：播报无方位词、选项组（top=${cBox.y} > ${aBox.y}）已高亮`);
  },
  { viewport: { width: 390, height: 844 } }
);
