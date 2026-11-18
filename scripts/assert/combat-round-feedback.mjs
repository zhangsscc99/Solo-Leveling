#!/usr/bin/env node
// F218 战斗回合可视播报 + 390 交战面板不压正文：
//
//   真实玩家走查（390px）：第 1 回合点「攻击」后我方 HP 97→94、回合数 +1，
//   敌方仍 42/42，日志没有一个字说明这刀落空还是被闪避——结算文本写在
//   日志里，但移动端被 sticky 的「交战」浮层盖住，玩家只能得出「攻击键
//   坏了」的结论。
//
//   a) 每回合结算播报：交战面板新增 .combat-report 一行——服务端
//      combatTurn 按本回合真实事件拼出 {turn,kind,line}（命中/未命中/
//      暴击 + 伤害 + 敌方 HP 变化），随交战态 last_json 持久化、
//      combatView 下发 save.combat.last，前端原样渲染。断言：交战中
//      每点一次「攻击」，战斗区（section.combat 内）都出现含
//      「伤害/闪避/未命中」之一的结算行，且 data-turn = 被结算回合号。
//   b) 确定性落空：/action 接受可选 body.seed——原样追加进回合种子
//      （combat:{save}:{seq}:{turn}:{seed}，线上请求不带则与旧口径逐字
//      一致）。断言离线复演同一 resolveTurn 搜出必然落空的 seed，发包后
//      save.combat.last.kind ∈ {miss,dodge}、文案含「未命中/闪避」，
//      刷新页面后播报仍在（持久化证明）。
//   c) 390×844：交战面板从 .stage-col 内 sticky 改为 .stage 纵向 flex 的
//      独立槽位——断言 rect(section.combat) 与 rect(.stage-col) 不相交。
//   d) 1440×900：面板正常渲染、同样不相交（桌面无回归）。
//   e) 顶栏 HP/MP 跳字：.status .gauge-delta 绝对定位浮字（不占行高、
//      不拦点击），按回合离线复演出的 hp 差值精确比对「-N」字样，并在
//      1.4s 后断言无残留。
//
//   旧码红证：无 .combat-report（(a) waitForSelector 超时 FAIL）、无
//   last_json/seed 通道（(b) last 恒 null FAIL）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，E2E_BASE_URL 默认
//   http://127.0.0.1:3020/game，可用环境变量覆盖。verify.sh 会清掉
//   E2E_BASE_URL 只留 SL_VERIFY_API_BASE（→API_BASE）——页面基址先从
//   API_BASE 剥掉 /api 尾段推出，保证 API 与浏览器打同一实例。
const API0 = (process.env.API_BASE || "").replace(/\/+$/, "");
const BASE = (
  process.env.E2E_BASE_URL ||
  (API0.endsWith("/api") ? API0.slice(0, -"/api".length) : "") ||
  "http://127.0.0.1:3020/game"
).replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = API0 || `${BASE}/api`;

import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { assert, makeSave, post, fetchSaveView } = await import("./_http.mjs");
const { run } = await import("../e2e/lib.mjs");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const combatEngine = require(path.join(ROOT, "server", "engine", "combat.js"));
const statsEngine = require(path.join(ROOT, "server", "engine", "stats.js"));

const SAVE_KEY = "solo_leveling_save_id";
const REPORT_RE = /伤害|闪避|未命中/;
const ATTACK_BTN = 'footer.actions button:has-text("攻击"):not(.combat-entry):not(:has-text("叫阵"))';

// ── 离线复演：与 combatTurn 注入引擎的实体逐项同口径 ─────────────
// stats 折算 = sanitizeStats(save.stats) + 装备加成（攻/1.6→力量、防/0.8→
// 体力），敌人实体 = 交战行 enemy_json 原物（视图字段 hp/max_hp 还原为
// hp/maxHp，stats 随 combatView 下发）。resolveTurn 纯函数同 seed 同结果。
function playerEntity(save, equipment) {
  const stats = statsEngine.sanitizeStats({ stats: save.stats });
  stats.strength += ((equipment && equipment.atk) || 0) / 1.6;
  stats.vitality += ((equipment && equipment.def) || 0) / 0.8;
  return {
    name: save.player_name,
    level: save.level,
    rank: save.rank,
    hp: save.hp,
    maxHp: save.max_hp,
    mp: save.mp,
    maxMp: save.max_mp,
    stats,
  };
}

