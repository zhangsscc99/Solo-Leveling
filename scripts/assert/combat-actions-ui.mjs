#!/usr/bin/env node
// F094/F113/F163 战斗操作入口 + 交战期动作门禁：
//   a) 无敌人：战斗五键折叠为单行矮入口 .combat-entry——存在、disabled、
//      aria-disabled="true"，文案含「当前没有可攻击的目标」；五键本体
//      不再常驻渲染；
//   b) 真实 UI 输入触发遭遇后五键可用：点「攻击」→ 日志新增「第N回合」，
//      HP/敌人 HP 至少其一真实变化（击杀收场按「击败」播报计）；
//   c) 技能按钮文案含 MP + 数字与冷却；点击真实扣 MP（= mp_cost），日志与
//      面板同源（播报含技能名）；冷却中 →「冷却中 N 回合」disabled；
//      MP 不足（DB 落点压 MP）→ disabled +「MP 不足」；未解锁 →「需 Lv.N」；
//   d) 交战中「休息」不恢复 HP（前后不变）+ 拒绝文案 + refused 标记；
//      「潜行/存档」不产生免费收益（MP 不动、存档按钮 disabled、拒绝文案）；
//   e) 390×844 视口：五键 boundingBox 全在视口内、高度 ≥44px、可点；
//      footer.actions ≤ 30% 视口高、.stage ≥ 60%；行动组每行 ≤4 键且
//      每个按钮 boundingBox().width ≥ 72。
// 稳定性：关键动作后 settle 等待；整套断言失败重试一次（F087 口径）。
const BASE = (process.env.E2E_BASE_URL || "http://127.0.0.1:3020/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { loadPW, findChrome, createSave, assert, readVitals } = await import("../e2e/lib.mjs");
const { fetchSaveView, mustChoosePick } = await import("./_http.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const dbPath =
  process.env.DB_PATH || process.env.SL_GAME_DB || path.join(ROOT, "data", "game.db");
const Database = require("better-sqlite3");
const db = new Database(dbPath);

// 觉醒输入框 maxLength=20：NAME + "-" + attempt 序号必须 ≤20，
// 否则尾部被截断、同一进程两次 attempt 撞同名档弹「继续/另起新档」。
const NAME = `e2e-f094-${Date.now().toString(36).slice(-5)}-${Math.random().toString(36).slice(2, 5)}`;
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// 当前步骤标记：失败日志带上下文（attempt/STEP/url），不再只留 fetch failed。
let STEP = "boot";

// 行动组（第一组）内的按钮定位——排除系统组。
const combatBtn = (page, label) =>
  page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: label }).first();

