#!/usr/bin/env node
// F173 去机制术语与模板重复断言：
//   a) 章首注脚不再是机制口径：新存档 POST /action「前进」第一条主线回包
//      正文不得匹配 未耗体力|HP \d+ · MP \d+，且必须含可读代价措辞
//      （「代价」或「痛」，服务端实现保证「代价」逐条都有）；
//   b) 变体真的轮换：直接 import server/index.js 导出的纯函数
//      chapterEntryNote(...)，对 ch1/ch2/ch3 返回值两两不同、同章可复现，
//      且都不匹配机制口径；
//   c) 等待态不是内部术语：route 拦截 /api/action 延迟 2.5s，点「前进」
//      500ms 时 .pending 文本不得含「系统处理中」且非空；放行后 2s 内
//      .pending 必须消失；
//   d) 全程 console error = 0，390×844 无横向溢出。
// 依赖：E2E_BASE_URL（游戏页，默认线上）、API_BASE 由其推导、DB_PATH
// （import 服务端纯函数时给 db.js 一个独立库，避免污染线上存档库）。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;
process.env.DB_PATH =
  process.env.DB_PATH || `/tmp/sl-f173-assert-${Date.now().toString(36)}.db`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { makeSave, act } = await import("./_http.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);

const MECH_RE = /未耗体力|HP \d+ · MP \d+/;
const READABLE_RE = /代价|痛/;

// ── a) 章首注脚行为证据：新档第一次「前进」回包 ────────────────────
const id = await makeSave("f173-note");
const r = await act(id, "前进");
const content = (r.reply && r.reply.content) || "";
const tail = content.split("\n").filter(Boolean).pop() || content;
assert(
  !MECH_RE.test(tail),
  `章首注脚仍是机制口径（未耗体力/HP·MP 数字）：${tail.slice(-160)}`
);
assert(
  READABLE_RE.test(tail),
  `章首注脚缺少可读代价措辞（代价/痛）：${tail.slice(-160)}`
);
console.log(`    [a] 章首注脚：${tail.slice(-80)}`);

// ── b) 纯函数轮换：ch1/ch2/ch3 两两不同、同章可复现、非机制口径 ────
const { chapterEntryNote } = require(path.join(ROOT, "server", "index.js"));
assert(
  typeof chapterEntryNote === "function",
  "server/index.js 未导出 chapterEntryNote（module.exports 缺失）"
);
const notes = ["ch1", "ch2", "ch3"].map((c) => chapterEntryNote(c, 3, 2));
assert(
  new Set(notes).size === notes.length,
  `chapterEntryNote 对 ch1/ch2/ch3 未轮换出不同变体：${notes.join(" / ")}`
);
for (const c of ["ch1", "ch2", "ch3"]) {
  const n1 = chapterEntryNote(c, 3, 2);
  const n2 = chapterEntryNote(c, 3, 2);
  assert(n1 === n2, `chapterEntryNote("${c}") 不可复现：${n1} vs ${n2}`);
  assert(!MECH_RE.test(n1), `chapterEntryNote("${c}") 仍是机制口径：${n1}`);
  assert(READABLE_RE.test(n1), `chapterEntryNote("${c}") 缺可读代价措辞：${n1}`);
}
console.log(`    [b] 轮换成立：${notes.map((n) => n.slice(0, 14)).join(" | ")}…`);

// ── c)+d) 等待态玩家语言 + console error/横向溢出 ──────────────────
const NAME = `F173-${Date.now().toString(36)}`.slice(0, 20);

run(
  "repetition-and-jargon",
  async ({ page }) => {
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrs.push(String(e)));

    // 人为拖慢 /api/action 2.5s——busy 期间 .pending 必须可读可见。
    await page.route("**/api/action", async (route) => {
      await new Promise((r2) => setTimeout(r2, 2500));
      await route.continue();
    });

    await createSave(page, NAME);

    const respP = page.waitForResponse(
      (r2) => r2.url().includes("/api/action") && r2.request().method() === "POST"
    );
    await page.click(".actions-main .btn.primary");
    await page.waitForTimeout(500);

    const pending = page.locator(".pending");
    const count = await pending.count();
    const text = count ? (await pending.first().innerText()).trim() : "";
    assert(count > 0 && text.length > 0, "busy 期间 .pending 不可见或为空");
    assert(!text.includes("系统处理中"), `.pending 仍是内部术语：「${text}」`);
    console.log(`    [c] 等待态文案：「${text}」`);

    // 放行（route.continue 已发，等真实回包到）后 2s 内 pending 必须消失。
    await respP;
    await page.waitForFunction(() => !document.querySelector(".pending"), null, {
      timeout: 2000,
    });
    assert((await pending.count()) === 0, "响应回来后 .pending 未消失");

    const sw = await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth
    );
    assert(sw, "390×844 存在横向溢出");

    assert(consoleErrs.length === 0, `console error：${consoleErrs.join(" | ")}`);
  },
  { viewport: { width: 390, height: 844 } }
);
