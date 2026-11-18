#!/usr/bin/env node
// F191 战斗面板「每回合预估」口径修正断言：
//   a) 390×844 新档（点「觉醒」）→ 自由输入发「前进」直到行动栏出现
//      战斗键（footer.actions button:has-text("攻击")，最多 8 次）；
//   b) .combat-est 存在、文案含「承伤」，解析出 攻击/承伤 的 lo/hi
//      （兼容单值「攻击 12」与区间「攻击 12–20」），且 hi >= lo；
//   c) 连点「攻击」≥4 个实测回合：每回合从回包/日志里抓双方实际掉血
//      （「【战斗】<敌名> HP A→B」「【战斗】你 HP A→B」，未命中/闪避即
//      无掉血行记 0）；我方承伤 ∈ [0, take_hi] 且非零回合 ∈ [take_lo,
//      take_hi]，敌方承伤同口径 ∈ deal 区间；击杀导致换敌时重读区间；
//   d) 全程 console error / pageerror 为 0。失败打印逐回合实测与区间。
// 变异敏感性：旧码 est 是裸算 ~N（无 rank 压制/暴击上限/体力减伤），
// 石像守卫实测 −10/回合对 ~7 必出 [lo,hi] 违例 → b) 或 c) 必红。
const BASE = (process.env.E2E_BASE_URL || "https://openfolio.uk/game").replace(/\/+$/, "");
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = process.env.API_BASE || `${BASE}/api`;

const { run, assert } = await import("../e2e/lib.mjs");

const NAME = `R32f191-${Date.now().toString(36)}`.slice(0, 20);
const settle = (page, ms = 450) => page.waitForTimeout(ms);

// 交战五键里的「攻击」：排除非交战矮入口（.combat-entry 文案
// 「当前没有可攻击的目标」含「攻击」子串）与守关房「叫阵 · 攻击」
// （点击是开战不是回合结算）。
const atkBtn = (page) =>
  page
    .locator('footer.actions button:has-text("攻击"):not(.combat-entry):not(:has-text("叫阵"))')
    .first();

async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 解析 .combat-est 文本 → { deal: {lo,hi}, take: {lo,hi} }；单值记 lo=hi。
function parseEst(text) {
  const pick = (label) => {
    const m = text.match(new RegExp(`${label}\\s*~?\\s*(\\d+)(?:\\s*[–—-]\\s*(\\d+))?`));
    if (!m) return null;
    const lo = Number(m[1]);
    const hi = m[2] !== undefined ? Number(m[2]) : lo;
    return { lo, hi };
  };
  return { deal: pick("攻击"), take: pick("承伤") };
}

async function readEst(page) {
  const el = page.locator(".combat-est").first();
  if ((await el.count()) === 0) return null;
  const text = (await el.innerText()).replace(/\s+/g, " ").trim();
  return { text, ranges: parseEst(text) };
}

// ── 确定性回合解析 ──
// 只认权威增量行「【战斗】<名> HP A→B · 你 HP C→D」：先把回包正文按
// 「【战斗】第 N 回合」切段，段内逐行找 HP 增量；散文只用来判 miss。
const MISS_RE =
  /未命中|没有命中|没能命中|落空|扑空|闪开|避开|偏离|掠过|擦着|滑开|凿了个空|落了空/;
const KILL_RE = /倒下了|战斗结束|击败 /;
const HP_RE = /([^\s【】·，,。：:]+?) HP (\d+)→(\d+)/g;

// 回包正文 → 回合段数组（每段以「【战斗】第N回合」开头）。
function splitSegments(content) {
  return String(content || "")
    .split(/(?=【战斗】第\s*\d+\s*回合)/)
    .filter((p) => /^【战斗】第\s*\d+\s*回合/.test(p));
}