// 自由行动输入框发指令，等 /action 回包完整落地并返回响应 JSON。
async function send(page, text) {
  STEP = `send(${text})`;
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 保证处于交战态：击杀冷却期「攻击」必空挥，先「前进」磨冷却再逼遭遇。
async function ensureEngaged(page, saveId) {
  STEP = "ensureEngaged";
  for (let i = 0; i < 20; i++) {
    if (await combatBtn(page, "攻击").isEnabled().catch(() => false)) return;
    const s = (await fetchSaveView(saveId)).save;
    if (s.combat) {
      // UI 尚未刷新到交战态（刚结算完），多等一拍再判。
      await settle(page);
      continue;
    }
    const r = await send(page, s.encounter_cd > 0 ? "前进" : "攻击");
    // P204 must_choose：被标场景拒绝无显式选项的「前进」——补发主线选项
    // 让场景真正推进，否则整轮在这里空转到超时（曾造成连跑必崩）。
    if (r && r.refused === true) {
      const pick = mustChoosePick((r.save && r.save.scene) || s.scene);
      if (pick) await send(page, `选择 ${pick.id}`);
    }
    await settle(page, 350);
  }
  assert(await combatBtn(page, "攻击").isEnabled(), "ensureEngaged: never entered combat");
}

async function body(page, saveId) {
  // ── a) 无敌人：战斗入口折叠为单行矮槽位，四键本体不常驻 ──────────
  STEP = "a) combat-entry";
  await page.waitForSelector(".combat-entry");
  const entry = page.locator(".combat-entry");
  assert((await entry.count()) === 1, "combat entry missing (expect exactly one)");
  assert(await entry.isVisible(), "combat entry not visible");
  assert(await entry.isDisabled(), "combat entry should be disabled with no engagement");
  assert(
    (await entry.getAttribute("aria-disabled")) === "true",
    "combat entry missing aria-disabled=\"true\""
  );
  const entryText = (await entry.innerText()).replace(/\s+/g, "");
  assert(
    entryText.includes("当前没有可攻击的目标"),
    `combat entry copy wrong: "${entryText}"`
  );
  {
    const box = await entry.boundingBox();
    assert(box && box.height >= 28 && box.height <= 44, `combat entry height ${box?.height}px out of 28–44 slim row`);
  }
  for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
    assert(
      (await combatBtn(page, label).count()) === 0,
      `「${label}」should be folded into .combat-entry with no engagement`
    );
  }

  // ── b) 触发遭遇 → 五键可用 →「攻击」结算一回合 ──────────────────
  STEP = "b) engage+attack";
  await ensureEngaged(page, saveId);
  await settle(page);
  for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
    assert(await combatBtn(page, label).isEnabled(), `「${label}」disabled during engagement`);
  }
  // 探索组在交战态应整体让位（服务端门禁同口径）。
  assert(
    (await page.locator(".btn-group:not(.btn-group-sys) .btn", { hasText: "探索前进" }).count()) === 0,
    "探索前进 should be replaced by combat group during engagement"
  );

  {
    // 点行动栏「攻击」：日志新增「第N回合」，HP/敌 HP 有变化（miss 合法，
    // 至多补点到第三次；击杀收场按「击败」播报视为敌 HP 归零的变化）。
    let changed = false;
    for (let i = 0; i < 3 && !changed; i++) {
      const vit0 = await readVitals(page);
      const enemy0 = await page
        .locator(".combatant-enemy .gauge-num")
        .innerText()
        .catch(() => null);
      const [resp] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/action") && r.request().method() === "POST"
        ),
        combatBtn(page, "攻击").click(),
      ]);
      await resp.finished().catch(() => {});
      const json = await resp.json().catch(() => null);
      await settle(page);
      assert(json && /第\s*\d+\s*回合/.test(json.reply?.content || ""), "attack reply lacks 第N回合");
      const stage = await page.locator(".stage").innerText();
      assert(/第\s*\d+\s*回合/.test(stage), "stage log missing 第N回合 after attack");
      const vit1 = await readVitals(page);
      const enemy1 = await page
        .locator(".combatant-enemy .gauge-num")
        .innerText()
        .catch(() => null);
      changed =
        vit1.hp.v !== vit0.hp.v ||
        enemy1 !== enemy0 ||
        /击败|倒下了/.test(json.reply?.content || "");
    }
    assert(changed, "attack never changed player/enemy HP within 3 clicks");
  }

  // ── c) 技能按钮：MP/冷却文案 + 真实扣 MP + 日志同源 ──────────────
  STEP = "c) skill cast";
  await ensureEngaged(page, saveId);
  await combatBtn(page, "释放技能").click();
  await page.waitForSelector(".bar-skills");
  const rows = page.locator(".bar-skill");
  assert((await rows.count()) >= 1, "skill list empty");
  const firstText = await rows.first().innerText();
  assert(/MP\s*\d+/.test(firstText), `skill button lacks MP number: "${firstText}"`);
  assert(/冷却\s*\d+/.test(firstText), `skill button lacks cooldown: "${firstText}"`);

  {
    const tiger = page.locator(".bar-skill", { hasText: "猛虎猛击" });
    assert((await tiger.count()) === 1, "skill list missing 猛虎猛击");
    const mpBefore = (await readVitals(page)).mp.v;
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
      tiger.click(),
    ]);
    await resp.finished().catch(() => {});
    const json = await resp.json().catch(() => null);
    await settle(page);
    const mpAfter = (await readVitals(page)).mp.v;
    assert(
      mpBefore - mpAfter === 12,
      `skill cast must drain exactly mp_cost=12: ${mpBefore} -> ${mpAfter}`
    );
    // 日志与面板同源：播报含技能名，且 MP 变化在回包 save 与顶栏一致。
    assert(
      (json?.reply?.content || "").includes("猛虎猛击") ||
        (await page.locator(".stage").innerText()).includes("猛虎猛击"),
      "skill name missing from combat log"
    );
    assert(
      json?.save?.mp === mpAfter,
      `status bar MP ${mpAfter} diverges from action reply ${json?.save?.mp}`
    );
    // 仍在交战：该技能行应变「冷却中 N 回合」且 disabled（冷却真实挂表）。
    if (json?.save?.combat) {
      await page.waitForSelector(".bar-skills");
      const t2 = page.locator(".bar-skill", { hasText: "猛虎猛击" });
      assert(await t2.isDisabled(), "cast skill should enter cooldown");
      assert(
        /冷却中\s*\d+\s*回合/.test(await t2.innerText()),
        `cooldown reason missing: "${await t2.innerText()}"`
      );
    }
  }

  // ── d) 交战门禁：休息/潜行/存档零收益 + 拒绝文案 + refused ──────
  STEP = "d) combat gates";
  await ensureEngaged(page, saveId);
  {
    const vit0 = await readVitals(page);
    const r = await send(page, "休息");
    await settle(page);
    assert(r && r.refused === true, `combat rest must carry refused:true, got ${JSON.stringify(r && Object.keys(r))}`);
    assert(/无法休息|此刻无法/.test(r.reply?.content || ""), `combat rest refusal missing: ${(r?.reply?.content || "").slice(0, 120)}`);
    const vit1 = await readVitals(page);
    assert(
      vit1.hp.v === vit0.hp.v && vit1.mp.v === vit0.mp.v,
      `combat rest granted recovery: ${vit0.hp.v}/${vit0.mp.v} -> ${vit1.hp.v}/${vit1.mp.v}`
    );
    const r2 = await send(page, "潜行");
    await settle(page);
    assert(r2 && r2.refused === true, "combat sneak must carry refused:true");
    const vit2 = await readVitals(page);
    assert(
      vit2.mp.v === vit0.mp.v,
      `combat sneak must not move MP: ${vit0.mp.v} -> ${vit2.mp.v}`
    );
    // 存档按钮交战禁用（前台同步服务端门禁）；指令通道同样拒绝。
    const saveBtn = page.locator(".btn-group-sys .btn", { hasText: "存档" }).first();
    assert(await saveBtn.isDisabled(), "存档 button should be disabled during engagement");
    const r3 = await send(page, "存档");
    await settle(page);
    assert(r3 && r3.refused === true, "combat save must carry refused:true");
    assert(/无法存档|此刻无法/.test(r3.reply?.content || ""), `combat save refusal missing: ${(r3?.reply?.content || "").slice(0, 120)}`);
  }

  // ── c') MP 不足 / 需 Lv.N：DB 落点压低 MP、清冷却，重载回灌 ──────
  STEP = "c') MP-不足/需Lv.N";
  await ensureEngaged(page, saveId);
  {
    db.prepare("UPDATE saves SET mp = ?, skill_cd_json = '{}' WHERE id = ?").run(6, saveId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await settle(page, 600);
    assert(
      await combatBtn(page, "释放技能").isEnabled(),
      "combat state lost after reload (DB combat row should persist)"
    );
    await combatBtn(page, "释放技能").click();
    await page.waitForSelector(".bar-skills");
    const tiger = page.locator(".bar-skill", { hasText: "猛虎猛击" });
    assert(await tiger.isDisabled(), "MP-不足 skill should be disabled");
    assert(
      (await tiger.innerText()).includes("MP 不足"),
      `MP-不足 reason missing: "${await tiger.innerText()}"`
    );
    const locked = page.locator(".bar-skill", { hasText: "统治者之权能" });
    assert(await locked.isDisabled(), "locked skill should be disabled");
    assert(
      /需\s*Lv\.\s*\d+/.test(await locked.innerText()),
      `需 Lv.N reason missing: "${await locked.innerText()}"`
    );
    await combatBtn(page, "释放技能").click(); // 收起技能列表再测移动端
  }

  // ── e) 390×844：五键全在视口内、≥44px、可点；底栏 ≤30%、正文 ≥60% ──
  STEP = "e) 390x844 layout";
  {
    await page.setViewportSize({ width: 390, height: 844 });
    await settle(page, 500);
    for (const label of ["攻击", "释放技能", "防御", "道具", "逃跑"]) {
      const b = combatBtn(page, label);
      const box = await b.boundingBox();
      assert(box, `「${label}」no boundingBox @390`);
      assert(
        box.x >= -0.5 && box.y >= -0.5 && box.x + box.width <= 390.5 && box.y + box.height <= 844.5,
        `「${label}」out of viewport @390: ${JSON.stringify(box)}`
      );
      assert(box.height >= 44, `「${label}」touch height ${box.height}px < 44px`);
      assert(await b.isEnabled(), `「${label}」not clickable @390`);
    }
    // F113/F119 高度预算：footer.actions ≤30% 视口、.stage ≥60%。
    const foot = await page.locator(".actions").boundingBox();
    const stageBox = await page.locator(".stage").boundingBox();
    assert(foot && stageBox, "footer.actions/.stage boundingBox missing @390");
    console.log(
      `    (e) 390×844 footer.actions=${foot.height.toFixed(1)}px (${((foot.height / 844) * 100).toFixed(1)}%), stage=${stageBox.height.toFixed(1)}px (${((stageBox.height / 844) * 100).toFixed(1)}%)`
    );
    assert(
      foot.height <= 844 * 0.3,
      `footer.actions height ${foot.height}px > 30% viewport (limit 253.2px)`
    );
    assert(
      stageBox.height >= 844 * 0.6,
      `.stage height ${stageBox.height}px < 60% viewport (need ≥506.4px)`
    );
    // 行动组每行 ≤4 键、每键 ≥72px 宽（四字标签舒适宽度）。
    const rows = await page
      .locator(".btn-group:not(.btn-group-sys) .btn")
      .evaluateAll((els) => {
        const items = els
          .map((el) => {
            const r = el.getBoundingClientRect();
            return { y: r.y, w: r.width };
          })
          .sort((a, b) => a.y - b.y);
        const out = [];
        for (const it of items) {
          const last = out[out.length - 1];
          if (last && Math.abs(it.y - last.y) < 20) last.widths.push(it.w);
          else out.push({ y: it.y, widths: [it.w] });
        }
        return out;
      });
    assert(rows.length >= 1, "action group has no visible buttons @390");
    console.log(
      `    (e) action rows: ${rows.map((r) => r.widths.length).join("+")} per row, widths ${rows
        .map((r) => r.widths.map((w) => w.toFixed(0)).join(","))
        .join(" | ")}`
    );
    for (const row of rows) {
      assert(row.widths.length <= 4, `action row @390 has ${row.widths.length} buttons (>4)`);
      for (const w of row.widths) {
        assert(w >= 72, `action button width ${w.toFixed(1)}px < 72px @390`);
      }
    }
  }
}

