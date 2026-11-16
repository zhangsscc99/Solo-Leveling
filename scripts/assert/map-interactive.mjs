#!/usr/bin/env node
// F090 地图面板可交互：
//   ① 8 个章节节点各自是 <button>（键盘可达）且可点击展开/收起详情；
//   ② 门禁文案由服务端下发（F116）：软门节点写「可强行进入」不得写「锁定」；
//      真锁节点行内与详情都写清前置条件（含「需」字），全列表不允许
//      「未解锁」孤文；
//   ③ 已通关章节可回看 summary/景数——只读，不写存档、不允许跳章。
//
// 可复现性（F105）：report.sh 顺序跑时本脚本偶发超时。等待一律 settle 到
// 真实状态（网络空闲 + 目标元素 attached/visible，无固定 sleep），整段
// 包一次自动重试（打日志报第几次），Playwright 默认超时放宽到 45s。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { advanceOnce } = await import("./_http.mjs");

const NAME = `e2e-map-${Date.now().toString(36)}`;
const MAX_ATTEMPTS = 2; // 首跑 + 一次自动重试

async function attemptOnce(page) {
  // 干净起点：清掉上次（重试时）残留的 save_id，等网络空闲再走门。
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => localStorage.clear());
  await createSave(page, NAME);
  await page.waitForLoadState("networkidle");
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // 走到第 2 章：ch1 主线 7 景 + 1 次过门。F096 收尾后守关者是硬门，
  // 掷逃穿房已封死——见敌就打的驱动（fight:"all"）展开成真实操作序列
  // 直到 chapter 变 2。
  for (let i = 0; i < 120; i++) {
    const body = await advanceOnce(saveId, { fight: "all" });
    if (body.save.chapter >= 2) break;
  }

  await page.locator(".btn-group-sys .btn", { hasText: "地图" }).first().click();
  await page.waitForSelector(".sidebar.open");
  await page.waitForSelector(".map-list .map-node", { state: "visible" });

  const nodes = page.locator(".map-list .map-node");
  const count = await nodes.count();
  assert(count === 8, `expect 8 chapter nodes (got ${count})`);

  // ① 每个节点都是原生 <button> 且可点击
  for (let i = 0; i < count; i++) {
    const btn = nodes.nth(i).locator("button.map-btn");
    assert((await btn.count()) === 1, `node ${i + 1} has no button`);
    const tag = await btn.evaluate((el) => el.tagName);
    assert(tag === "BUTTON", `node ${i + 1} interactive element is ${tag}, not BUTTON`);
    assert(await btn.isEnabled(), `node ${i + 1} button is disabled`);
  }

  // 状态各就其位（ch1 已通关 / ch2 当前 / ch3 软门「可强行进入」/
  // ch4-8 真锁「锁定」）——F116：前置章腿已满足的门是软门，不得写锁定。
  const states = await page.locator(".map-node .map-state").allInnerTexts();
  assert(states.filter((s) => s.trim() === "已通关").length === 1, `expect 1 已通关 (${states})`);
  assert(states.filter((s) => s.trim() === "当前").length === 1, `expect 1 当前 (${states})`);
  assert(
    states.filter((s) => s.trim() === "可强行进入").length === 1,
    `expect 1 可强行进入 soft gate (${states})`
  );
  assert(states.filter((s) => s.trim() === "锁定").length === 5, `expect 5 锁定 (${states})`);

  const mapText = await page.locator(".map-list").innerText();
  assert(!/未解锁/.test(mapText), `map still shows bare「未解锁」`);

  // F116 软门诚实表述：ch3 节点行内写「可强行进入/推荐」，绝无「锁定」
  const soft = page.locator(".map-node.map-soft");
  assert((await soft.count()) === 1, `expect exactly 1 soft-gated node (${await soft.count()})`);
  const softText = (await soft.first().innerText()).replace(/\s+/g, "");
  assert(
    !softText.includes("锁定") && /可强行进入|推荐/.test(softText),
    `soft-gated node must honestly say 可强行进入/推荐, not 锁定: "${softText.slice(0, 80)}"`
  );

  // ② 锁定节点：行内必带前置条件；点开详情出现含「需」字的原因
  const locked = page.locator(".map-node.map-locked");
  const lockedCount = await locked.count();
  for (let i = 0; i < lockedCount; i++) {
    const t = (await locked.nth(i).innerText()).replace(/\s+/g, "");
    assert(t.includes("需"), `locked node ${i} missing requirement inline: "${t.slice(0, 60)}"`);
  }
  await locked.last().locator("button.map-btn").click();
  const lockDetails = page.locator(".map-node.map-locked .map-detail");
  assert((await lockDetails.count()) === 1, "locked detail did not open");
  const lt = (await lockDetails.first().innerText()).replace(/\s+/g, "");
  assert(lt.includes("需"), `locked detail lacks requirement: "${lt.slice(0, 80)}"`);
  assert(/需完成第\d+章主线/.test(lt), `locked detail missing 主线前置: "${lt.slice(0, 100)}"`);
  assert(/需Lv\.\d+/.test(lt), `locked detail missing 等级前置: "${lt.slice(0, 100)}"`);

  // ③ 已通关章节：点开可回看 summary + 景数
  const clearedNode = page.locator(".map-node.map-cleared").first();
  assert((await clearedNode.count()) === 1, "no cleared node after crossing to ch2");
  await clearedNode.locator("button.map-btn").click();
  const detail = clearedNode.locator(".map-detail");
  await detail.waitFor({ state: "visible" });
  const dt = await detail.innerText();
  assert(dt.replace(/\s/g, "").length > 30, `cleared detail too thin: "${dt.slice(0, 80)}"`);
  assert(/景/.test(dt), `cleared detail missing 景数: "${dt.slice(0, 80)}"`);
  const summary = await clearedNode.locator(".map-summary").innerText();
  assert(summary.trim().length > 20, `summary missing/too short: "${summary.slice(0, 40)}"`);

  // 展开/收起切换：再点一次详情消失
  await clearedNode.locator("button.map-btn").click();
  assert((await clearedNode.locator(".map-detail").count()) === 0, "detail did not collapse");

  // 只读确认：点开详情后 save.chapter 不变（不允许跳章、不改存档）
  const after = await fetch(`${BASE}/api/saves/${saveId}`).then((r) => r.json());
  assert(after.save.chapter === 2, `save.chapter drifted to ${after.save.chapter} (read-only violated)`);
}

run("map-interactive", async ({ page }) => {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await attemptOnce(page);
      if (attempt > 1) console.log(`[E2E] map-interactive attempt ${attempt} PASS (after retry)`);
      return;
    } catch (e) {
      lastErr = e;
      console.log(
        `[E2E] map-interactive attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message}` +
          (attempt < MAX_ATTEMPTS ? " — retrying" : "")
      );
    }
  }
  throw lastErr;
}, { timeoutMs: 45000 });
