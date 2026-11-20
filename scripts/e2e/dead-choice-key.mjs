#!/usr/bin/env node
// dead-choice-key.mjs (F323): 抉择态「盯住巨像的眼睛」死键门禁——
//
//   背景（第114轮真实玩家走查，390×844 干净档）：ch1_worship 的
//   「抬起头，盯住巨像的眼睛（需先观察过石像）」requires flag
//   saw_statue_eyes。玩家已「环顾四周」3 次（探索 3/3）后该键仍是
//   disabled=false（读起来完全可点），连点 6 次 logCount 21→21、
//   HP/MP 不动、toasts:[]、正文零增长、无任何回执——Perceived 可点 /
//   Real 已失效，只认这颗最像主线键的玩家原地软锁且不知原因（P0）。
//
//   本脚本守护「锁定选项不得是死键」的契约，两条状态都要验：
//
//   未满足态（全程不走置旗支线）：
//     a) stare 键 aria-disabled==="true" 或 disabled===true；
//     b) 带可见条件徽章/理由文本（.choice-hint 或键面理由，含「观察」）；
//     c) 服务端 next_choices.stare 同源 locked:true、locked_reason 含
//        「观察」（排除置灰只是 busy 残影）；
//     d) 真实 pointer 点按一次 → 500ms 内出现含「先观察」语义的
//        .sys-toast 回执，且 .log-entry 数量零增长、save.scene 不位移；
//     e) 复现走查路径：本场景「环顾四周」×3（探索 3/3）后锁态依旧——
//        免费观察不写 requires.flag，锁不得被「看过了」错觉解开。
//   已满足态（先走置旗支线写 saw_statue_eyes）：
//     f) stare 键解锁（disabled===false 且 aria-disabled!=="true"）；
//     g) 点按必新增 ≥1 条 .log-entry 且 save.scene 落地 choice.next——
//        不允许留「已解锁但点了没反应」的第二态。
//   h) 390 下无横向溢出（scrollWidth <= clientWidth）。
//
//   落点可能掷出遭遇战（实测 石像残兵/石像守卫 拦路）——交战态不铺
//   选项键，见到「逃跑」键先撤离（失败会被拦下，循环再点），脱战后
//   选项组重新渲染再量。
//
//   旧码红证：旧构建该键 disabled=false、无 aria-disabled、无
//   .choice-hint，点击零 toast 零日志（F211 的 locked/locked_reason
//   与 F279 的 aria-disabled 键内拒绝均未落地）→ 断言 a) 首轮即 FAIL；
//   即便混过 a)，d) 的 500ms 回执窗也必 FAIL（实测 toasts:[]）。
//
//   自起隔离实例：空闲端口 + 临时 DB_PATH + AI key 置空；oracle 取自
//   chapters.json（置旗支线 / 落点 scene 均读数据，不硬编码）。
//   Playwright 390×844。
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

// ── Oracle：ch1_worship 的 flag 前置选项 + 置旗/非置旗支线 ──────────
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const WORSHIP = CH1.scenes.find((s) => s.id === "ch1_worship");
const GATED = WORSHIP.choices.find((c) => c.requires && c.requires.flag);
const FLAG = GATED.requires.flag; // saw_statue_eyes
const GATE_SCENE = CH1.scenes.find((s) => s.id === "ch1_double_gate");
const FLAG_CHOICE = GATE_SCENE.choices.find(
  (c) => c.effects && c.effects.flag === FLAG
);
const PLAIN_CHOICE = GATE_SCENE.choices.find(
  (c) => !(c.effects && c.effects.flag === FLAG)
);
const LAW = CH1.scenes.find((s) => s.id === "ch1_law");
const TO_WORSHIP = LAW.choices.find((c) => c.next === WORSHIP.id);

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
}

const port = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f323-"));
const env = {
  ...process.env,
  PORT: String(port),
  DB_PATH: path.join(tmpDir, "game.db"),
  OPENCODE_GO_API_KEY: "",
  OPENCODE_GO_BASE_URL: "",
  AI_ALIYUN_API_KEY: "",
  AI_ALIYUN_BASE_URL: "",
  AI_ALIYUN_MODEL: "",
};
delete env.NODE_CHANNEL_FD;
delete env.NODE_CHANNEL_SERIALIZATION_MODE;
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => (childLog += d));
child.stderr.on("data", (d) => (childLog += d));
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

