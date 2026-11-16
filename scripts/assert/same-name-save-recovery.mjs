#!/usr/bin/env node
// F136 contract: 同名重新登记不得再静默开新档。
//   A) 唯一名字 POST /saves → 201 + body.save.id（回归保护，旧回包形状不破）
//   B) 同名再 POST /saves → 409，existing_save_id 等于 A 的 id，name_conflict=true，
//      且一条记录都不写（GET /saves?player_name= 仍只有 1 条）
//   C) 大小写/前后空格变体同样命中冲突（NFKC+trim+大小写折叠精确匹配）
//   D) mode:"new"（玩家明确选「另起新档」）→ 201，此时同名档并存 2 条
//   E) GET /saves?player_name= 空名 → 400；无命中 → { saves: [] }
//   F) UI（SL_SKIP_UI=1 跳过）：同名建档 → 出现「检测到已有猎人/已有存档」
//      文案与「继续这个存档」「另起新档」两按钮；点「继续这个存档」后
//      localStorage.solo_leveling_save_id 等于旧档 id。
//
//   API_BASE     默认 http://127.0.0.1:3020/game/api（隔离跑法可覆盖到 3097）
//   E2E_BASE_URL 默认 http://127.0.0.1:3020/game（UI 步骤用；仅设 API_BASE 时
//                从 API_BASE 反推，避免两步打到不同实例）
//   SL_SKIP_UI=1 跳过 UI 步骤

import { API, post, get } from "./_http.mjs";

const BASE = (process.env.E2E_BASE_URL || API.replace(/\/api\/?$/, "")).replace(/\/+$/, "");
const RUN_UI = process.env.SL_SKIP_UI !== "1";

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

const show = (r) => `status=${r.status} body=${JSON.stringify(r.body)}`;

const tag = Date.now().toString(36);
const name = `F136-Hunter-${tag}`;

// ── A：唯一名字建档 → 201 + save.id（回归保护）──
const a = await post("/saves", { player_name: name });
assert(
  a.status === 201 && a.body && a.body.save && a.body.save.id,
  `A 唯一名建档应 201+save.id，实际 ${show(a)}`
);
const sidA = a.body.save.id;
console.log(`[OK] A 唯一名建档 201，save.id=${sidA}`);

// ── B：同名再 POST → 409 + existing_save_id + name_conflict ──
const b = await post("/saves", { player_name: name });
assert(
  b.status === 409,
  `B 同名再建档应 409，实际 ${show(b)}`
);
assert(
  b.body && b.body.name_conflict === true && b.body.existing_save_id === sidA,
  `B 回包应含 name_conflict=true 且 existing_save_id=${sidA}，实际 ${show(b)}`
);
assert(
  b.body.existing && Number.isInteger(b.body.existing.id) &&
    Number.isInteger(b.body.existing.level) && Number.isInteger(b.body.existing.chapter),
  `B 回包 existing 摘要字段缺失，实际 ${show(b)}`
);
console.log("[OK] B 同名再建档 409 + name_conflict + existing_save_id");

// ── C：冲突后 GET 只命中 1 条（没有静默开第二个档）──
const c = await get(`/saves?player_name=${encodeURIComponent(name)}`);
assert(
  c.status === 200 && c.body && Array.isArray(c.body.saves) && c.body.saves.length === 1,
  `C 冲突后应仍只有 1 条存档，实际 ${show(c)}`
);
assert(c.body.saves[0].id === sidA, `C 命中档应为 A 的 id=${sidA}，实际 ${show(c)}`);
console.log("[OK] C 冲突后 GET /saves 仅 1 条命中");