function enemyEntity(c) {
  const e = c.enemy;
  return {
    id: e.id,
    name: e.name,
    rank: e.rank,
    level: e.level,
    hp: e.hp,
    maxHp: e.max_hp,
    atk: e.atk,
    def: e.def,
    boss: e.boss,
    stats: e.stats,
    seq: c.seq,
  };
}

// seedSuffix 为 null 时与服务端缺省口径逐字一致（无追加段）。
function replayTurn(save, equipment, seedSuffix) {
  const c = save.combat;
  const seed = `combat:${save.id}:${c.seq}:${c.turn}` + (seedSuffix ? `:${seedSuffix}` : "");
  return combatEngine.resolveTurn(
    { turn: c.turn, player: playerEntity(save, equipment), enemy: enemyEntity(c) },
    "attack",
    seed,
    { item: null, skill: null }
  );
}

// strike 事件 side 归属：玩家命中/暴击 side=player，玩家落空 side=enemy；
// 敌方结算恰相反。与 combatTurn 里 last 行的拼装同一判定。
function playerStrike(events) {
  return events.find(
    (ev) =>
      (ev.side === "player" && (ev.type === "hit" || ev.type === "crit")) ||
      (ev.side === "enemy" && (ev.type === "miss" || ev.type === "dodge"))
  );
}

function rectsIntersect(a, b) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

async function assertNoOverlap(page, tag) {
  const cr = await page.locator("section.combat").boundingBox();
  const sr = await page.locator(".stage-col").boundingBox();
  assert(cr && sr, `${tag}: section.combat/.stage-col missing`);
  assert(
    !rectsIntersect(cr, sr),
    `${tag}: 交战面板与 .stage-col 矩形相交 ` +
      `panel=${JSON.stringify(cr)} col=${JSON.stringify(sr)}`
  );
  console.log(
    `    ${tag}: 面板(y=${Math.round(cr.y)}+${Math.round(cr.height)}) 与正文列矩形不相交`
  );
}

async function openSaveInPage(page, saveId) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([k, v]) => localStorage.setItem(k, String(v)), [SAVE_KEY, saveId]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
}

// DOM 驱动进战：脱战时五键折叠成 disabled 矮入口（.combat-entry），开战
// 只能走自由输入「攻击」——每次未接敌都把 encounter_clock +1，
// PITY_LIMIT=4 保底——至多 8 次必开战（与 peacefulCombatIntent 同径）。
async function ensureCombat(page, saveId, max = 10) {
  const input = page.locator(".input-row input");
  const send = page.locator(".input-send");
  for (let i = 0; i < max; i++) {
    const { save: s } = await fetchSaveView(saveId);
    if (s.combat) return s;
    await input.fill("攻击");
    await send.click();
    await page.waitForTimeout(500);
  }
  const { save: s } = await fetchSaveView(saveId);
  assert(s.combat, `ensureCombat: ${max} 次「攻击」未开战（pity 应已命中）`);
  return s;
}

