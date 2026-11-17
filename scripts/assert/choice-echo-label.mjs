#!/usr/bin/env node
// F198 验收断言：分支选项的回显行必须是玩家看到的 label 原文——
//
//   背景：选项键 onClick 发的是「选择 <id>」文本指令，前端把指令原文
//   塞进 .echo 回显行，玩家点「先放慢脚步，绕墙观察那些石像」日志里
//   落一行「选择 observe」——内部 id 泄漏给玩家。新契约：
//     1) 点第二个选项按钮后，日志区出现一条回显（.echo），其文本与
//        该按钮 label 原文逐字相同；
//     2) 整个日志区（.stage）不得匹配 snake_case 内部 id
//        /[a-z]{2,}_[a-z_]{2,}/，也不得出现裸英文 id（observe/advance
//        等按整词判定）。
//
//   干净上下文开新档：新档天然落 ch1 主线链首 ch1_double_gate（F124），
//   该场景 ≥2 个真实选项会铺 .btn-group-choice 选项键（F196）。
//   端点默认 http://127.0.0.1:3020/game，可用 SL_E2E_BASE（或
//   E2E_BASE_URL）覆盖：
//     PORT=3111 DB_PATH=/tmp/sl-f198.db node server/index.js &
//     SL_E2E_BASE=http://127.0.0.1:3111/game node scripts/assert/choice-echo-label.mjs
//
//   旧码红证：旧码回显行是「选择 observe」——断言 1（回显 !== label）
//   与断言 2（裸 observe）双路必 FAIL。
const BASE = (
  process.env.SL_E2E_BASE ||
  process.env.E2E_BASE_URL ||
  "http://127.0.0.1:3020/game"
).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `f198-${Date.now().toString(36)}`;
// 整词裸英文 id：前后非英文字母边界（JS 无 lookbehind 兼容顾虑——
// Node 18+ 支持，这里用手写边界更稳）。
const BARE_ID_RE = /(^|[^A-Za-z])(observe|advance|kneel|watch|sneak)(?![A-Za-z])/;
const SNAKE_ID_RE = /[a-z]{2,}_[a-z_]{2,}/;
// 【线索·flag】是 F196 起既定的玩家可见记档格式（choice-branching 等
// 断言按同一口径解析）——它记的是线索名不是选项 id，扫描前剥掉，
// 本断言只钉「选项 id 不得进日志」这一条契约。
const CLUE_FLAG_RE = /【线索·[^】]*】/g;

// 按钮 label 原文：剥掉代价小字（.rest-count）后剩下的文本节点。
const buttonLabel = (btn) =>
  btn.evaluate((el) => {
    let out = "";
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE) out += n.textContent;
    }
    return out.trim();
  });

await run("choice-echo-label", async ({ page }) => {
  await createSave(page, NAME);

  // 新档落 ch1_double_gate：等 ≥2 个选项键铺出来（非交战态才渲染）。
  const group = page.locator(".btn-group-choice");
  await group.waitFor({ state: "visible" });
  const buttons = group.locator(".btn");
  await page.waitForFunction(
    (sel) => document.querySelectorAll(sel).length >= 2,
    ".btn-group-choice .btn"
  );
  const count = await buttons.count();
  assert(count >= 2, `expected >=2 choice buttons, got ${count}`);

  const second = buttons.nth(1);
  const label = await buttonLabel(second);
  assert(label, "second choice button has empty label");
  console.log(`    场景选项 ×${count} · 点击第 2 键 label=「${label}」`);

  const echoes = page.locator(".stage .echo .echo-text");
  const before = await echoes.count();
  await second.click();
  // 回显行落地（本地同步）+ 回包 narration 落地（服务端往返）各等一步。
  await page.waitForFunction(
    (n) => document.querySelectorAll(".stage .echo .echo-text").length > n,
    before
  );
  await page.waitForFunction(
    () => {
      const nodes = document.querySelectorAll(".stage .narration");
      return nodes.length > 0;
    }
  );

  // 1) 最新一条回显 === 按钮 label 原文。
  const lastEcho = (await echoes.last().innerText()).trim();
  assert(
    lastEcho === label,
    `echo line != button label — echo=「${lastEcho}」 label=「${label}」`
  );
  console.log(`    回显行=「${lastEcho}」`);

  // 2) 整个日志区不得泄漏内部 id（线索记档格式豁免，见上注）。
  const stageText = (await page.locator(".stage").innerText()).replace(
    CLUE_FLAG_RE,
    ""
  );
  const snake = stageText.match(SNAKE_ID_RE);
  assert(!snake, `log leaks snake_case id: 「${snake && snake[0]}」`);
  const bare = stageText.match(BARE_ID_RE);
  assert(!bare, `log leaks bare choice id: 「${bare && bare[2]}」`);
});