// 段内解析：taken=「你 HP A−B」，dealt=敌方 HP A−B；缺该侧增量行记 0。
// vitalLines=增量行数；kill=敌方归零或段内出现倒下/战斗结束/击败。
function parseSegment(seg) {
  const lines = seg
    .split("\n")
    .filter((l) => l.startsWith("【战斗】") && !/第\s*\d+\s*回合/.test(l) && / HP \d+→\d+/.test(l));
  let taken = 0;
  let dealt = 0;
  let kill = KILL_RE.test(seg);
  for (const line of lines) {
    let m;
    HP_RE.lastIndex = 0;
    while ((m = HP_RE.exec(line))) {
      const diff = Number(m[2]) - Number(m[3]);
      if (m[1] === "你") taken += diff;
      else if (m[1] !== "MP") {
        dealt += diff;
        if (Number(m[3]) === 0) kill = true;
      }
    }
  }
  return { taken, dealt, sawVitals: lines.length > 0, miss: MISS_RE.test(seg), kill };
}

run(
  "combat-estimate-caliber",
  async ({ page }) => {
    const consoleErrors = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrors.push(String(e)));

    // ── a) 390×844 新档：觉醒页登记 → 发「前进」进交战（≤8 次）──
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".gate-form input");
    await page.fill(".gate-form input", NAME);
    await page.click('button:has-text("觉醒")');
    await page.waitForSelector(".status");
    await settle(page, 700);

    let engaged = (await atkBtn(page).count()) > 0;
    for (let i = 0; i < 8 && !engaged; i++) {
      const r0 = await send(page, "前进");
      // P204：must_choose 场景裸「前进」被拒——补发首个主线选项续推。
      if (r0 && r0.refused === true && /必须做出选择/.test((r0.reply && r0.reply.content) || "")) {
        await send(page, "选择 1");
      }
      await settle(page, 700);
      engaged = (await atkBtn(page).count()) > 0;
    }
    // 走到守关房门口：点「叫阵 · 攻击」就地开战兜底。
    if (!engaged) {
      const callout = page.locator('footer.actions button:has-text("叫阵")').first();
      if (await callout.isEnabled().catch(() => false)) {
        await callout.click();
        await settle(page, 800);
        engaged = (await atkBtn(page).count()) > 0;
      }
    }
    assert(engaged, "8 次「前进」仍未交战（攻击键未出现）");

    // ── b) .combat-est 存在、含「承伤」、区间解析成功且 hi>=lo ──
    await settle(page, 500);
    let est = await readEst(page);
    assert(est && est.text.includes("承伤"), `.combat-est 缺失或文案无「承伤」：${est && est.text}`);
    assert(
      est.ranges.deal && est.ranges.take,
      `.combat-est 区间解析失败："${est.text}"`
    );
    assert(
      est.ranges.deal.hi >= est.ranges.deal.lo && est.ranges.take.hi >= est.ranges.take.lo,
      `区间倒挂：${est.text}`
    );
    // 区间必须真的是区间（不暴击下限 < 暴击上限）：旧口径只下发裸算
    // 单值「~N」，lo==hi 在这里必然红——暴击倍率 ≥1.5 时 hi 必大于 lo。
    assert(
      est.ranges.deal.hi > est.ranges.deal.lo && est.ranges.take.hi > est.ranges.take.lo,
      `区间未展开（应为 下限–上限）：${est.text}`
    );
    console.log(`    (b) est="${est.text}" → deal ${est.ranges.deal.lo}–${est.ranges.deal.hi}, take ${est.ranges.take.lo}–${est.ranges.take.hi}`);

    // ── c) 连点「攻击」≥4 实测回合，逐回合对区间 ──
    const rounds = [];
    const violations = [];
    const segFailures = [];
    let skipped = 0;
    let enemyName = null;
    for (let i = 0; i < 30 && rounds.length < 4; i++) {
      if (!(await atkBtn(page).isEnabled().catch(() => false))) {
        // 守关房叫阵态：点「叫阵 · 攻击」就地开战（与「攻击」同结算路径）。
        const callout = page.locator('footer.actions button:has-text("叫阵")').first();
        if (await callout.isEnabled().catch(() => false)) {
          const [resp] = await Promise.all([
            page.waitForResponse(
              (r) => r.url().includes("/api/action") && r.request().method() === "POST"
            ),
            callout.click(),
          ]);
          await resp.finished().catch(() => {});
          const json = await resp.json().catch(() => null);
          await settle(page, 600);
          if (json && json.save && json.save.combat && json.save.combat.enemy) {
            enemyName = json.save.combat.enemy.name;
            est = await readEst(page);
          }
          continue;
        }
        // 脱战（击杀/被拦空窗）：补「前进」再逼下一场。
        const r = await send(page, "前进");
        // P204：must_choose 场景裸「前进」被拒——补发首个主线选项续推。
        if (r && r.refused === true && /必须做出选择/.test((r.reply && r.reply.content) || "")) {
          await send(page, "选择 1");
        }
        await settle(page, 700);
        if (r && r.save && r.save.combat && r.save.combat.enemy) {
          enemyName = r.save.combat.enemy.name;
          est = await readEst(page);
        }
        continue;
      }
      // 打当前敌人前冻结当场所用区间与敌名。
      const cur = await readEst(page);
      if (cur && cur.ranges.deal && cur.ranges.take) est = cur;
      const nameEl = page.locator(".combatant-enemy .combatant-name").first();
      if ((await nameEl.count()) > 0) enemyName = (await nameEl.innerText()).trim();
      const [resp] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
        atkBtn(page).click(),
      ]);
      await resp.finished().catch(() => {});
      const json = await resp.json().catch(() => null);
      await settle(page, 500);
      const content = (json && json.reply && json.reply.content) || "";
      const segs = splitSegments(content);
      if (!segs.length) continue; // 拒绝/空挥不算回合
      if (json && json.save && json.save.combat && json.save.combat.enemy) {
        enemyName = json.save.combat.enemy.name;
      }
      for (const seg of segs) {
        if (rounds.length >= 4) break;
        const rd = parseSegment(seg);
        // 击杀段：敌方 HP→0 的补刀只按残余血量入账（必小于 deal_lo），
        // 且可能与奖励/下场结算混排——整段排除，不计入有效回合。
        if (rd.kill) {
          skipped++;
          console.log(`    (c) skipped killing round (${enemyName})：${seg.split("\n")[0]}`);
          continue;
        }
        if (!rd.sawVitals && !rd.miss) {
          segFailures.push(`回合段无增量行且非 miss：\n${seg}`);
          continue;
        }
        const rec = { n: rounds.length + 1, enemy: enemyName, ...rd, est: est && est.ranges };
        rounds.push(rec);
        const { deal, take } = est.ranges;
        if (rd.taken > take.hi || (rd.taken > 0 && rd.taken < take.lo)) {
          violations.push(
            `回合${rec.n}(${enemyName}) 承伤=${rd.taken} ∉ [${take.lo},${take.hi}]`
          );
        }
        if (rd.dealt > deal.hi || (rd.dealt > 0 && rd.dealt < deal.lo)) {
          violations.push(
            `回合${rec.n}(${enemyName}) 攻击=${rd.dealt} ∉ [${deal.lo},${deal.hi}]`
          );
        }
      }
    }
    console.log(
      `    (c) rounds: ${rounds
        .map((r) => `#${r.n} ${r.enemy} 承伤${r.taken}/攻击${r.dealt} [take ${r.est.take.lo}-${r.est.take.hi} deal ${r.est.deal.lo}-${r.est.deal.hi}]`)
        .join(" ; ")}${skipped ? ` ; skipped ${skipped} killing round(s)` : ""}`
    );
    assert(
      segFailures.length === 0,
      `回合段解析失败（fail-closed）：${segFailures.join("\n---\n")}`
    );
    assert(rounds.length >= 3, `有效实测回合不足 3：只有 ${rounds.length} 回合`);
    assert(
      violations.length === 0,
      `实测落点越出预估区间：${violations.join(" ; ")}`
    );

    // ── d) 无 console error ──
    assert(
      consoleErrors.length === 0,
      `console error ${consoleErrors.length} 条：${consoleErrors.join(" ; ").slice(0, 400)}`
    );
  },
  { viewport: { width: 390, height: 844 }, context: { hasTouch: true, isMobile: true } }
);