// F087 口径：整套断言失败重试一次（每次开新档，互不污染）。
// 每次 attempt 独立 launch：任何一次失败/浏览器崩溃不污染下一次，
// attempt 的 finally 关闭本次自己的 ctx 与 browser，绝不复用已关闭对象。
async function main() {
  const pw = loadPW();
  let lastErr = null;
  for (let a = 0; a < 2; a++) {
    STEP = "launch";
    let browser = null;
    let ctx = null;
    let page = null;
    try {
      browser = await pw.chromium.launch({
        executablePath: findChrome(),
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      });
      ctx = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
      });
      page = await ctx.newPage();
      page.setDefaultTimeout(20000);
      STEP = "createSave";
      const saveId = await createSave(page, `${NAME}-${a}`).then(() =>
        page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
      );
      assert(saveId > 0, "save_id missing in localStorage");
      await body(page, saveId);
      console.log(`[ASSERT] combat-actions-ui OK (attempt ${a + 1})`);
      await ctx.close().catch(() => {});
      ctx = null;
      await browser.close().catch(() => {});
      browser = null;
      process.exit(0);
    } catch (e) {
      lastErr = e;
      try {
        fs.mkdirSync("/root/logs", { recursive: true });
        if (page) {
          await page.screenshot({
            path: `/root/logs/e2e-combat-actions-ui-${Date.now()}.png`,
            fullPage: true,
          });
        }
      } catch {}
      const url = await (async () => {
        try {
          return page ? page.url() : "(no page)";
        } catch {
          return "(url unavailable)";
        }
      })();
      const stackTop = ((e && e.stack) || "").split("\n").find(Boolean) || "";
      console.log(
        `[ASSERT] combat-actions-ui attempt ${a + 1} failed: step=${STEP} url=${url} ` +
          `err=${e && e.message} | ${stackTop}${a === 0 ? " — retrying once" : ""}`
      );
    } finally {
      if (ctx) await ctx.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
  }
  console.error(`[ASSERT] combat-actions-ui FAIL: ${lastErr && lastErr.message}`);
  process.exit(1);
}

main();