const BASE = `http://127.0.0.1:${port}/game`;
const API = `${BASE}/api`;
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${API}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(
      `[E2E] dead-choice-key: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = BASE;
const { assert, run, createSave } = await import("./lib.mjs");

const apiGet = async (pathname, ms = 15000) => {
  const res = await fetch(`${API}${pathname}`, {
    signal: AbortSignal.timeout(ms),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, body: json };
};

let page;

const markerPresent = (text) =>
  page.evaluate(
    (t) =>
      [...document.querySelectorAll(".btn-group-choice .btn")].some((b) =>
        (b.textContent || "").includes(t)
      ),
    text
  );

// 等某条 marker label 出现在选项键里——场景落位 + 脱战的信号。落点可能
// 掷出遭遇战：交战态选项组整组不渲染，见到可用「逃跑」键就点（撤离失败
// 会被拦下，循环再点），直到 marker 铺出。
const ensureMarker = async (tag, text) => {
  for (let i = 0; i < 60; i++) {
    if (await markerPresent(text)) return;
    const fled = await page.evaluate(() => {
      const b = [...document.querySelectorAll(".actions .btn")].find(
        (x) => !x.disabled && (x.textContent || "").includes("逃跑")
      );
      if (b) {
        b.click();
        return true;
      }
      return false;
    });
    await page.waitForTimeout(fled ? 700 : 250);
  }
  assert(false, `${tag}: marker 「${text}」 never appeared（遭遇战未脱战或落点错误）`);
};

const clickChoice = async (part) => {
  const btn = page.locator(".btn-group-choice .btn", { hasText: part }).first();
  await btn.waitFor({ state: "visible" });
  await btn.click();
};

const saveId = () =>
  page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id") || 0));

// 「盯住巨像」键的现场快照：锁态语义（F279 后 = disabled 或
// aria-disabled）+ 可见理由文本（.choice-hint / title）一次取回。
const gatedState = () =>
  page.evaluate(() => {
    const b = [...document.querySelectorAll(".btn-group-choice .btn")].find(
      (x) => (x.textContent || "").includes("盯住巨像")
    );
    const hint = document.querySelector(".choice-hint");
    return {
      found: Boolean(b),
      disabled: b ? b.disabled : null,
      ariaDisabled: b ? b.getAttribute("aria-disabled") : null,
      cls: b ? b.className : "",
      title: b ? b.getAttribute("title") || "" : "",
      hint: hint ? hint.textContent.trim() : "",
      logCount: document.querySelectorAll(".stage-col.log .log-entry").length,
      toast: [...document.querySelectorAll(".sys-toast")]
        .map((t) => (t.textContent || "").trim())
        .join(" | "),
    };
  });

// 真实 pointer 点按——aria-disabled 键不吞点击（这是契约本身），点击
// 落在按钮中心；先等上一枚 toast 离场，新 toast 才是本次点击的证据。
const probeGated = async (tag) => {
  const loc = page.locator(".btn-group-choice .btn", { hasText: "盯住巨像" }).first();
  await loc.waitFor({ state: "attached", timeout: 8000 });
  await loc.waitFor({ state: "stable", timeout: 3000 }).catch(() => {});
  let box = null;
  for (let i = 0; i < 3 && !box; i++) {
    if (i > 0) await page.waitForTimeout(300);
    box = await loc.boundingBox();
  }
  assert(box, `${tag}: 「盯住巨像」boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page
    .waitForFunction(() => !document.querySelector(".sys-toast"), { timeout: 4000 })
    .catch(() => {});
  const before = await gatedState();
  const t0 = Date.now();
  await page.mouse.click(cx, cy);
  const deadline = Date.now() + 500; // 「立刻」反馈窗
  let last = before;
  while (Date.now() < deadline) {
    last = await gatedState();
    if (last.toast !== "") break;
    await page.waitForTimeout(40);
  }
  const ms = Date.now() - t0;
  return { before, last, ms };
};

