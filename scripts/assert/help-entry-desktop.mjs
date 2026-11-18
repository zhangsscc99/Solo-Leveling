#!/usr/bin/env node
// F224 桌面（>880px）帮助入口断言——自起隔离实例（空闲端口 + tmp DB +
// AI key 置空），UI 走本 worktree 的 client/dist（与线上一致的回包链
// 路），进程退出时 SIGKILL 子进程并清临时库：
//
//   1440×900：.help-toggle isVisible 且触达矩形宽高 ≥44px；点击后
//     .stage-col 新增至少一行同时含「前进」与「帮助」（服务端 help 意图
//     的完整指令表落日志行）；点击前后 .stage 的 top 不变（顶栏不增高、
//     不顶开主舞台）；页面 scrollWidth===clientWidth。
//   390×844：.help-toggle 仍可见；.drawer-toggle 恰好 1 个元素且仍可见
//     （抽屉开关语义不变）；点击帮助键同样落指令表行。
//   全程无未捕获 console error / pageerror。
//
// 变异敏感性：把 .help-toggle 收回 display:none 基线 → 1440 isVisible
//   必红；点击不走「帮助」dispatch → .stage-col 无指令表行必红；
//   顶栏被撑高/换行 → .stage.top 位移或横向溢出必红。
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  console.error("[F224] client/dist 缺失——先跑 `npm run build`（根 package.json scripts.build）");
  process.exit(1);
}

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

// ── 隔离实例：端口/库独立，AI key 置空挡根 .env 注回 ──────────────────
const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f224-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
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

// 动态 import 之前先指向隔离实例——lib.mjs 的 BASE_URL 在模块加载时定值。
process.env.E2E_BASE_URL = `http://127.0.0.1:${gamePort}/game`;
const { run, createSave, assert, BASE_URL } = await import("../e2e/lib.mjs");

{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[F224] 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

const NAME = `F224-${Date.now().toString(36)}`;
const NAME2 = `F224b-${Date.now().toString(36)}`;

const stageTop = (page) =>
  page.locator(".stage").evaluate((el) => el.getBoundingClientRect().top);
const noOverflow = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth === document.documentElement.clientWidth
  );

// 点击「?」帮助键：与手动输入「帮助」同一条 dispatch → /api/action。
// 返回新增的 .stage-col 子节点文本数组。
async function clickHelp(page) {
  const rowsBefore = await page.locator(".stage-col > *").count();
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/action") && r.request().method() === "POST"
    ),
    page.locator(".help-toggle").click(),
  ]);
  await resp.finished().catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".pending"));
  return page
    .locator(".stage-col > *")
    .evaluateAll((els, n) => els.slice(n).map((el) => el.textContent || ""), rowsBefore);
}

function assertHelpRow(newRows, tag) {
  const hit = newRows.find((t) => t.includes("前进") && t.includes("帮助"));
  assert(
    hit,
    `${tag} 点击帮助键后 .stage-col 未新增含「前进」+「帮助」的指令表行：` +
      `${newRows.map((t) => t.slice(0, 60)).join(" | ") || "(无新增行)"}`
  );
  return hit;
}

function hookConsole(page, errs) {
  page.on("console", (m) => {
    if (m.type() === "error") errs.push(m.text());
  });
  page.on("pageerror", (e) => errs.push(String(e)));
}

run(
  "help-entry-desktop",
  async ({ page, ctx }) => {
    const consoleErrs = [];
    hookConsole(page, consoleErrs);

    // ── 1440×900 桌面 ────────────────────────────────────────────
    await createSave(page, NAME);
    await page.waitForSelector(".input-row input");

    const help = page.locator(".help-toggle");
    assert((await help.count()) === 1, "桌面 .help-toggle 数量异常（应恰为 1）");
    assert(await help.isVisible(), "1440 桌面下 .help-toggle 不可见——帮助入口丢失");
    const hb = await help.boundingBox();
    assert(hb, "无法读取 .help-toggle 矩形");
    assert(
      hb.width >= 44 && hb.height >= 44,
      `桌面帮助键触达不足 44px：${hb.width.toFixed(1)}×${hb.height.toFixed(1)}`
    );

    const topBefore = await stageTop(page);
    const newRows = await clickHelp(page);
    assertHelpRow(newRows, "[1440]");
    assert(
      (await stageTop(page)) === topBefore,
      `点击后 .stage.top 位移：${topBefore} → ${await stageTop(page)}（顶栏被撑高/主舞台被顶开）`
    );
    assert(await noOverflow(page), "1440 下出现横向溢出");

    // ── 390×844 窄屏（行为与 F221 完全一致）─────────────────────
    const ctx2 = await ctx.browser().newContext({
      viewport: { width: 390, height: 844 },
      locale: "zh-CN",
    });
    const page2 = await ctx2.newPage();
    page2.setDefaultTimeout(20000);
    hookConsole(page2, consoleErrs);
    try {
      await createSave(page2, NAME2);
      await page2.waitForSelector(".input-row input");

      const help2 = page2.locator(".help-toggle");
      assert(await help2.isVisible(), "390 下 .help-toggle 不可见");
      const hb2 = await help2.boundingBox();
      assert(
        hb2 && hb2.width >= 44 && hb2.height >= 44,
        `390 下帮助键触达不足 44px：${hb2 && `${hb2.width.toFixed(1)}×${hb2.height.toFixed(1)}`}`
      );
      const drawer = page2.locator(".drawer-toggle");
      assert(
        (await drawer.count()) === 1,
        `390 下 .drawer-toggle 应为唯一抽屉开关，实际 ${await drawer.count()} 个`
      );
      assert(await drawer.isVisible(), "390 下 .drawer-toggle 不可见");
      assertHelpRow(await clickHelp(page2), "[390]");
      assert(await noOverflow(page2), "390 下出现横向溢出");
    } finally {
      await ctx2.close().catch(() => {});
    }

    assert(consoleErrs.length === 0, `console error: ${consoleErrs.join(" | ")}`);
    console.log(
      `    桌面帮助键 44px 触达可见、点击落指令表行、.stage.top 不动；390 行为不变（目标 ${BASE_URL}）`
    );
  },
  { viewport: { width: 1440, height: 900 } }
);
