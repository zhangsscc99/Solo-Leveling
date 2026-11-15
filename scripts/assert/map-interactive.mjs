#!/usr/bin/env node
// F090 地图面板可交互：
//   ① 8 个章节节点各自是 <button>（键盘可达）且可点击展开/收起详情；
//   ② 锁定节点行内与详情都写清前置条件（含「需」字：需完成第N章主线 + 需 Lv.X），
//      全列表不允许「未解锁」孤文；
//   ③ 已通关章节可回看 summary/景数——只读，不写存档、不允许跳章。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const { post, advanceOnce } = await import("./_http.mjs");

const NAME = `e2e-map-${Date.now().toString(36)}`;

run("map-interactive", async ({ page }) => {
  await createSave(page, NAME);
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
  await page.waitForSelector(".map-list .map-node");

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

  // 状态三态各就其位（ch1 已通关 / ch2 当前 / ch3-8 锁定）
  const states = await page.locator(".map-node .map-state").allInnerTexts();
  assert(states.filter((s) => s.trim() === "已通关").length === 1, `expect 1 已通关 (${states})`);
  assert(states.filter((s) => s.trim() === "当前").length === 1, `expect 1 当前 (${states})`);
  assert(states.filter((s) => s.trim() === "锁定").length === 6, `expect 6 锁定 (${states})`);

  const mapText = await page.locator(".map-list").innerText();
  assert(!/未解锁/.test(mapText), `map still shows bare「未解锁」`);

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
  await detail.waitFor();
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
});
