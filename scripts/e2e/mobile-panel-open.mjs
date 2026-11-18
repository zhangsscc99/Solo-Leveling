#!/usr/bin/env node
// mobile-panel-open.mjs (F255): 390×844 触屏下底部 6 个系统键必须真正
// 拉开抽屉——
//
//   第 53 轮走查实测：脱战关抽屉后点「任务」「属性」，aside.sidebar
//   的 class 停在 sidebar（无 open），rect.left=390 整块在视口外，
//   屏幕零变化——玩家认定底栏全坏。根因：≤880px 档 .btn-group-sys
//   是 nowrap + overflow-x:auto 的横滑容器，390px 下 8 键排到 ~520px，
//   「地图」只露 15px 边、「任务/影子/战斗/存档」整条在视口外——
//   elementFromPoint 命中 null，真实手指根本落不到键面上；且触点
//   落在可横滚容器内，微位移被浏览器判成滚动手势、click 被吞。
//   行动组早在 F085 就因同型问题改栅格折行（「全部落在视口内」是
//   按钮区硬契约），系统组 F113 收成横滑 meta 行时把 bug 带了回来。
//   修法：系统组与行动组同契约——折行平铺、8 键全落视口，不再横滑。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），390×844、
//   hasTouch/isMobile。建档 → 右上「档案」开抽屉 → × 关 → 依次用
//   原始触屏坐标点（不自动滚动）底栏 背包/技能/属性/地图/任务/影子：
//     a. aside.sidebar 带 open 类；
//     b. rect.left < innerWidth-100（真正进入视口）；
//     c. .side-title .cur 文本 = 对应面板名，且标题在抽屉可视区内；
//     d. 点 .side-close 后 open 移除且 rect.left >= innerWidth-1。
//   末尾点「档案」再开同一抽屉做对照组。点不到的键（可视交叠面积
//   为 0）直接记 FAIL——那正是本 bug 的玩家体验。
//   失败打印 [ASSERT] 明细并 exit=1；确定性（无随机），连跑 2 次同结果。
//
//   旧码红证：不改 client 直接跑本脚本，(a) 抓住视口外死键，exit=1：
//     [ASSERT] 地图: 键面可视交叠为空（btn x=375..427 vs 视口 390）——
//       真实触点落不到按钮上
//     [ASSERT] 任务: 键面可视交叠为空（btn x=435..487 vs 视口 390）
//   修复后连跑 2 次 PASS、exit=0。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPW, findChrome } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

const port = await new Promise((res, rej) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => res(p));
  });
  s.on("error", rej);
});
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "f255-"));
const env = {
  ...process.env,
  PORT: String(port),
  DB_PATH: path.join(tmp, "game.db"),
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

const BASE = `http://127.0.0.1:${port}/game`;
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[E2E] mobile-panel-open: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

let failures = 0;
function check(cond, msg) {
  if (!cond) {
    failures++;
    console.error(`[ASSERT] ${msg}`);
  }
}

const pw = loadPW();
const browser = await pw.chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  locale: "zh-CN",
});
const page = await ctx.newPage();
page.setDefaultTimeout(20000);

const sidebar = () =>
  page.evaluate(() => {
    const a = document.querySelector("aside.sidebar");
    const r = a.getBoundingClientRect();
    return { open: a.classList.contains("open"), left: r.left, w: r.width, iw: window.innerWidth };
  });