run(
  "dead-choice-key",
  async ({ page: p }) => {
    page = p;
    const NAME_A = `f323-${Date.now().toString(36)}`;
    const NAME_B = `f323b-${Date.now().toString(36)}`;

    // ══ 存档 A：全程不走置旗支线 → ch1_worship，锁键契约 ══════════
    await createSave(page, NAME_A);

    // ch1_double_gate：非置旗支（不走 observe 支——它会写
    // saw_statue_eyes，本档必须保持条件未满足）。
    await ensureMarker("ch1_double_gate", PLAIN_CHOICE.label.slice(0, 6));
    await clickChoice(PLAIN_CHOICE.label.slice(0, 6));

    // ch1_law：「按石碑所写，低头敬拜」→ ch1_worship。
    await ensureMarker("ch1_law", TO_WORSHIP.label.slice(0, 6));
    await clickChoice(TO_WORSHIP.label.slice(0, 6));

    // ch1_worship：脱战后「盯住巨像」键铺出。
    await ensureMarker("ch1_worship", "盯住巨像");

    // (e) 复现走查现场：本场景「环顾四周」×3 到「探索 3/3」——免费
    // 观察不写 requires.flag，锁态必须依旧（「看过了」≠ 条件满足）。
    const obsBtn = page.locator('.actions-main button[data-act="观察"]').first();
    for (let i = 0; i < 3; i++) {
      if ((await obsBtn.count()) === 0) break;
      const dis = await obsBtn.evaluate((b) => b.disabled);
      if (dis) break;
      await obsBtn.click();
      await page.waitForTimeout(700);
    }

    // (a)+(b)：锁键 aria-disabled/disabled + 可见理由含「观察」——
    // busy 残影会让整组短时置灰，轮询到「键灰 + 理由在场」同时成立。
    let st = await gatedState();
    for (
      let i = 0;
      i < 25 &&
      st.found &&
      !(
        (st.disabled === true || st.ariaDisabled === "true") &&
        (st.hint.includes("观察") || st.title.includes("观察"))
      );
      i++
    ) {
      await page.waitForTimeout(200);
      st = await gatedState();
    }
    assert(st.found, `[A] 未找到「盯住巨像」选项键`);
    assert(
      st.disabled === true || st.ariaDisabled === "true",
      `[A] 未满足前置的「盯住巨像」键未置灰 — disabled=${st.disabled} aria-disabled=${st.ariaDisabled}（Perceived 可点 / Real 失效的旧死键形态）`
    );
    assert(
      st.hint.includes("观察") || st.title.includes("观察"),
      `[A] 锁键缺可见条件理由（含「观察」的可执行说明）— choice-hint=「${st.hint}」 title=「${st.title}」`
    );
    assert(
      /is-locked|rest-dim|choice-locked/.test(st.cls) || st.disabled === true,
      `[A] 锁键无可见置灰样式 — class=「${st.cls}」`
    );

    // (c) 服务端同源证据：next_choices.stare 必须 locked:true 且
    // locked_reason 含「观察」。
    const sidA = await saveId();
    assert(sidA > 0, `[A] localStorage 未取到存档 id（${sidA}）`);
    const { body: svA } = await apiGet(`/saves/${sidA}`);
    const chA =
      svA && svA.save && Array.isArray(svA.save.next_choices)
        ? svA.save.next_choices.find((c) => c && c.id === GATED.id)
        : null;
    assert(
      chA && chA.locked === true && String(chA.locked_reason || "").includes("观察"),
      `[A] next_choices.${GATED.id} 锁态字段异常 — ${JSON.stringify(chA)}`
    );
    console.log(
      `    [A] stare 锁态 aria-disabled=${st.ariaDisabled} hint=「${st.hint}」`
    );

    // (d) 真实点按：500ms 内必须见到含「先观察」语义的 .sys-toast，
    // 且 .log-entry 零增长——拒绝可以有回执，但不得静默。
    const probe = await probeGated("[A]");
    assert(
      probe.last.toast !== "",
      `[A] 点击锁键 ${probe.ms}ms 内零回执：log ${probe.before.logCount}->${probe.last.logCount}、toast 空——` +
        `第114轮实测死键形态（连点 6 次 log 21→21、toasts:[]）`
    );
    assert(
      /先观察|先「观察|观察/.test(probe.last.toast),
      `[A] 拒绝回执未含「先观察」语义 — toast=「${probe.last.toast.slice(0, 80)}」`
    );
    assert(
      probe.last.logCount === probe.before.logCount,
      `[A] 点击锁键日志增长 ${probe.before.logCount}->${probe.last.logCount}——拒绝应走瞬时层不写正文`
    );
    // 再观察 1s：不得有迟到落库（拒绝不该有异步副作用）。
    await page.waitForTimeout(1000);
    const after = await gatedState();
    assert(
      after.logCount === probe.before.logCount,
      `[A] 锁键点击后日志迟到增长 ${probe.before.logCount}->${after.logCount}`
    );
    const { body: svA2 } = await apiGet(`/saves/${sidA}`);
    assert(
      svA2 && svA2.save && svA2.save.scene === WORSHIP.id,
      `[A] 点击锁键后场景位移 — save.scene=${svA2 && svA2.save && svA2.save.scene}`
    );
    console.log(
      `    [A] 点击锁键 ${probe.ms}ms → toast「${probe.last.toast.slice(0, 40)}」、log 零增长、scene 不动`
    );

    // (h) 390 下无横向溢出。
    const fit390 = await page.evaluate(() => {
      const de = document.documentElement;
      return { sw: de.scrollWidth, cw: de.clientWidth };
    });
    assert(
      fit390.sw <= fit390.cw,
      `[390] 横向溢出：scrollWidth ${fit390.sw} > clientWidth ${fit390.cw}`
    );

    // ══ 存档 B：走置旗支线写 saw_statue_eyes → ch1_worship，解锁契约 ═
    await page.evaluate(() => localStorage.clear());
    await createSave(page, NAME_B);

    // ch1_double_gate：置旗支「先放慢脚步，绕墙观察那些石像」——
    // effects.flag=saw_statue_eyes，落点同为 ch1_law。
    await ensureMarker("ch1_double_gate", FLAG_CHOICE.label.slice(0, 6));
    await clickChoice(FLAG_CHOICE.label.slice(0, 6));
    await ensureMarker("ch1_law", TO_WORSHIP.label.slice(0, 6));
    await clickChoice(TO_WORSHIP.label.slice(0, 6));
    await ensureMarker("ch1_worship", "盯住巨像");

    // (f) 条件已满足：同一键解锁（busy 残影轮询到稳定值）。
    let st2 = await gatedState();
    for (
      let i = 0;
      i < 25 && st2.found && (st2.disabled !== false || st2.ariaDisabled === "true");
      i++
    ) {
      await page.waitForTimeout(200);
      st2 = await gatedState();
    }
    assert(st2.found, `[B] 未找到「盯住巨像」选项键`);
    assert(
      st2.disabled === false && st2.ariaDisabled !== "true",
      `[B] 置旗后「盯住巨像」键仍锁定 — disabled=${st2.disabled} aria-disabled=${st2.ariaDisabled}`
    );

    // (g) 点按必真推进：.log-entry 新增 ≥1（回显+正文），且 save.scene
    // 落地 choice.next——不允许「已解锁但点了没反应」的第二态。
    const sidB = await saveId();
    const logBefore = st2.logCount;
    await clickChoice("盯住巨像");
    const dl1 = Date.now() + 4000;
    let grew = 0;
    while (Date.now() < dl1) {
      grew = (await gatedState()).logCount - logBefore;
      if (grew >= 1) break;
      await page.waitForTimeout(150);
    }
    assert(
      grew >= 1,
      `[B] 解锁键点击后 .log-entry 零增长 ${logBefore}->${logBefore + grew}——「已解锁但没反应」同样算死键`
    );
    const dl2 = Date.now() + 10000;
    let lastScene = null;
    while (Date.now() < dl2) {
      const { body } = await apiGet(`/saves/${sidB}`);
      if (body && body.save) lastScene = body.save.scene;
      if (lastScene === GATED.next) break;
      await page.waitForTimeout(300);
    }
    assert(
      lastScene === GATED.next,
      `[B] 解锁键点击后未落地 choice.next — save.scene=${lastScene}（期望 ${GATED.next}）`
    );
    console.log(
      `    [B] 解锁 stare：log +${grew}、save.scene=${lastScene}（choice.next=${GATED.next}）`
    );
  },
  { viewport: { width: 390, height: 844 } }
);
