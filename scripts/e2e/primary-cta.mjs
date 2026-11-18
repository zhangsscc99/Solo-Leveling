#!/usr/bin/env node
// F228 双视口「唯一主行动」验收：
//   · 390×844 与 1440×900 各开一份新档，首屏 button.cta-primary 恰好 1 颗、
//     可见且在视口内、位于 .actions-main；
//   · 同权重负向：.actions-main 内可点键只有主 CTA 的 box-shadow !== "none"，
//     其余键不得带发光阴影/亮描边；
//   · 剧情分支接管：save.next_choices ≥2 且有未锁定项时，主 CTA 文本须含
//     第一条未锁定选项 label，且「探索前进」槽不带 primary/cta-primary；
//   · 双视口均无横向溢出；
//   · 点主 CTA 并等动作回包后，button.cta-primary 仍恰好 1 颗（状态切换
//     不得造出两颗或归零）。
// 无实例环境（本地裸跑、调度器未注入 API_BASE/E2E_BASE_URL）按 SKIP 处理，
// 不算失败。
const BASE = (process.env.E2E_BASE_URL || (process.env.API_BASE ? process.env.API_BASE.replace(/\/api\/?$/, "") : "http://127.0.0.1:3020/game")).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { assert, createSave, run } = await import("./lib.mjs");

// 预检：实例不可达 → SKIP（exit 0）。调度器经 API_BASE 注入活实例时不会走到。
try {
  const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1500) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
} catch (e) {
  console.log(`[PRIMARY-CTA] SKIP：${BASE} 无实例（${e.message}）`);
  process.exit(0);
}

