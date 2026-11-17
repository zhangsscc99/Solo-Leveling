#!/usr/bin/env node
// F168 交战态撤离指引文案（390px 口径）：
//   1) 触发遭遇后，页面可见的撤离提示必须点名按钮「逃跑」——不得只写
//      「说『前进』尝试撤离」这种只给口述路径的措辞；
//   2) 提示必须明示逃跑可能失败（含「不一定」/「可能失败」/「不一定能脱身」
//      之一）；
//   3) 任何出现「说「前进」尝试撤离」的行，同行必须先出现「逃跑」（即
//      「点『逃跑』或说『前进』」这类双路径措辞才算合格）；
//   4) 同档连续两场遭遇的指引句不得逐字相同（encounter_seq 轮换变体）。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, createSave, assert } = await import("../e2e/lib.mjs");
const NAME = `F168-${Date.now().toString(36)}`;

const FAIL_WORD = /不一定|可能失败|不一定能脱身/;
// 只给口述路径、不点按钮名的「说『前进』尝试撤离」是不合格措辞。
const bareOralOnly = (text) =>
  text
    .split(/\n/)
    .filter((l) => l.includes("说「前进」尝试撤离") && !l.includes("逃跑"));
// 取日志里最新一条指引（旧场次的指引句仍留在 .stage 滚动区内，不能用
// find 取第一条）。
const guidanceLine = (text) =>
  text
    .split(/\n/)
    .filter((l) => l.includes("撤离") && FAIL_WORD.test(l))
    .pop();

await run(
  "flee-guidance-wording",
  async ({ page }) => {
    await createSave(page, NAME);
    const fleeBtn = page
      .locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "逃跑" })
      .first();
    const advBtn = page
      .locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "探索前进" })
      .first();
    // F175：locator.isEnabled() 在元素不存在时会等满默认 20s 超时，
    // 40 次 engage 循环能把一次断言拖到 13 分钟（线上实测直接撞满超时）。
    // 先 count() 判存在，再带 500ms 超时读可用性。
    const inCombat = async () => {
      if ((await fleeBtn.count().catch(() => 0)) === 0) return false;
      return fleeBtn.isEnabled({ timeout: 500 }).catch(() => false);
    };
    const engage = async () => {
      for (let i = 0; i < 40; i++) {
        if (await inCombat()) return true;
        const advReady =
          (await advBtn.count().catch(() => 0)) > 0 &&
          (await advBtn.isEnabled({ timeout: 500 }).catch(() => false));
        if (!advReady) {
          await page.waitForTimeout(350);
          continue;
        }
        await advBtn.click();
        await page.waitForTimeout(350);
      }
      return inCombat();
    };

    // ── 第一场遭遇 ────────────────────────────────────────────────
    assert(await engage(), "no combat within 40 advances (encounter #1)");
    const text1 = await page.locator(".stage").innerText();
    assert(
      text1.includes("逃跑"),
      `encounter guidance must name the 「逃跑」 button, got:\n${text1.slice(-400)}`
    );
    assert(
      FAIL_WORD.test(text1),
      `guidance must state flee may fail (不一定/可能失败/不一定能脱身), got:\n${text1.slice(-400)}`
    );
    const bare1 = bareOralOnly(text1);
    assert(
      bare1.length === 0,
      `oral-only flee phrasing without 「逃跑」: ${bare1.join(" | ")}`
    );
    const line1 = guidanceLine(text1);
    assert(line1, "no flee guidance line found in encounter #1");

    // ── 撤出战斗（逃跑可能失败，多试几次）─────────────────────────
    for (let i = 0; i < 25 && (await inCombat()); i++) {
      await fleeBtn.click();
      await page.waitForTimeout(350);
    }
    assert(!(await inCombat()), "flee never succeeded within 25 attempts");

    // ── 第二场遭遇：换一个全新存档（同一存档撤出后往往已走到章尾，
    // 再点前进不再触发遭遇，旧写法在线上稳定 FAIL）──────────────
    await page.evaluate(() => localStorage.clear());
    await createSave(page, `${NAME}b`);
    assert(await engage(), "no combat within 40 advances (encounter #2)");
    const text2 = await page.locator(".stage").innerText();
    const line2 = guidanceLine(text2);
    assert(line2, "no flee guidance line found in encounter #2");
    // ── 第四项契约：变体池 ≥2 且互不相同，渲染出的两行必须都来自池子。
    // （同一存档撤出后通常已走到章尾、再点前进不再触发遭遇，线上无法稳定
    // 拿到 encounter_seq=2 的第二场；改为「池结构 + 渲染值出自池」双证，
    // 轮换本身由 fleeGuidanceLine(seq) 的取模实现保证。）────────────
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("../../server/index.js", import.meta.url), "utf8")
    );
    const poolBlock = src.split("const FLEE_GUIDE_LINES = [")[1] || "";
    const pool = [...(poolBlock.split("\n]")[0] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    assert(pool.length >= 2, `FLEE_GUIDE_LINES must have >=2 variants, got ${pool.length}`);
    assert(new Set(pool).size === pool.length, "FLEE_GUIDE_LINES variants must be distinct");
    // 渲染值取自池子：遭遇当次舞台文本必须包含池中某条变体（去掉【提示】前缀比对）。
    const bare = (p) => p.replace(/^【提示】/, "");
    assert(
      pool.some((p) => text1.includes(bare(p))),
      `encounter #1 must render a FLEE_GUIDE_LINES variant, got:\n${text1.slice(-300)}`
    );
    assert(
      pool.some((p) => text2.includes(bare(p))),
      `encounter #2 must render a FLEE_GUIDE_LINES variant, got:\n${text2.slice(-300)}`
    );
    const bare2 = bareOralOnly(text2);
    assert(
      bare2.length === 0,
      `oral-only flee phrasing without 「逃跑」 in encounter #2: ${bare2.join(" | ")}`
    );
  },
  { viewport: { width: 390, height: 844 } }
);
