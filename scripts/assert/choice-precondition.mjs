#!/usr/bin/env node
// F211 验收断言：带前置条件的选项必须置灰并给可执行提示——
//
//   背景（玩家实测）：ch1_worship 的「抬起头，盯住巨像的眼睛（需先
//   观察过石像）」requires flag saw_statue_eyes，全新档没观察过时
//   该键仍可点（disabled=false），title 只复读 label——玩家分不清
//   「条件不满足」与「游戏坏了」。现在服务端按 requires 随
//   next_choices 下发 locked/locked_reason，前端置灰并在选项组
//   下方常驻一行 .choice-hint 透传服务端文案。
//
//   五条断言（F279 后「置灰」口径 = disabled===true 或 aria-disabled==="true"）：
//     1) 新档全程不观察（ch1_double_gate 选「跟着队伍走向殿中央」→
//        ch1_law 选「按石碑所写，低头敬拜」→ ch1_worship）：「盯住
//        巨像的眼睛」键 disabled===true 或 aria-disabled==="true"；
//     2) 该键 title 或页面 .choice-hint 文案含「观察」（可执行提示，
//        不是泛泛拒绝）；
//     3) 服务端兜底：直接 POST /api/action {input: label,
//        choice_id: "stare"} 必须 refused:true、回包正文含「观察」
//        且 save.scene 仍为 ch1_worship；
//     4) 另起一档走观察支（ch1_double_gate 选「先放慢脚步，绕墙观察
//        那些石像」写旗）再到 ch1_worship：该键 disabled === false；
//     5) 点击该键后 save.scene 变成 choice.next（ch1_statues）。
//
//   落点可能掷出遭遇战（实测 石像残兵 拦路）——交战态不铺选项键，
//   见到「逃跑」键先撤离（失败会被拦下，循环再点），脱战后选项组
//   重新渲染再量。
//
//   自起隔离实例：空闲端口 + DB_PATH=<tmp>/game.db 起本 worktree 的
//   server/index.js（默认路径，verify.sh 清环境后走这条）；显式
//   SL_E2E_BASE / E2E_BASE_URL 时改用外部实例不自起。
//   Playwright 390×844。
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