async function checkViewport(page, tag) {
  // ── 1) 首屏恰好 1 颗主 CTA ──
  const n = await page.locator("button.cta-primary").count();
  console.log(`    [${tag}] button.cta-primary 计数=${n}`);
  assert(n === 1, `[${tag}] button.cta-primary 应恰好 1 颗，实测 ${n}`);

  // ── 2) 可见 + 视口内 + .actions-main 内 ──
  const geo = await page.locator("button.cta-primary").first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      w: r.width,
      h: r.height,
      top: r.top,
      bottom: r.bottom,
      ih: window.innerHeight,
      inMain: Boolean(el.closest(".actions-main")),
      text: (el.textContent || "").replace(/\s+/g, ""),
    };
  });
  console.log(
    `    [${tag}] CTA「${geo.text}」rect top=${geo.top.toFixed(1)} bottom=${geo.bottom.toFixed(1)} ih=${geo.ih} inMain=${geo.inMain}`
  );
  assert(geo.w > 0 && geo.h > 0, `[${tag}] 主 CTA 不可见 w=${geo.w} h=${geo.h}`);
  assert(
    geo.top >= 0 && geo.bottom <= geo.ih + 1,
    `[${tag}] 主 CTA 不在视口内 top=${geo.top.toFixed(1)} bottom=${geo.bottom.toFixed(1)} ih=${geo.ih}`
  );
  assert(geo.inMain, `[${tag}] 主 CTA 不在 .actions-main 内`);

  // ── 3) 同权重负向：可点键只有主 CTA 带发光阴影 ──
  const peer = await page.evaluate(() =>
    [...document.querySelectorAll(".actions-main button:not(:disabled)")].map((el) => {
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || "").replace(/\s+/g, "").slice(0, 24),
        shadow: cs.boxShadow,
        border: cs.borderColor,
        cta: el.classList.contains("cta-primary"),
      };
    })
  );
  for (const p of peer) {
    if (p.cta) continue;
    assert(
      p.shadow === "none",
      `[${tag}] 非主键「${p.text}」带发光阴影 ${p.shadow}（border=${p.border}）`
    );
  }
  const ctaStyle = peer.find((p) => p.cta);
  assert(ctaStyle && ctaStyle.shadow !== "none", `[${tag}] 主 CTA 自身没有发光阴影`);
  console.log(
    `    [${tag}] 可点键 ${peer.length} 颗，仅 CTA 发光：shadow=${ctaStyle.shadow} border=${ctaStyle.border}`
  );

  // ── 4) 剧情分支接管：≥2 选项且有未锁定项时，第一条未锁定键即主 CTA ──
  const choice = await page.evaluate(() => {
    // 可读 label = 剔除 .rest-count 代价角标/.key-badge 角标的文本本体
    // （JSX 里 label 是按钮的首个文本节点）。
    const labelOf = (el) =>
      [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("")
        .replace(/\s+/g, "");
    const btns = [...document.querySelectorAll(".btn-group-choice .btn")];
    // 「探索前进」槽 = 行动组（非 sys/非 choice 的第一个 .btn-group）的第一颗按钮
    const advBtn = document.querySelector(
      ".actions-main .btn-group:not(.btn-group-sys):not(.btn-group-choice) .btn"
    );
    return {
      btns: btns.map((el) => ({
        label: labelOf(el),
        disabled: el.disabled,
        cta: el.classList.contains("cta-primary"),
      })),
      advCls: advBtn ? advBtn.className : "(无)",
    };
  });
  const unlocked = choice.btns.filter((b) => !b.disabled);
  if (choice.btns.length >= 2 && unlocked.length > 0) {
    const first = unlocked[0];
    assert(
      first.cta && geo.text.includes(first.label),
      `[${tag}] 分支接管失败：第一条未锁定选项「${first.label}」非主 CTA（CTA=「${geo.text}」）`
    );
    assert(
      !/\bprimary\b/.test(choice.advCls) && !/cta-primary/.test(choice.advCls),
      `[${tag}] 分支接管时「探索前进」槽仍带高亮：class="${choice.advCls}"`
    );
    console.log(`    [${tag}] 分支接管确认：主 CTA=「${first.label}」，探索槽 class="${choice.advCls}"`);
  } else {
    console.log(`    [${tag}] 当前无可接管分支（choices=${choice.btns.length} unlocked=${unlocked.length}）`);
  }

  // ── 5) 无横向溢出 ──
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  assert(overflow === 0, `[${tag}] 横向溢出 scrollWidth-clientWidth=${overflow}`);

  // ── 6) 点主 CTA 并等动作回包：主位仍恰好 1 颗 ──
  const respP = page.waitForResponse(
    (r) => r.url().includes("/api/") && r.request().method() === "POST",
    { timeout: 15000 }
  );
  await page.locator("button.cta-primary").first().click();
  await respP;
  // 回包落库后 React 重渲一帧再量——不赌固定毫秒，等计数回到 1。
  await page.waitForFunction(
    () => document.querySelectorAll("button.cta-primary").length === 1,
    null,
    { timeout: 4000 }
  );
  const n2 = await page.locator("button.cta-primary").count();
  console.log(`    [${tag}] 点击主 CTA 回包后 cta-primary 计数=${n2}`);
  assert(n2 === 1, `[${tag}] 状态切换后 cta-primary=${n2}（应为 1）`);
}

const NAME = `F228-${Date.now().toString(36)}`;

run(
  "primary-cta",
  async ({ page }) => {
    // 390 视口先跑（context 初始即此尺寸），再切 1440 复用同一页/实例。
    await page.setViewportSize({ width: 390, height: 844 });
    await createSave(page, `${NAME}-m`);
    await checkViewport(page, "390");
    console.log("[PRIMARY-CTA] PASS 390");

    await page.setViewportSize({ width: 1440, height: 900 });
    // 第二份新档：localStorage 残留上一档的 save_id 会让应用跳过 gate
    // 直接续档——先清掉再走 createSave 的登记流程。
    await page.evaluate(() => localStorage.removeItem("solo_leveling_save_id"));
    await createSave(page, `${NAME}-d`);
    await checkViewport(page, "1440");
    console.log("[PRIMARY-CTA] PASS 1440");
  },
  { viewport: { width: 390, height: 844 } }
);
