#!/usr/bin/env node
// F210 验收断言：390×844 下分支选项按钮必须包住自己的文字——
//
//   背景（玩家实测）：移动端 .btn-group-choice 沿用行动组 72px 栅格 +
//   white-space:nowrap + overflow:visible，长选项被推出按钮边界，
//   裸文字压在相邻按钮和背景网格上，相邻键互叠——选项是玩家唯一的
//   决策入口，读不全就选不了。
//
//   断言（每个场景逐一量）：
//     1) 每个 .btn-group-choice .btn：scrollWidth <= clientWidth + 1
//        （允许省略号，不允许文字溢出可见区）；
//     2) 同组按钮的 getBoundingClientRect 两两不相交（gap 生效）；
//     3) clientHeight 容得下至少一行文字（>= 计算行高）；
//     4) 每个按钮带非空 title（截断时给全文）；
//     5) footer.actions 无横向溢出（scrollWidth <= clientWidth + 1）。
//
//   场景路径（干净新档可稳定复现，无 seed/DB 锻造）：
//     新档落 ch1_double_gate（F124）→ 点「先放慢脚步，绕墙观察那些
//     石像」（observe 支，置 saw_statue_eyes 旗，ch1_worship 的
//     「盯住巨像的眼睛」选项 requires 该旗）→ ch1_law → 点「按石碑
//     所写，低头敬拜」（kneel 支）→ ch1_worship。三场景各量一次。
//     落点可能掷出遭遇战（实测 石像残兵 拦路）——交战态不铺选项键，
//     等待循环见到「逃跑」键就先撤离（失败会被拦下，循环再点），
//     脱战回到场景后选项组重新渲染再量。
//
//   旧码红证：旧码 nowrap 文字直出边界——实测三场景最差键
//   sw−cw = 120–204px（断言 1 必 FAIL；相邻键 rect 相交、footer
//   横向溢出同红）。
//
//   端点默认 http://127.0.0.1:3020/game，可用 SL_E2E_BASE（或
//   E2E_BASE_URL）覆盖：
//     PORT=3131 DB_PATH=/tmp/sl-f210.db node server/index.js &
//     SL_E2E_BASE=http://127.0.0.1:3131/game node scripts/assert/choice-buttons-fit.mjs
const BASE = (
  process.env.SL_E2E_BASE ||
  process.env.E2E_BASE_URL ||
  "http://127.0.0.1:3020/game"
).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;

const { run, createSave, assert } = await import("../e2e/lib.mjs");

const NAME = `f210-${Date.now().toString(36)}`;
const VW = 390;
const VH = 844;

await run(
  "choice-buttons-fit",
  async ({ page }) => {
    // 等某条 marker label 出现在选项键里——场景落位 + 脱战的信号。
    // 落点可能掷出遭遇战：交战态选项组整组不渲染，见到可用「逃跑」
    // 键就点（撤离失败会被拦下，循环再点），直到 marker 铺出。
    const markerPresent = (text) =>
      page.evaluate(
        (t) =>
          [...document.querySelectorAll(".btn-group-choice .btn")].some((b) =>
            b.textContent.includes(t)
          ),
        text
      );

    const ensureMarker = async (tag, text) => {
      for (let i = 0; i < 60; i++) {
        if (await markerPresent(text)) return;
        const fled = await page.evaluate(() => {
          const b = [...document.querySelectorAll(".actions .btn")].find(
            (x) => !x.disabled && x.textContent.includes("逃跑")
          );
          if (b) {
            b.click();
            return true;
          }
          return false;
        });
        await page.waitForTimeout(fled ? 700 : 250);
      }
      assert(
        false,
        `${tag}: marker 「${text}」 never appeared（遭遇战未脱战或落点错误）`
      );
    };

    const clickChoice = async (part) => {
      const btn = page.locator(".btn-group-choice .btn", { hasText: part }).first();
      await btn.waitFor({ state: "visible" });
      await btn.click();
    };

    const checkScene = async (tag) => {
      // 选项键铺出后给排版/字体一个落地节拍再量（栅格是同步布局，
      // 但回包渲染与按钮可量尺寸之间留一帧更稳）。
      await page.waitForTimeout(120);
      const m = await page.evaluate(() => {
        const btns = [...document.querySelectorAll(".btn-group-choice .btn")];
        const items = btns.map((b) => {
          const r = b.getBoundingClientRect();
          const cs = getComputedStyle(b);
          let lh = parseFloat(cs.lineHeight);
          if (!Number.isFinite(lh)) lh = parseFloat(cs.fontSize) * 1.2;
          // label 原文：剥掉代价角标（.rest-count）后的文本节点。
          let label = "";
          for (const n of b.childNodes) {
            if (n.nodeType === Node.TEXT_NODE) label += n.textContent;
          }
          return {
            label: label.trim(),
            title: b.getAttribute("title") || "",
            sw: b.scrollWidth,
            cw: b.clientWidth,
            ch: b.clientHeight,
            lh,
            x: r.x,
            y: r.y,
            w: r.width,
            h: r.height,
          };
        });
        const foot = document.querySelector("footer.actions");
        return {
          items,
          footer: foot ? { sw: foot.scrollWidth, cw: foot.clientWidth } : null,
        };
      });

      assert(
        m.items.length >= 2,
        `${tag}: expected >=2 choice buttons, got ${m.items.length}`
      );

      for (const it of m.items) {
        assert(
          it.sw <= it.cw + 1,
          `${tag}: 文字溢出按钮边界 —「${it.label}」sw=${it.sw} cw=${it.cw}`
        );
        assert(
          it.ch + 0.5 >= it.lh,
          `${tag}: 按钮容不下一行文字 —「${it.label}」ch=${it.ch} lh=${it.lh.toFixed(1)}`
        );
        assert(
          it.title.length > 0 && it.title.includes(it.label),
          `${tag}: 缺 title 全文 —「${it.label}」title=「${it.title}」`
        );
      }

      for (let i = 0; i < m.items.length; i++) {
        for (let j = i + 1; j < m.items.length; j++) {
          const a = m.items[i];
          const b = m.items[j];
          const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          assert(
            !(ox > 0.5 && oy > 0.5),
            `${tag}: 相邻按钮矩形相交 —「${a.label}」×「${b.label}」` +
              ` overlap=(${ox.toFixed(1)},${oy.toFixed(1)})`
          );
        }
      }

      assert(
        m.footer && m.footer.sw <= m.footer.cw + 1,
        `${tag}: footer.actions 横向溢出 sw=${m.footer && m.footer.sw} cw=${
          m.footer && m.footer.cw
        }`
      );

      console.log(
        `    ${tag}: ` +
          m.items
            .map(
              (i) => `「${i.label.slice(0, 12)}…」sw=${i.sw} cw=${i.cw}`
            )
            .join(" | ")
      );
    };

    await createSave(page, NAME);

    // ── ch1_double_gate：新档天然落点，≥2 选项铺出即量 ──────────
    await ensureMarker("ch1_double_gate", "绕墙观察");
    await checkScene("ch1_double_gate");

    // ── ch1_law：observe 支（置 saw_statue_eyes 旗）─────────────
    await clickChoice("绕墙观察");
    await ensureMarker("ch1_law", "低头敬拜");
    await checkScene("ch1_law");

    // ── ch1_worship：kneel 支 ───────────────────────────────────
    await clickChoice("低头敬拜");
    await ensureMarker("ch1_worship", "替她挡住正面");
    await checkScene("ch1_worship");
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
