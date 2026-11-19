#!/usr/bin/env node
// boot-drawer-closed.mjs (F284): 干净档点「觉醒」进入第一幕后，档案抽屉
// 不得默认展开压住正文与选项——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档走真实
//   「觉醒」建档路径：
//     a) 进入第一幕 2s 后（390×844）：.drawer-veil 与 .sidebar 均不可见
//        ——display:none / visibility:hidden / 元素缺席 / 矩形完全在
//        视口外（关闭态遮罩不得只靠 opacity:0 + pointer-events 兜底；
//        fixed 元素 offsetParent 恒 null，不作数）；
//     b) 首屏视口内至少一个 [data-act] 剧情/系统键可被命中
//        （elementFromPoint 不被遮罩/面板拦截）；
//     c) 正例反洗绿：点「背包」系统键 → 抽屉打开（.sidebar.open /
//        .drawer-veil.show 可见），点 × → 两者重新不可见；
//     d) 1440×900 下 .sidebar 为常驻三栏、不算抽屉——只断言正文键
//        可点且 .drawer-veil 不可见。
//
//   旧码红证：旧 CSS 关闭态 .drawer-veil 仍 display:block/opacity:0/
//   z-index:20 留在渲染树——(a) 的可见性口径不成立 → FAIL。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f284-"));
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
});

{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/game/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[E2E] boot-drawer-closed: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

// 不可见口径（遮罩层用）：元素缺席，或 display:none / visibility:hidden。
// 注意 offsetParent 对 position:fixed 恒为 null，不能作为 fixed 遮罩
// 「不可见」的证据——旧码 .drawer-veil 就是 display:block/opacity:0/
// 只挂 pointer-events:none 兜底，必须靠 display/visibility 口径揪出。
function hiddenState(sel) {
  const el = document.querySelector(sel);
  if (!el) return { hidden: true, why: "absent" };
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden")
    return { hidden: true, why: `${cs.display}/${cs.visibility}` };
  if (el.offsetParent === null && cs.position !== "fixed")
    return { hidden: true, why: "offsetParent" };
  return {
    hidden: false,
    why: `display=${cs.display} visibility=${cs.visibility} opacity=${cs.opacity} position=${cs.position}`,
  };
}

// .sidebar 关闭态（≤880 抽屉）：不带 .open，且矩形完全落在视口外
// （translateX(100%) 推出屏外）；open 或盖住视口即判可见。
function sidebarClosed() {
  const el = document.querySelector(".sidebar");
  if (!el) return { hidden: true, why: "absent" };
  if (el.classList.contains("open"))
    return { hidden: false, why: "has .open" };
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden")
    return { hidden: true, why: `${cs.display}/${cs.visibility}` };
  const r = el.getBoundingClientRect();
  if (r.right <= 0 || r.left >= window.innerWidth || r.width === 0)
    return { hidden: true, why: `offscreen left=${Math.round(r.left)}` };
  return { hidden: false, why: `onscreen rect=${JSON.stringify(r)}` };
}

// 首屏视口内是否存在一个可命中的 [data-act] 键（elementFromPoint 落到
// 该键或其子节点，即不被遮罩/面板拦截）。
function clickableAct() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  for (const el of document.querySelectorAll("[data-act]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const x = Math.min(Math.max(r.left + r.width / 2, 0), vw - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), vh - 1);
    if (r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const hit = document.elementFromPoint(x, y);
    if (hit && (hit === el || el.contains(hit))) return el.dataset.act;
  }
  return null;
}

async function assertClosed(page, tag) {
  const veil = await page.evaluate(hiddenState, ".drawer-veil");
  assert(veil.hidden, `${tag}: .drawer-veil 仍可见 (${veil.why})`);
  const side = await page.evaluate(sidebarClosed);
  assert(side.hidden, `${tag}: .sidebar 仍可见 (${side.why})`);
  const act = await page.evaluate(clickableAct);
  assert(act !== null, `${tag}: 首屏无可点击的 [data-act] 键`);
}

run("boot-drawer-closed", async ({ page }) => {
  // ── 390×844：抽屉态全口径 ──────────────────────────────
  await createSave(page, `e2e-f284-${Date.now().toString(36)}`);
  await page.waitForTimeout(2000);

  await assertClosed(page, "390 觉醒后 2s");

  // 正例：点「背包」系统键 → 抽屉打开；× → 关闭。
  await page.click('[data-act="inventory"]');
  await page.waitForSelector(".sidebar.open");
  const veilShown = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector(".drawer-veil"));
    return cs.visibility === "visible" && Number(cs.opacity) > 0;
  });
  assert(veilShown, "点「背包」后 .drawer-veil 未展开");
  await page.click(".side-close");
  await page.waitForTimeout(300); // 0.2s 过渡 + 余量
  await assertClosed(page, "390 × 关闭后");

  // ── 1440×900：.sidebar 为常驻三栏（非抽屉）——只断言遮罩不可见、
  // 正文键仍可点，不得把常驻栏误判为「应隐藏」。 ─────────────
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  const veil1440 = await page.evaluate(hiddenState, ".drawer-veil");
  assert(veil1440.hidden, `1440: .drawer-veil 可见 (${veil1440.why})`);
  const act1440 = await page.evaluate(clickableAct);
  assert(act1440 !== null, "1440: 首屏无可点击的 [data-act] 键");
}, { viewport: { width: 390, height: 844 } });
