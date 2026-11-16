#!/usr/bin/env node
// F129 contract: 未识别自由输入不得再直出开发期占位文案；裸面板名
// （背包/技能/属性/地图/任务/影子编队）由服务端路由成 reply.panel，
// 整条路径零副作用（hp/mp/gold/chapter/scene/exp 一律不动）。
// 两条入口都测：POST /action 与 POST /ai-action（降级路径同样不得
// 出现开发期措辞）。E2E_BASE_URL 已设时再用 playwright-core 验证
// 口述「地图」真的把地图抽屉顶开。
//
//   E2E_BASE_URL 默认 http://127.0.0.1:3020/game（API 断言与 UI 步骤同源，
//                避免只设其一时代理打到别的实例造成假绿/假红）
//   API_BASE     默认 `${E2E_BASE_URL}/api`，可独立覆盖
//   SL_SKIP_UI=1 跳过 UI 步骤（默认就跑，与 map-interactive 等 UI 断言一致）

const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
const API = (process.env.API_BASE || `${BASE}/api`).replace(/\/+$/, "");
const RUN_UI = process.env.SL_SKIP_UI !== "1";

// 开发期措辞黑名单：任意一条出现即判 FAIL。
const DEV_PROSE = /占位|尚未接入|命运之线|叙事引擎尚未接入/;

// 零副作用口径：动作前后逐字段比对，完全一致才算「没动世界」。
// exp 是字段名探针（存档列实为 xp，一并纳入）；level/deaths/rest_used/
// encounter_clock/encounter_cd 把「不占回合、不触发遭遇」也变成断言。
const STATE_KEYS = [
  "hp", "mp", "gold", "chapter", "scene", "exp", "xp",
  "level", "deaths", "rest_used", "encounter_clock", "encounter_cd",
];

// 面板名 → 期望 panel key。存档走既有 save 意图、乱码走 unknown 兜底，
// 两者允许无 panel，但 content 同样不得是占位句。
const CASES = [
  { input: "任务", panel: "quests" },
  { input: "背包", panel: "inventory" },
  { input: "技能", panel: "skills" },
  { input: "属性", panel: "stats" },
  { input: "地图", panel: "map" },
  { input: "存档", panel: null },
  { input: "xyzzy 敲敲墙", panel: null },
];

// 反向用例：含面板字眼的整句不得被裸面板名路由吞掉（防整句锚定退化成
// 子串匹配）。这些输入走正常意图结算——observe 写日志、rest 回血/推进
// 遭遇时钟，所以只断言 intent/panel，不做 STATE_KEYS 不变断言。
// intent 字段只有 /ai-action 回包下发；/action 只断言无 panel。
const NEG_CASES = [
  { input: "查看背包", intent: "observe" },
  { input: "我要休息一下", intent: "rest" },
  { input: "打开地图看看", intent: null },
];

function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

async function post(path, body, ms = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function getSave(saveId) {
  const res = await fetch(`${API}/saves/${saveId}`);
  const json = await res.json().catch(() => null);
  assert(res.status === 200 && json && json.save, `GET /saves/${saveId} failed (HTTP ${res.status})`);
  return json.save;
}

function stateSig(save) {
  return JSON.stringify(STATE_KEYS.map((k) => save[k]));
}

// ── 建档 ──
const name = `verify-F129-${Date.now().toString(36)}`;
const created = await post("/saves", { player_name: name });
assert(
  created.status === 201 && created.body && created.body.save && created.body.save.id,
  `create save failed (HTTP ${created.status})`
);
const sid = created.body.save.id;

for (const endpoint of ["/action", "/ai-action"]) {
  for (const c of CASES) {
    const before = await getSave(sid);
    const { status, body } = await post(endpoint, { save_id: sid, input: c.input });
    assert(status === 200, `${endpoint}「${c.input}」HTTP ${status}（期望 200）`);
    const reply = body && body.reply;
    const content = reply && reply.content;
    assert(typeof content === "string" && content.length > 0, `${endpoint}「${c.input}」回包无 reply.content`);
    assert(
      !DEV_PROSE.test(content),
      `${endpoint}「${c.input}」回包仍含开发期措辞：${content.slice(0, 80)}`
    );
    if (c.panel) {
      const panel = (reply && reply.panel) ?? body.panel;
      assert(
        panel === c.panel,
        `${endpoint}「${c.input}」期望 panel=${c.panel}，实际 ${JSON.stringify(panel)}`
      );
    }
    const after = await getSave(sid);
    assert(
      stateSig(after) === stateSig(before),
      `${endpoint}「${c.input}」存在副作用：${stateSig(before)} → ${stateSig(after)}`
    );
  }
  console.log(`[OK] ${endpoint} 未识别输入无占位文案、面板路由零副作用`);

  for (const c of NEG_CASES) {
    const { status, body } = await post(endpoint, { save_id: sid, input: c.input });
    assert(status === 200, `${endpoint}「${c.input}」HTTP ${status}（期望 200）`);
    const reply = body && body.reply;
    assert(
      reply && typeof reply.content === "string" && reply.content.length > 0,
      `${endpoint}「${c.input}」回包无 reply.content`
    );
    assert(
      !DEV_PROSE.test(reply.content),
      `${endpoint}「${c.input}」回包仍含开发期措辞：${reply.content.slice(0, 80)}`
    );
    const panel = (reply && reply.panel) ?? body.panel;
    assert(
      panel === undefined,
      `${endpoint}「${c.input}」不得被面板路由吞掉，实际 panel=${JSON.stringify(panel)}`
    );
    if (c.intent && endpoint === "/ai-action") {
      assert(
        body.intent === c.intent,
        `${endpoint}「${c.input}」期望 intent=${c.intent}，实际 ${JSON.stringify(body.intent)}`
      );
    }
  }
  console.log(`[OK] ${endpoint} 含面板字眼的整句不被面板路由吞掉`);
}

// ── UI 步骤（默认就跑；SL_SKIP_UI=1 显式跳过）──
// 口述「地图」→ dispatch 收到 reply.panel=map → openTab 顶开地图抽屉。
// 等待一律用 waitForSelector 轮询，不拿固定 sleep 当唯一等待条件；
// 整步失败重试 2 次（共 3 次）再判 FAIL。
if (!RUN_UI) {
  console.log("[SKIP] UI 步骤（SL_SKIP_UI=1）");
} else {
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
      // F136：UI 建档名必须与 API 建档不同名（同名现在会触发「继续/
      // 另起新档」对话框而非静默开档），且建档输入框 maxLength=20，
      // 每次尝试换独立短名防截断撞名。
      await page.fill(".gate-form input", `F129-${Date.now().toString(36)}-u${attempt}`.slice(0, 20));
      await page.click(".gate-form button[type=submit]");
      await page.waitForSelector(".status", { timeout: 15000 });
      const box = page.locator('input[aria-label="自由行动输入"]');
      await box.fill("地图");
      await page.locator('button[aria-label="发送"]').click();
      // 抽屉打开 + 地图列表真正渲染出节点，两个条件缺一不可。
      await page.waitForSelector(".sidebar.open .map-list .map-node", { timeout: 3000 });
      console.log(`[OK] UI：口述「地图」3000ms 内顶开地图面板（第 ${attempt} 次尝试）`);
    } catch (e) {
      lastErr = e;
    } finally {
      await ctx.close().catch(() => {});
    }
  }
  await browser.close().catch(() => {});
  if (lastErr) fail(`UI 步骤 3 次尝试均失败：${lastErr.message}`);
}

console.log("OK");
process.exit(0);
