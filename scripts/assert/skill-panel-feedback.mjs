#!/usr/bin/env node
// F155 行动栏「释放技能」展开回执：
//   点击后 .stage-col 必须新增一行含「技能」的系统回执（玩家分得清
//   「没反应」与「面板开了」），且 .bar-skills 抽屉真实展开。
//   前置：API 侧先把存档推进到真实交战态，再通过 localStorage 接入页面。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, assert, stageCount } = await import("../e2e/lib.mjs");
const { makeSave, act, fetchSaveView, advanceStep } = await import("./_http.mjs");

// API 侧逼遭遇：前进直到 save.combat 为真（死亡回溯也继续磨）。
async function engage(saveId, max = 60) {
  for (let i = 0; i < max; i++) {
    const { save } = await fetchSaveView(saveId);
    if (save.combat) return save;
    // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
    await advanceStep(saveId);
  }
  assert(false, `engage: ${max} actions without encounter`);
}

await run("skill-panel-feedback", async ({ page }) => {
  const saveId = await makeSave("f155");
  await engage(saveId);

  // localStorage 接入存档：App 启动回灌 save.combat → 战斗四键渲染。
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((id) => localStorage.setItem("solo_leveling_save_id", String(id)), saveId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");

  const skillBtn = page
    .locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "释放技能" })
    .first();
  await skillBtn.waitFor();
  assert(await skillBtn.isEnabled(), "「释放技能」disabled during engagement");

  const before = await stageCount(page);
  await skillBtn.click();
  await page.waitForSelector(".bar-skills");
  await page.waitForFunction(
    (n) => document.querySelector(".stage-col").children.length > n,
    before
  );

  // 新增行必须在原日志之后、内容含「技能」。
  const lastText = await page.locator(".stage-col > *:last-child").innerText();
  assert(lastText.includes("技能"), `receipt line lacks 技能: "${lastText.slice(0, 120)}"`);
  assert(
    await page.locator(".bar-skills").isVisible(),
    ".bar-skills drawer not visible after click"
  );

  // 收起不刷屏：再点一次，.stage-col 不再长行。
  const mid = await stageCount(page);
  await skillBtn.click();
  await page.waitForTimeout(400);
  assert(
    (await stageCount(page)) === mid,
    "closing the drawer should not append another receipt line"
  );
});