try {
  // 建档
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");
  await page.fill(".gate-form input", `f255-${Date.now() % 100000}`);
  await page.click(".gate-form button[type=submit]");
  await page.waitForSelector(".status");

  // 关一次抽屉（先开再关，走真实关闭路径）
  await page.locator(".drawer-toggle").tap();
  await page.waitForSelector("aside.sidebar.open");
  // 0.2s 滑入过渡：等矩形真正进视口再断，别把过渡首帧当失败
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector("aside.sidebar.open");
        return Boolean(el) && el.getBoundingClientRect().left < window.innerWidth - 100;
      },
      null,
      { timeout: 3000 }
    )
    .catch(() => {});
  let s = await sidebar();
  check(s.open && s.left < s.iw - 100, `预置: 「档案」开抽屉失败 left=${s.left}`);
  await page.locator(".side-close").tap();
  await page.waitForTimeout(350);
  s = await sidebar();
  check(!s.open && s.left >= s.iw - 1, `预置: × 关闭未复位 open=${s.open} left=${s.left}`);

  for (const label of ["背包", "技能", "属性", "地图", "任务", "影子"]) {
    const btn = page.locator(".btn-group-sys .btn", { hasText: label }).first();
    // 键面与视口的交叠——真实手指只能落在交叠内；为空即「死键」实锤。
    const hit = await btn.evaluate((b) => {
      const r = b.getBoundingClientRect();
      const x0 = Math.max(r.left, 0);
      const x1 = Math.min(r.right, window.innerWidth);
      const y0 = Math.max(r.top, 0);
      const y1 = Math.min(r.bottom, window.innerHeight);
      if (x1 - x0 < 8 || y1 - y0 < 8) return null;
      const e = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      return {
        x: (x0 + x1) / 2,
        y: (y0 + y1) / 2,
        target: e ? `${e.tagName}.${String(e.className).split(" ")[0]}` : "null",
        btnRect: `x=${r.left.toFixed(0)}..${r.right.toFixed(0)} vs 视口 ${window.innerWidth}`,
      };
    });
    check(
      hit !== null && (hit.target === "BUTTON.btn" || hit.target === "KBD.key-badge"),
      `${label}: 键面可视交叠${hit ? `被 ${hit.target} 拦截` : `为空（btn ${await btn.evaluate((b) => { const r = b.getBoundingClientRect(); return `x=${r.left.toFixed(0)}..${r.right.toFixed(0)}`; })} vs 视口 390）`}——真实触点落不到按钮上`
    );
    if (hit) await page.touchscreen.tap(hit.x, hit.y);
    await page.waitForTimeout(350);
    s = await sidebar();
    check(s.open, `${label}: (a) 点按后 aside.sidebar 无 open 类`);
    check(s.left < s.iw - 100, `${label}: (b) 抽屉未入视口 left=${s.left.toFixed(1)} iw=${s.iw}`);
    const cur = await page.evaluate(() => {
      const el = document.querySelector(".side-title .cur");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { text: el.textContent, x: r.left, w: r.width, iw: window.innerWidth };
    });
    check(
      cur !== null && cur.text === label && cur.x >= 0 && cur.x + cur.w <= cur.iw,
      `${label}: (c) 面板名不符或出视口 ${JSON.stringify(cur)}`
    );
    // 点 × 关闭——open 移除且抽屉退回视口右缘外
    const close = page.locator(".side-close");
    if (await close.count()) {
      await close.tap().catch(() => {});
      await page.waitForTimeout(350);
    }
    s = await sidebar();
    check(!s.open, `${label}: (d) × 后 open 类未移除`);
    check(s.left >= s.iw - 1, `${label}: (d) × 后抽屉未退回 left=${s.left.toFixed(1)} iw=${s.iw}`);
  }

  // 对照组：右上「档案」仍开同一抽屉
  await page.locator(".drawer-toggle").tap();
  await page.waitForTimeout(350);
  s = await sidebar();
  check(s.open && s.left < s.iw - 100, `对照组: 「档案」开抽屉失败 open=${s.open} left=${s.left}`);
} catch (e) {
  failures++;
  console.error(`[ASSERT] 未捕获异常: ${e.message}`);
}

await browser.close().catch(() => {});
if (failures) {
  console.log(`[E2E] mobile-panel-open FAIL (${failures} 条断言)`);
  process.exit(1);
}
console.log(`[E2E] mobile-panel-open PASS：6 系统键全部拉开抽屉，× 复位，「档案」对照正常`);
process.exit(0);
