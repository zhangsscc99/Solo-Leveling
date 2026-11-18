#!/usr/bin/env node
// F164 未分配属性点主界面徽标断言：
//   a) 新档（free_points=0）进主界面：.status 不含「属性点」徽标；
//   b) 白名单指令推进到第 1 章守关者并击杀（boss 战 ≤20 回合，HP < 50%
//      先「喝低级治疗药水」再打），击杀后应升级 → free_points > 0；
//      随后 UI 发一条真实「观察」回灌存档（不刷新页面）→ .status
//      可见文本匹配 /属性点\s*\+?[1-9]/；
//   c) 点击该徽标 → 档案抽屉展开 .stat-panel 且文本含「剩余属性点」；
//   d) 390×844 与 1440×900 均无横向溢出
//      （document.documentElement.scrollWidth === clientWidth）；
//   e) 全程无 pageerror / console error（资源加载失败除外）。
// 稳定性：整套断言失败重试一次（F087 口径），每次新档互不污染。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = `${BASE}/api`;

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { loadPW, findChrome, createSave, assert } = await import("../e2e/lib.mjs");
const { act, fetchSaveView, post, advanceStep } = await import("./_http.mjs");

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

const ch1 = CHAPTERS.chapters.find((c) => c.index === 1);
const bossScene = ch1 && ch1.scenes.find((s) => s.kind === "boss");
assert(bossScene, "oracle: ch1 missing boss scene");
const BOSS_SCENE = bossScene.id;

const BADGE_RE = /属性点\s*\+?[1-9]/;
const HEAL_IDS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);
const hasHealer = (inv) => (inv || []).some((r) => r.qty > 0 && HEAL_IDS.has(r.item_id));
const hasLow = (inv) => (inv || []).some((r) => r.item_id === "low_heal_potion" && r.qty > 0);
const settle = (page, ms = 400) => page.waitForTimeout(ms);

// 自由行动输入框发指令，等 /action 回包完整落地并返回响应 JSON。
async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 推进并击杀 ch1 守关者：小怪照打攒 XP，残血先补给，守关者必打。
// boss 战每场 ≤20 个动作；全程真实 /action 与 /item 接口，不直接改库。
async function killCh1Boss(id) {
  let equipped = false;
  let bossActs = 0;
  let prev = null;
  let stale = 0;
  for (let i = 0; i < 400; i++) {
    const { save: s, inventory, equipment } = await fetchSaveView(id);
    if ((s.boss_cleared || []).includes("ch1")) return s;
    // 存档指纹：连续不变 = 驱动在空转，直接暴露死路。
    const sig = [
      s.scene, s.chapter, s.hp, s.mp, s.level, s.kills, s.free_points,
      s.encounter_cd, s.rest_used,
      (s.combat && s.combat.seq) || "", (s.combat && s.combat.turn) || "",
      (s.combat && s.combat.enemy && s.combat.enemy.hp) || "",
    ].join("|");
    stale = sig === prev ? stale + 1 : 0;
    prev = sig;
    assert(
      stale < 8,
      `driver stalled — state unchanged across ${stale + 1} actions ` +
        `(scene=${s.scene} hp=${s.hp}/${s.max_hp} mode=${s.advance_mode})`
    );
    if (!equipped) {
      equipped = true;
      const worn = [equipment && equipment.weapon && equipment.weapon.id, equipment && equipment.armor && equipment.armor.id];
      for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
        if ((inventory || []).some((r) => r.item_id === itemId && r.qty > 0) && !worn.includes(itemId)) {
          await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
        }
      }
      continue;
    }
    if (s.combat) {
      const isBoss = Boolean(s.combat.enemy && s.combat.enemy.boss);
      if (isBoss) {
        bossActs++;
        assert(bossActs <= 20, `boss fight exceeded 20 actions (enemy hp=${s.combat.enemy.hp})`);
      }
      const low = s.hp > 0 && s.hp < s.max_hp * 0.5;
      if (low && hasLow(inventory)) {
        await act(id, "喝低级治疗药水");
        continue;
      }
      if (low && hasHealer(inventory)) {
        await act(id, "使用道具");
        continue;
      }
      const castable = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
      await act(id, castable ? `释放技能 ${castable.name}` : "攻击");
      continue;
    }
    // 脱战（含阵亡回溯/逃跑落地）：boss 回合计数重置，下一场重新计。
    bossActs = 0;
    if (s.hp > 0 && s.hp < s.max_hp * 0.5) {
      if (s.rest && s.rest.available === true) {
        await act(id, "休息");
        continue;
      }
      if (hasLow(inventory)) {
        await post(`/saves/${id}/item`, { item_id: "low_heal_potion", op: "use" });
        continue;
      }
    }
    if (s.advance_mode === "challenge_boss" || s.scene === BOSS_SCENE) {
      // 守关房内原地「攻击」= 叫阵，必中守关者。
      await act(id, "攻击");
      continue;
    }
    // retreat_to_boss 时「前进」折返回守关房；其余正常推进。
    // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
    await advanceStep(id);
  }
  throw new Error("400 actions without killing ch1 boss");
}