// ── D：大小写/空格变体同样 409（不产生第二档）──
for (const variant of [`  ${name} `, name.toUpperCase(), name.toLowerCase()]) {
  const r = await post("/saves", { player_name: variant });
  assert(
    r.status === 409 && r.body && r.body.existing_save_id === sidA,
    `D 变体「${variant}」应 409 且指回 ${sidA}，实际 ${show(r)}`
  );
}
const d = await get(`/saves?player_name=${encodeURIComponent(`  ${name.toUpperCase()}  `)}`);
assert(
  d.status === 200 && d.body.saves.length === 1,
  `D 变体 GET 仍应只命中 1 条，实际 ${show(d)}`
);
console.log("[OK] D 大小写/空格变体同样命中冲突");

// ── E：mode:"new" → 201，同名档并存 2 条 ──
const e = await post("/saves", { player_name: name, mode: "new" });
assert(
  e.status === 201 && e.body && e.body.save && e.body.save.id && e.body.save.id !== sidA,
  `E mode:new 应 201 且新档 id≠${sidA}，实际 ${show(e)}`
);
const eList = await get(`/saves?player_name=${encodeURIComponent(name)}`);
assert(
  eList.status === 200 && eList.body.saves.length === 2,
  `E mode:new 后同名档应为 2 条，实际 ${show(eList)}`
);
console.log("[OK] E mode:new 201，同名档并存 2 条");

// ── 空名 400 / 无命中 { saves: [] } ──
const empty = await get("/saves?player_name=");
assert(empty.status === 400, `空名应 400，实际 ${show(empty)}`);
const miss = await get(`/saves?player_name=${encodeURIComponent(`F136-none-${tag}`)}`);
assert(
  miss.status === 200 && miss.body && Array.isArray(miss.body.saves) && miss.body.saves.length === 0,
  `无命中应 { saves: [] }，实际 ${show(miss)}`
);
console.log("[OK] 空名 400 / 无命中空数组");

// ── F：UI 步骤 ──
// 用独立名字建一个旧档，清 localStorage 后同名建档 → 弹二选一对话框；
// 点「继续这个存档」后 localStorage 应写回旧档 id。
if (!RUN_UI) {
  console.log("[SKIP] UI 步骤（SL_SKIP_UI=1）");
} else {
  const uiName = `F136-UI-${tag}`;
  const old = await post("/saves", { player_name: uiName });
  assert(old.status === 201 && old.body.save.id, `F 预置旧档失败 ${show(old)}`);
  const oldId = old.body.save.id;

  const { loadPW, findChrome } = await import("../e2e/lib.mjs");
  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let lastErr = new Error("not attempted");
  for (let attempt = 1; attempt <= 3 && lastErr; attempt++) {
    lastErr = null;
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    try {
      const page = await ctx.newPage();
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".gate-form input", { timeout: 15000 });
      await page.fill(".gate-form input", uiName);
      await page.click(".gate-form button[type=submit]");
      // 二选一对话框：文案 + 两个按钮。
      await page.waitForSelector(".gate-conflict", { timeout: 10000 });
      const conflictText = await page.textContent(".gate-conflict");
      assert(
        /检测到已有猎人|已有存档/.test(conflictText || ""),
        `F 对话框文案不符，实际：${(conflictText || "").slice(0, 120)}`
      );
      await page.waitForSelector('button:has-text("继续这个存档")', { timeout: 5000 });
      await page.waitForSelector('button:has-text("另起新档")', { timeout: 5000 });
      await page.click('button:has-text("继续这个存档")');
      await page.waitForSelector(".status", { timeout: 15000 });
      const stored = await page.evaluate(() => localStorage.getItem("solo_leveling_save_id"));
      assert(
        stored === String(oldId),
        `F 继续存档后 localStorage 应为 ${oldId}，实际 ${stored}`
      );
      console.log(`[OK] F UI：同名建档弹二选一，「继续这个存档」接入旧档 #${oldId}（第 ${attempt} 次尝试）`);
    } catch (err) {
      lastErr = err;
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  await browser.close().catch(() => {});
  if (lastErr) fail(`F UI 步骤 3 次尝试均失败：${lastErr.message}`);
}

console.log("[VERIFY] same-name-save-recovery PASS");
process.exit(0);
