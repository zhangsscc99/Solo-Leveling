#!/usr/bin/env node
// combat-btn-parity.mjs (F275): 底部「战斗」键（[data-act=combat]）的
// 可点状态必须双端同态、同源——
//
//   第 57 轮走查：桌面 s8 同章节点「战斗」（disabled=false）82ms 进战；
//   手机（390 宽）同章同进度下同一键 disabled=true、点击零回执，界面
//   不解释为什么。同一状态两套规则（P1 可负担性）。
//
//   修复口径：可点条件由服务端 attackStatus 单一事实源随 save.attack
//   下发（available ⇔ 此刻原地「攻击」必开战：守关者叫阵 / 遭遇保底
//   到顶）；前端只渲染，桌面/手机键态天然同态。禁点时 title + 键面常
//   驻小字同文透传 reason，可点时不留误导性原因。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，骨架同
//   observe-cost-disclosed.mjs；dist 缺失/外链则先构建——本断言验的
//   正是本 worktree 的客户端代码）。
//
//   断言：
//     P1 双视口（390×844 / 1440×900）各建干净档，同一状态下
//        [data-act=combat] 的 disabled 完全一致（同 true 或同 false）；
//        且 disabled 与 API save.attack.available 同源（!available ⇔
//        disabled）——两端各查一次，证明可点性只有服务端一处推导。
//     P2 disabled 时存在可见原因：键 title 非空，且键面常驻小字
//        （.combat-entry-hint）含原因文字（等价于 .sys-toast 提示——
//        触屏无 hover，原因必须常驻可见而非只挂 title）；同时
//        aria-disabled="true"。
//     P3 推进两档到同章节同进度（保底到顶：观察堆 encounter_clock 到
//        PITY_LIMIT-1，确定性不赌概率掷点），重载后两端 disabled 同为
//        false；键面/title 不再出现「没有可攻击」字样；点击该键 800ms
//        内 .combat 出现（两个视口各点一次）。
//
//   旧码（.combat-entry 恒 disabled、无 data-act=combat、无
//   save.attack）应在 P1 即 FAIL；新码 PASS。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建（本断言验的是本 worktree 的客户端代码）。
{
  const dist = path.join(ROOT, "client", "dist");
  let foreign = false;
  try {
    foreign = fs.lstatSync(dist).isSymbolicLink();
  } catch {}
  if (foreign) fs.rmSync(dist, { force: true });
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    const buildEnv = { ...process.env };
    delete buildEnv.NODE_CHANNEL_FD;
    delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
    const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
      cwd: ROOT,
      stdio: "inherit",
      env: buildEnv,
    });
    if (b.status !== 0) {
      console.log("FAIL: combat-btn-parity client/dist 缺失且 npm --prefix client run build 失败");
      process.exit(1);
    }
  }
}

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f275-"));
const env = { ...process.env, PORT: String(port), DB_PATH: path.join(tmpDir, "game.db") };
for (const k of [
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
  "E2E_BASE",
  "E2E_BASE_URL",
  "E2E_API",
  "OPENCODE_GO_API_KEY",
  "OPENCODE_GO_BASE_URL",
  "AI_ALIYUN_API_KEY",
  "AI_ALIYUN_BASE_URL",
  "AI_ALIYUN_MODEL",
]) {
  delete env[k];
}
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
    console.log(`FAIL: combat-btn-parity 隔离实例 15s 未就绪：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = BASE;
const { assert, run, createSave } = await import("./lib.mjs");

// [data-act=combat] 现场取证：disabled（原生 + aria）、title、键面可见
// 小字（.combat-entry-hint——禁点原因的常驻呈现槽）、是否真实可见。
const readCombatBtn = (page) =>
  page.evaluate(() => {
    const b = document.querySelector("[data-act=combat]");
    if (!b) return null;
    const r = b.getBoundingClientRect();
    const hint = b.querySelector(".combat-entry-hint");
    return {
      found: true,
      disabled: b.disabled === true,
      ariaDisabled: b.getAttribute("aria-disabled"),
      title: b.getAttribute("title") || "",
      text: (b.innerText || "").replace(/\s+/g, ""),
      hintText: hint ? (hint.textContent || "").trim() : "",
      visible: r.width > 0 && r.height > 0,
      cls: String(b.className || ""),
    };
  });

const fetchSave = async (saveId) => {
  const r = await fetch(`${API}/saves/${saveId}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  return body && body.save ? body.save : null;
};