// ── (a)~(e) 主流程（390×844 进场，1440 复验）────────────────────
run(
  "combat-round-feedback",
  async ({ page }) => {
    const saveId = await makeSave("f218-round-feedback");
    console.log(`[setup] save_id=${saveId}`);
    await openSaveInPage(page, saveId);
    await ensureCombat(page, saveId);
    await page.waitForSelector("section.combat");
    const engaged = await fetchSaveView(saveId);
    console.log(`    (a) 已交战：${engaged.save.combat.enemy.name}（第 ${engaged.save.combat.turn} 回合起）`);

    // ── (c) 390：面板矩形与 .stage-col 不相交 ──────────────────
    await assertNoOverlap(page, "(c) 390×844");

    // ── (b) 确定性落空：第 1 个结算回合用注入 seed 造必然未命中 ──
    // 离线复演同口径搜 seed——save 视图快照在发包前不变，复演即实况。
    let missSeed = null;
    {
      const view = await fetchSaveView(saveId);
      for (let i = 0; i < 400 && !missSeed; i++) {
        const sfx = `f218-m${i}`;
        const pred = replayTurn(view.save, view.equipment, sfx);
        const you = playerStrike(pred.events);
        if (you && (you.type === "miss" || you.type === "dodge") && pred.state.player.hp > 0) {
          missSeed = sfx;
        }
      }
    }
    assert(missSeed, "(b) 400 个注入种子内没找到必然落空的回合——复演口径异常");
    const seeded = await post("/action", { save_id: saveId, input: "攻击", seed: missSeed });
    assert(seeded.status === 200, `(b) seeded /action HTTP ${seeded.status}`);
    const last = seeded.body.save && seeded.body.save.combat && seeded.body.save.combat.last;
    assert(last, `(b) 注入回合 save.combat.last 缺失：${JSON.stringify(seeded.body.save.combat)}`);
    assert(
      last.kind === "miss" || last.kind === "dodge",
      `(b) 注入回合 last.kind=${last.kind}，期望落空（line="${last.line}"）`
    );
    assert(/未命中|闪避/.test(last.line), `(b) 落空播报不含「未命中/闪避」："${last.line}"`);
    // 持久化证明：回灌 save.combat.last 仍在；刷新页面后战斗区照播。
    const persisted = (await fetchSaveView(saveId)).save.combat.last;
    assert(
      persisted && persisted.line === last.line,
      `(b) last_json 未持久化：${JSON.stringify(persisted)}`
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("section.combat .combat-report", { timeout: 8000 });
    const domLine = (
      await page.locator("section.combat .combat-report .combat-report-line").innerText()
    ).trim();
    assert(/未命中|闪避/.test(domLine), `(b) 刷新后战斗区播报未现「未命中/闪避」："${domLine}"`);
    await assertNoOverlap(page, "(c) 390×844 落空回合");
    console.log(`    (b) seed=${missSeed} → "${domLine}"（kind=${last.kind}，刷新后仍在）`);

    // ── (d) 1440×900：交战仍在继续，桌面视口复验 ──────────────
    const ctx2 = await page
      .context()
      .browser()
      .newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
    try {
      const p2 = await ctx2.newPage();
      p2.setDefaultTimeout(20000);
      await openSaveInPage(p2, saveId);
      await p2.waitForSelector("section.combat");
      await p2.waitForSelector("section.combat .combat-report");
      const line2 = (
        await p2.locator("section.combat .combat-report .combat-report-line").innerText()
      ).trim();
      assert(REPORT_RE.test(line2), `(d) 1440 结算行异常："${line2}"`);
      const cr = await p2.locator("section.combat").boundingBox();
      const sr = await p2.locator(".stage-col").boundingBox();
      assert(cr && sr, "(d) 1440 section.combat/.stage-col missing");
      assert(
        !rectsIntersect(cr, sr),
        `(d) 1440 交战面板与 .stage-col 矩形相交 panel=${JSON.stringify(cr)} col=${JSON.stringify(sr)}`
      );
      console.log(`    (d) 1440×900：面板与结算行正常渲染、矩形不相交`);
    } finally {
      await ctx2.close().catch(() => {});
    }

    // ── (a)(e) 继续 DOM 点到胜利：每回合结算行 + 顶栏跳字 ──────
    const attackBtn = page.locator(ATTACK_BTN).first();
    let tickChecked = false;
    let victory = false;
    let rounds = 0;
    let fights = 0;
    for (let guard = 0; guard < 60 && !(victory && tickChecked); guard++) {
      const view = await fetchSaveView(saveId);
      const s = view.save;
      if (!s.combat) {
        if ((await page.locator("section.combat").count()) > 0) continue; // 面板收束中
        if (!victory || !tickChecked) {
          // 未胜（阵亡回溯）或还没验到跳字——再进一场续打。
          await ensureCombat(page, saveId);
          await page.waitForSelector("section.combat");
          fights++;
        }
        continue;
      }
      const pred = replayTurn(s, view.equipment, null);
      const turn = s.combat.turn;
      const pDelta = pred.state.player.hp - s.hp;
      const eAfter = Math.max(0, pred.state.enemy.hp);
      const enemyDead = eAfter <= 0;
      const playerDead = pred.state.player.hp <= 0 && !enemyDead;

      // 跳字只在干净槽位判：先把上回合浮字放完，再点。
      if (!tickChecked && pDelta !== 0) {
        await page
          .waitForSelector(".status .gauge-delta", { state: "detached", timeout: 3000 })
          .catch(() => {});
      }
      await attackBtn.click();

      // ── (e) 顶栏跳字：预测的 hp 差值必须出现为浮字文本 ──────
      if (!tickChecked && pDelta !== 0) {
        const want = pDelta > 0 ? `+${pDelta}` : `${pDelta}`;
        await page.waitForFunction(
          (w) =>
            [...document.querySelectorAll(".status .gauge-delta")].some(
              (el) => el.textContent.trim() === w
            ),
          want,
          { timeout: 1600 }
        );
        console.log(`    (e) 顶栏跳字捕获 "${want}"`);
        tickChecked = true;
        // ≤1.2s 后无残留（浮字不占行高，由 App 计时卸载）。
        await page.waitForTimeout(1400);
        assert(
          (await page.locator(".status .gauge-delta").count()) === 0,
          "(e) 跳字超期残留（>1.4s 仍在 DOM）"
        );
      }

      if (enemyDead || playerDead) {
        await page.waitForSelector("section.combat", { state: "detached", timeout: 8000 });
        const after = (await fetchSaveView(saveId)).save;
        assert(!after.combat, `(a) 击杀/阵亡回合 combat 未清：${JSON.stringify(after.combat)}`);
        if (enemyDead) {
          victory = true;
          console.log(`    (a) 第 ${turn} 回合击杀——胜利收尾（面板收束）`);
        } else {
          console.log(`    (a) 第 ${turn} 回合阵亡回溯——重新进战续打`);
        }
        continue;
      }

      await page.waitForSelector(`.combat-report[data-turn="${turn}"]`, { timeout: 8000 });
      const rep = page.locator(`.combat-report[data-turn="${turn}"]`).first();
      const line = (await rep.locator(".combat-report-line").innerText()).trim();
      // 结算行必须在战斗区内（section.combat 子孙），不是 .stage-col 日志。
      const inCombatArea = await rep.evaluate((el) => Boolean(el.closest("section.combat")));
      assert(inCombatArea, `(a) 第 ${turn} 回合结算行不在战斗区内`);
      assert(
        REPORT_RE.test(line),
        `(a) 第 ${turn} 回合结算行不含「伤害/闪避/未命中」："${line}"`
      );
      // 数值口径取自真实结算：离线复演的伤害数与敌 HP 箭头逐字比对。
      const eBefore = s.combat.enemy.hp;
      const you = playerStrike(pred.events);
      if (you && (you.type === "hit" || you.type === "crit")) {
        assert(
          line.includes(`造成 ${Math.max(0, Math.trunc(you.value))} 伤害`),
          `(a) 第 ${turn} 回合伤害数值与真实结算不符："${line}"（期望 造成 ${you.value} 伤害）`
        );
        assert(
          line.includes(`${eBefore}→${eAfter}`),
          `(a) 第 ${turn} 回合敌 HP 变化缺失："${line}"（期望 ${eBefore}→${eAfter}）`
        );
      }
      rounds++;
      console.log(`    (a) 第 ${turn} 回合结算行：${line.slice(0, 80)}`);
    }
    assert(victory, "(a) 60 个动作内没打到一场胜利");
    assert(rounds >= 1, "(a) 一场战斗里一个结算回合都没断言到");
    assert(tickChecked, "(e) 多场战斗 hp/mp 零变化——跳字一次都没验证到");

    console.log(`    共验证 ${rounds} 个结算回合、${fights + 1} 场交战`);
  },
  { viewport: { width: 390, height: 844 } }
);