// ── 基址：SL_E2E_BASE/E2E_BASE_URL 外部实例优先，否则自起隔离实例 ──
let BASE = (process.env.SL_E2E_BASE || process.env.E2E_BASE_URL || "").replace(/\/+$/, "");
let child = null;
let tmpDir = null;
if (!BASE) {
  const gamePort = await freePort();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f211-"));
  const env = {
    ...process.env,
    PORT: String(gamePort),
    DB_PATH: path.join(tmpDir, "game.db"),
  };
  delete env.NODE_CHANNEL_FD;
  delete env.NODE_CHANNEL_SERIALIZATION_MODE;
  child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let childLog = "";
  child.stdout.on("data", (d) => (childLog += d));
  child.stderr.on("data", (d) => (childLog += d));
  BASE = `http://127.0.0.1:${gamePort}/game`;
  const api = `${BASE}/api`;
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${api}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[F211] 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    try {
      child.kill("SIGKILL");
    } catch {}
    process.exit(1);
  }
}
// 自起的实例与临时库随脚本退出一并清理（run() 内部走 process.exit，
// 只能靠 exit 钩子兜底）。
process.on("exit", () => {
  try {
    if (child) child.kill("SIGKILL");
  } catch {}
  try {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
});

process.env.E2E_BASE_URL = BASE;
const { run, createSave, assert } = await import("../e2e/lib.mjs");

const API = `${BASE}/api`;
const NAME_A = `f211-${Date.now().toString(36)}`;
const NAME_B = `f211b-${Date.now().toString(36)}`;
const VW = 390;
const VH = 844;

async function apiPost(pathname, body, ms = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${API}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

async function apiGet(pathname, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${API}${pathname}`, { signal: ctl.signal });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

await run(
  "choice-precondition",
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

    const saveId = () =>
      page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id") || 0));

    // 「盯住巨像的眼睛」键的锁态现场：disabled/aria-disabled/title/小字
    // 一次取回，断言失败时把实测值打进报错便于复查。
    // F279：锁键改用 aria-disabled + 键内拒绝（原生 disabled 吞点击零
    // 回执）——「置灰」语义 = disabled===true 或 aria-disabled==="true"。
    const stareState = () =>
      page.evaluate(() => {
        const b = [...document.querySelectorAll(".btn-group-choice .btn")].find(
          (x) => x.textContent.includes("盯住巨像")
        );
        const hint = document.querySelector(".choice-hint");
        return {
          found: Boolean(b),
          disabled: b ? b.disabled : null,
          ariaDisabled: b ? b.getAttribute("aria-disabled") : null,
          title: b ? b.getAttribute("title") || "" : "",
          hint: hint ? hint.textContent.trim() : "",
        };
      });

    // ══ 存档 A：全程不观察 → ch1_worship，锁键断言 ═════════════════
    await createSave(page, NAME_A);

    // ch1_double_gate：选非观察支「跟着队伍走向殿中央」（observe 支
    // 会写 saw_statue_eyes 旗，本档必须全程不观察）。
    await ensureMarker("ch1_double_gate", "跟着队伍");
    await clickChoice("跟着队伍");

    // ch1_law：「按石碑所写，低头敬拜」→ ch1_worship。
    await ensureMarker("ch1_law", "低头敬拜");
    await clickChoice("低头敬拜");

    // ch1_worship：脱战后「盯住巨像」键铺出。
    await ensureMarker("ch1_worship", "盯住巨像");
    await page.waitForTimeout(120);

    // 断言 1)+2)：锁键置灰（F279 口径：disabled 或 aria-disabled==="true"），
    // 且 title 或 .choice-hint 含「观察」。
    const st = await stareState();
    assert(st.found, `断言1: 未找到「盯住巨像」选项键`);
    assert(
      st.disabled === true || st.ariaDisabled === "true",
      `断言1: 未观察时「盯住巨像」键应置灰 — disabled=${st.disabled} aria-disabled=${st.ariaDisabled} title=「${st.title}」`
    );
    assert(
      st.title.includes("观察") || st.hint.includes("观察"),
      `断言2: 锁键无可执行提示 — title=「${st.title}」 choice-hint=「${st.hint}」`
    );
    // 服务端同源证据：next_choices 里 stare 必须 locked:true 且
    // locked_reason 含「观察」（排除 disabled 只是 busy 残影）。
    const sidA = await saveId();
    assert(sidA > 0, `断言1: localStorage 未取到存档 A id（${sidA}）`);
    const { body: svA } = await apiGet(`/saves/${sidA}`);
    const chA =
      svA && svA.save && Array.isArray(svA.save.next_choices)
        ? svA.save.next_choices.find((c) => c && c.id === "stare")
        : null;
    assert(
      chA && chA.locked === true && String(chA.locked_reason || "").includes("观察"),
      `断言1/2: next_choices.stare 锁态字段异常 — ${JSON.stringify(chA)}`
    );
    console.log(
      `    [A] stare 锁键 disabled=${st.disabled} title=「${st.title}」 hint=「${st.hint}」`
    );

    // 断言 3)：服务端兜底——直接 POST 该选项仍 refused、正文含「观察」、
    // 场景不位移。
    const label = "抬起头，盯住巨像的眼睛（需先观察过石像）";
    const { status: rs, body: rb } = await apiPost("/action", {
      save_id: sidA,
      input: label,
      choice_id: "stare",
    });
    const rcontent = rb && rb.reply && rb.reply.content ? rb.reply.content : "";
    const rscene = rb && rb.save ? rb.save.scene : null;
    assert(
      rs === 200 && rb && rb.refused === true,
      `断言3: POST stare 未 refused — HTTP ${rs} refused=${rb && rb.refused} body=${JSON.stringify(rb).slice(0, 200)}`
    );
    assert(
      rcontent.includes("观察"),
      `断言3: 拒绝正文未含「观察」— content=「${rcontent.slice(0, 120)}」`
    );
    assert(
      rscene === "ch1_worship",
      `断言3: 拒绝后场景位移 — save.scene=${rscene}`
    );
    console.log(`    [A] POST stare refused，正文含「观察」，scene=${rscene}`);

    // ══ 存档 B：走观察支写旗 → ch1_worship，解锁断言 ══════════════
    await page.evaluate(() => localStorage.clear());
    await createSave(page, NAME_B);

    // ch1_double_gate：「先放慢脚步，绕墙观察那些石像」写
    // saw_statue_eyes 旗，落点同为 ch1_law。
    await ensureMarker("ch1_double_gate", "绕墙观察");
    await clickChoice("绕墙观察");
    await ensureMarker("ch1_law", "低头敬拜");
    await clickChoice("低头敬拜");
    await ensureMarker("ch1_worship", "盯住巨像");
    await page.waitForTimeout(120);

    // 断言 4)：观察过石像后同一键恢复可点 disabled===false 且不带
    // aria-disabled 锁影（busy 残影会让整组短时置灰——轮询到稳定值再判）。
    let st2 = await stareState();
    for (
      let i = 0;
      i < 20 && st2.found && (st2.disabled !== false || st2.ariaDisabled === "true");
      i++
    ) {
      await page.waitForTimeout(300);
      st2 = await stareState();
    }
    assert(st2.found, `断言4: 存档 B 未找到「盯住巨像」选项键`);
    assert(
      st2.disabled === false && st2.ariaDisabled !== "true",
      `断言4: 观察后「盯住巨像」键应可点 — disabled=${st2.disabled} aria-disabled=${st2.ariaDisabled} title=「${st2.title}」`
    );
    const sidB = await saveId();
    assert(sidB > 0, `断言4: localStorage 未取到存档 B id（${sidB}）`);
    const { body: svB } = await apiGet(`/saves/${sidB}`);
    const chB =
      svB && svB.save && Array.isArray(svB.save.next_choices)
        ? svB.save.next_choices.find((c) => c && c.id === "stare")
        : null;
    assert(
      chB && chB.locked === false,
      `断言4: next_choices.stare 观察后仍锁定 — ${JSON.stringify(chB)}`
    );
    console.log(`    [B] stare 解锁 disabled=${st2.disabled} title=「${st2.title}」`);

    // 断言 5)：点击落地 choice.next——save.scene 变 ch1_statues
    // （落点可能掷遭遇战：场景先落地后开战，save.scene 口径不变，
    // 直接轮询服务端存档视图，不在交战中量 UI）。
    await clickChoice("盯住巨像");
    let lastScene = null;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const { body } = await apiGet(`/saves/${sidB}`);
      if (body && body.save) lastScene = body.save.scene;
      if (lastScene === "ch1_statues") break;
      await page.waitForTimeout(300);
    }
    assert(
      lastScene === "ch1_statues",
      `断言5: 点击后未落地 choice.next — save.scene=${lastScene}（期望 ch1_statues）`
    );
    console.log(`    [B] 点击 stare 落地 save.scene=${lastScene}`);
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