async function assertNoOverflow(page, tag) {
  const m = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  console.log(`    (${tag}) scrollWidth=${m.sw} clientWidth=${m.cw}`);
  assert(m.sw === m.cw, `horizontal overflow @${tag}: scrollWidth ${m.sw} !== clientWidth ${m.cw}`);
}

async function body(page, saveId, consoleErrs) {
  // ── a) 新档 free_points=0：.status 不得出现「属性点」徽标 ─────────
  const status0 = await page.locator(".status").innerText();
  assert(!/属性点/.test(status0), `fresh save .status must not mention 属性点: "${status0.slice(0, 120)}"`);
  assert(
    (await page.locator(".status .stat-points-badge").count()) === 0,
    "fresh save renders the badge element"
  );

  // ── b) 推进到守关者并击杀 → 升级，free_points > 0 ────────────────
  const final = await killCh1Boss(saveId);
  assert(final.level >= 2, `ch1 boss killed but level=${final.level} — expected level-up`);
  assert(
    final.free_points > 0,
    `ch1 boss killed but free_points=${final.free_points} — expected unspent points`
  );
  console.log(`    boss killed: Lv.${final.level} free_points=${final.free_points}`);

  // UI 不刷新就地回灌：一条真实 UI 指令的回包把新 save 顶进顶栏。
  await send(page, "观察");
  await page.waitForFunction(
    () => /属性点\s*\+?[1-9]/.test((document.querySelector(".status") || {}).innerText || ""),
    null,
    { timeout: 8000 }
  );
  const badge = page.locator(".status .stat-points-badge");
  assert((await badge.count()) === 1, `.status badge element missing (count=${await badge.count()})`);
  const badgeText = (await badge.innerText()).trim();
  assert(BADGE_RE.test(badgeText), `badge text "${badgeText}" does not match /属性点\\s*\\+?[1-9]/`);
  console.log(`    badge visible: "${badgeText.replace(/\s+/g, " ")}"`);

  // ── c) 点击徽标 → 档案面板打开且含「剩余属性点」 ─────────────────
  await badge.click();
  await page.waitForSelector(".sidebar.open .stat-panel");
  const panelText = await page.locator(".stat-panel").innerText();
  assert(/剩余属性点/.test(panelText), `stats panel missing「剩余属性点」: "${panelText.slice(0, 120)}"`);
  await assertNoOverflow(page, "390+drawer");
  await page.keyboard.press("Escape");
  await page.waitForSelector(".sidebar.open", { state: "detached" }).catch(() => {});

  // ── d) 主视口 390 + 复测 1440：均无横向溢出 ────────────────────
  await assertNoOverflow(page, "390");
  await page.setViewportSize({ width: 1440, height: 900 });
  await settle(page, 500);
  await assertNoOverflow(page, "1440");

  // ── e) 无 pageerror / console error（资源加载失败豁免）───────────
  const realErrs = consoleErrs.filter((t) => !/Failed to load resource/i.test(t));
  assert(realErrs.length === 0, `console errors: ${realErrs.join(" | ").slice(0, 300)}`);
}

// F087 口径：整套断言失败重试一次（每次开新档，互不污染）。
async function main() {
  const pw = loadPW();
  const browser = await pw.chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  let lastErr = null;
  for (let a = 0; a < 2; a++) {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20000);
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrs.push(`pageerror: ${e.message}`));
    try {
      const name = `F164-${Date.now().toString(36)}-u${a}`;
      assert(name.length <= 20, `save name too long: ${name}`);
      const saveId = await createSave(page, name).then(() =>
        page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
      );
      assert(saveId > 0, "save_id missing in localStorage");
      await body(page, saveId, consoleErrs);
      await ctx.close();
      console.log(`[ASSERT] free-points-badge OK (attempt ${a + 1})`);
      await browser.close();
      process.exit(0);
    } catch (e) {
      lastErr = e;
      try {
        fs.mkdirSync("/root/logs", { recursive: true });
        await page.screenshot({
          path: `/root/logs/e2e-free-points-badge-${Date.now()}.png`,
          fullPage: true,
        });
      } catch {}
      console.log(
        `[ASSERT] free-points-badge attempt ${a + 1} failed: ${e.message}${a === 0 ? " — retrying once" : ""}`
      );
      await ctx.close().catch(() => {});
    }
  }
  await browser.close();
  console.error(`[ASSERT] free-points-badge FAIL: ${lastErr && lastErr.message}`);
  process.exit(1);
}

main();
