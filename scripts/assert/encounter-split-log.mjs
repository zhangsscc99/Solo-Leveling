#!/usr/bin/env node
// F167 遭遇播报拆条契约（UI 渲染层）：
//   服务端把「剧情正文 + （体力消耗…）+【遭遇】段 +【系统】状态提示
//   教学段」拼进同一条日志下发；客户端必须在渲染层按段落把【遭遇】段
//   与【系统】教学段拆成独立的 .stage-col 子节点——回灌旧行同规则。
//
//   (a) 触发遭遇的那次「探索前进」，回复在 .stage-col 新增 ≥2 个条目；
//   (b) 含「【遭遇】」的条目不含「（体力消耗」；
//   (c) 含「（体力消耗」的条目不含「【遭遇】」；
//   (d) 遭遇条目 innerText < 400 字符；
//   (e) 刷新后历史行按同一规则拆（遭遇条目仍与代价行分离）；
//   (f) 390px 与 1440px 均无横向溢出（scrollWidth === clientWidth），
//       全程无 console error / pageerror。
//
//   E2E_BASE_URL 指向隔离实例（默认 https://openfolio.uk/game）。
import { run, createSave, assert } from "../e2e/lib.mjs";

const NAME = `F167-${Date.now().toString(36)}`;

const stageKids = (page) =>
  page.locator(".stage-col > *").evaluateAll((els) => els.map((el) => el.innerText));

// 点「探索前进」并等 /action 回包完整落地——按钮派发的是指令形态「前进」，
// 必然走 /action（自然语言长句才分流 /ai-action）。
async function clickAdvance(page) {
  const btn = page.locator(".actions-main .btn", { hasText: "探索前进" }).first();
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/action") && r.request().method() === "POST"
    ),
    btn.click(),
  ]);
  await resp.finished().catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".pending"));
}

run(
  "encounter-split-log",
  async ({ page }) => {
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrs.push(String(e)));

    await createSave(page, NAME);
    await page.waitForSelector(".stage-col .narration, .stage-col .holo");

    // ── 连点「探索前进」直到出现【遭遇】（pity=4 保底，15 次足够）──
    let hitAt = -1;
    let n0 = 0;
    for (let i = 0; i < 15 && hitAt < 0; i++) {
      const before = (await page.locator(".stage-col > *").count());
      // 交战一旦开始行动组被战斗五键换掉，「探索前进」不复存在——
      // 但那时【遭遇】必然已经出现，循环会先一步 break。
      if (!(await page.locator(".actions-main .btn", { hasText: "探索前进" }).count())) break;
      n0 = before;
      await clickAdvance(page);
      const texts = await stageKids(page);
      if (texts.slice(before).some((t) => t.includes("【遭遇】"))) hitAt = before;
    }
    assert(hitAt >= 0, "15 次「探索前进」内没有出现【遭遇】播报");

    // ── (a) 该次点击新增 ≥2 个回复条目（回显 .echo 之外）──
    const kids = await page.locator(".stage-col > *").evaluateAll((els) =>
      els.map((el) => ({ cls: el.className, text: el.innerText }))
    );
    const fresh = kids.slice(hitAt);
    const replies = fresh.filter((k) => !k.cls.split(/\s+/).includes("echo"));
    assert(
      fresh.length >= 2 && replies.length >= 2,
      `(a) 遭遇点击只新增 ${fresh.length} 个条目（回复 ${replies.length} 条），期望回复 ≥2`
    );

    // ── (b)(c)(d) 遭遇条目与代价行分属不同条目 ──
    const enc = replies.filter((k) => k.text.includes("【遭遇】"));
    assert(enc.length >= 1, "(b) 新增条目里没有含「【遭遇】」者");
    for (const k of enc) {
      assert(
        !k.text.includes("（体力消耗") && !k.text.includes("（没有消耗"),
        `(b) 遭遇条目混入代价行：${k.text.slice(0, 80)}`
      );
      assert(
        k.text.length < 400,
        `(d) 遭遇条目 innerText ${k.text.length} 字，期望 <400：${k.text.slice(0, 60)}…`
      );
    }
    const cost = replies.filter((k) => k.text.includes("（体力消耗"));
    for (const k of cost) {
      assert(
        !k.text.includes("【遭遇】"),
        `(c) 代价行条目混入【遭遇】：${k.text.slice(0, 80)}`
      );
    }

    // ── (f-390) 390px 无横向溢出 ──
    const noX390 = await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth
    );
    assert(noX390, "(f) 390px 下出现横向溢出（scrollWidth > clientWidth）");

    // ── (e) 刷新后历史行按同一规则拆 ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForFunction(
      () => document.querySelectorAll(".stage-col > *").length > 0 && !document.querySelector(".pending")
    );
    const hist = await stageKids(page);
    const histEnc = hist.filter((t) => t.includes("【遭遇】"));
    assert(histEnc.length >= 1, "(e) 刷新后日志里找不到含【遭遇】的条目");
    for (const t of histEnc) {
      assert(
        !t.includes("（体力消耗") && !t.includes("（没有消耗"),
        `(e) 刷新后遭遇条目与代价行同条（未按同一规则拆）：${t.slice(0, 80)}`
      );
    }
    const histCost = hist.filter((t) => t.includes("（体力消耗"));
    for (const t of histCost) {
      assert(
        !t.includes("【遭遇】"),
        `(e) 刷新后代价行条目混入【遭遇】：${t.slice(0, 80)}`
      );
    }

    // ── (f-1440) 拉伸到 1440 仍无横向溢出 ──
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(300);
    const noX1440 = await page.evaluate(
      () => document.documentElement.scrollWidth === document.documentElement.clientWidth
    );
    assert(noX1440, "(f) 1440px 下出现横向溢出（scrollWidth > clientWidth）");

    assert(consoleErrs.length === 0, `console error: ${consoleErrs.join(" | ")}`);
    console.log(`    遭遇拆条：回复 ${replies.length} 条，遭遇条目 ${enc[0].text.length} 字`);
  },
  { viewport: { width: 390, height: 844 } }
);