const postAction = async (saveId, input) => {
  const r = await fetch(`${API}/action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ save_id: saveId, input }),
    signal: AbortSignal.timeout(5000),
  });
  return r.json().catch(() => null);
};

const saveIdOf = (page, tag) =>
  page
    .evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")))
    .then((id) => {
      assert(id > 0, `${tag}: localStorage 里取不到 save_id`);
      return id;
    });

// 推进到「保底到顶」态：可掷怪场景每次复核区「观察」稳定
// encounter_clock+1，到 PITY_LIMIT-1 时下一次「攻击」必遇敌——服务端
// attackStatus 与 roll 的 c+1>=PITY_LIMIT 同一判定，确定性不赌概率。
// 全程只走 API（不依赖 UI 时序），推完由调用方 reload 回灌真实存档视图。
async function driveToAttackReady(page, saveId, tag) {
  for (let i = 0; i < 14; i++) {
    const s = await fetchSave(saveId);
    assert(s, `${tag}: GET /saves/${saveId} 失败`);
    if (s.attack && s.attack.available === true) return { ready: true, clock: s.encounter_clock };
    if (s.combat) {
      console.log(`FAIL: ${tag} 保底堆叠途中被意外拉进交战（确定性路径不应掷点）`);
      process.exit(1);
    }
    const r = await postAction(saveId, "观察");
    assert(r, `${tag}: POST /action 观察 回包不可解析`);
    await page.waitForTimeout(60);
  }
  const s = await fetchSave(saveId);
  assert(
    s && s.attack && s.attack.available === true,
    `${tag}: 14 次观察内未到保底态（attack.available!==true，clock=${s && s.encounter_clock}）`
  );
  return { ready: true, clock: s.encounter_clock };
}

// 同一状态双端键态取证 + 一致性断言（P1/P2/P3 共用的核心口径）。
async function assertParity(page, mpage, tag) {
  const d = await readCombatBtn(page);
  const m = await readCombatBtn(mpage);
  assert(d && d.found, `${tag}: 1440 视口找不到 [data-act=combat] 键`);
  assert(m && m.found, `${tag}: 390 视口找不到 [data-act=combat] 键`);
  assert(
    d.disabled === m.disabled,
    `${tag}: 双端键态不一致——desktop disabled=${d.disabled} mobile disabled=${m.disabled}（同一状态两套规则，F275 缺陷复现）`
  );
  if (d.disabled) {
    // 禁点必有可见原因：title 非空只是下限（触屏无 hover），键面常驻
    // 小字必须含原因文字——等价于 .sys-toast 的常驻提示口径。
    assert(
      d.title.trim().length > 0 || d.hintText.trim().length > 0,
      `${tag}: desktop 禁点无可见原因（title 与键面小字皆空）`
    );
    assert(
      m.title.trim().length > 0 || m.hintText.trim().length > 0,
      `${tag}: mobile 禁点无可见原因（title 与键面小字皆空）`
    );
    assert(
      d.hintText.trim().length > 0 || /没有可攻击|无可战|惊散|遇到敌人|归途/.test(d.text),
      `${tag}: desktop 禁点缺常驻原因小字（hint="${d.hintText}" text="${d.text}"）`
    );
    assert(
      m.hintText.trim().length > 0 || /没有可攻击|无可战|惊散|遇到敌人|归途/.test(m.text),
      `${tag}: mobile 禁点缺常驻原因小字（hint="${m.hintText}" text="${m.text}"）`
    );
    assert(
      d.ariaDisabled === "true" && m.ariaDisabled === "true",
      `${tag}: 禁点缺 aria-disabled="true"（d=${d.ariaDisabled} m=${m.ariaDisabled}）`
    );
  } else {
    // 可点态不得留误导性原因。
    for (const [label, x] of [
      ["desktop", d],
      ["mobile", m],
    ]) {
      assert(
        !/没有可攻击|无可战/.test(`${x.title} ${x.text}`),
        `${tag}: ${label} 可点态仍挂误导性原因（title="${x.title}" text="${x.text}"）`
      );
      assert(
        x.ariaDisabled !== "true",
        `${tag}: ${label} 可点态却标 aria-disabled="true"`
      );
    }
  }
  return { d, m };
}

// 键态与服务端字段同源核验：DOM disabled ⇔ !save.attack.available。
async function assertSingleSource(page, saveId, tag) {
  const s = await fetchSave(saveId);
  assert(
    s && s.attack && typeof s.attack.available === "boolean",
    `${tag}: save.attack 字段缺失——可点性单一事实源未下发`
  );
  const dom = await readCombatBtn(page);
  assert(dom && dom.found, `${tag}: 页面找不到 [data-act=combat]`);
  assert(
    dom.disabled === !s.attack.available,
    `${tag}: DOM disabled(${dom.disabled}) 与 save.attack.available(${s.attack.available}) 不同源`
  );
  return s;
}

run(
  "combat-btn-parity",
  async ({ page, ctx }) => {
    // 失败出口统一前缀「FAIL: <原因>」——lib.run 的 FAIL 行照常打印，
    // 这里先把可读原因落 stdout（截图仍由 run 兜底）。
    try {
      await body({ page, ctx });
    } catch (e) {
      console.log(`FAIL: ${e && e.message ? e.message : e}`);
      throw e;
    }
  },
  { viewport: { width: 1440, height: 900 } }
);

async function body({ page, ctx }) {
    const ts = Date.now().toString(36);
    // 第二视口（390×844 手机档）与首个 1440×900 页签同一浏览器、各自
    // 干净 context（独立 localStorage——两档互不污染，可重复跑）。
    const mctx = await ctx.browser().newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const mpage = await mctx.newPage();
    mpage.setDefaultTimeout(20000);

    await createSave(page, `cbpd${ts}`.slice(0, 20));
    await createSave(mpage, `cbpm${ts}`.slice(0, 20));
    const dId = await saveIdOf(page, "desktop");
    const mId = await saveIdOf(mpage, "mobile");

    // ── P1/P2 新档态（同章节同进度：双档都在第 1 章开场）─────────
    // 干净档开场 attack.available=false——两端都必须 disabled，且禁点
    // 原因常驻可读。
    let st = await assertParity(page, mpage, "P1 新档态");
    assert(st.d.disabled === true, `P1: 新档开场 combat 键竟可点（desktop）`);
    await assertSingleSource(page, dId, "P1 desktop");
    await assertSingleSource(mpage, mId, "P1 mobile");
    console.log(`    [OK] P1/P2 新档态双端 disabled=true 且原因可见（desktop hint="${st.d.hintText || st.d.title}"）`);

    // ── P3 推进到保底必中态（同章节同进度：两档都原地观察堆动静）─
    await driveToAttackReady(page, dId, "desktop");
    await driveToAttackReady(mpage, mId, "mobile");
    // API 直推不触发前端刷新——各端 reload 一次让 React 回灌真实 save。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await mpage.reload({ waitUntil: "domcontentloaded" });
    await mpage.waitForSelector(".status");
    await page.waitForSelector("[data-act=combat]");
    await mpage.waitForSelector("[data-act=combat]");

    st = await assertParity(page, mpage, "P3 保底态");
    assert(
      st.d.disabled === false,
      `P3: 保底到顶（下一击必遇敌）combat 键仍 disabled（desktop cls=${st.d.cls}）`
    );
    await assertSingleSource(page, dId, "P3 desktop");
    await assertSingleSource(mpage, mId, "P3 mobile");
    console.log(`    [OK] P3 保底态双端 disabled=false 且无误导性原因（hint="${st.d.hintText}"）`);

    // ── 点击 800ms 内进入交战态（两端各验一次）─────────────────
    for (const [tag, p] of [
      ["desktop", page],
      ["mobile", mpage],
    ]) {
      await p.click("[data-act=combat]");
      const t0 = Date.now();
      try {
        await p.waitForSelector(".combat", { timeout: 800 });
      } catch {
        console.log(`FAIL: ${tag} 点击 [data-act=combat] 后 800ms 内未出现 .combat 交战面板`);
        process.exit(1);
      }
      const ms = Date.now() - t0;
      console.log(`    [OK] ${tag} 点击后 ${ms}ms 进入交战态`);
    }

    await mctx.close().catch(() => {});
    console.log("PASS F275 combat-btn-parity：双视口键态同源一致 · 禁点原因常驻 · 可点即开战");
}
