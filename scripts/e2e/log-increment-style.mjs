#!/usr/bin/env node
// log-increment-style.mjs (F252): 日志增量必须有可感知的视觉分层——
//
//   第 52 轮走查实测：新档连续动作几次后，追加的日志段落无分隔、
//   无时间戳、无淡入、无「最新一条」高亮，字号颜色与历史文本完全
//   一致——6 次动作后正文成一堵同色字墙，「我这一下发生了什么」
//   要大量回滚才能找到。
//
//   修法（前端纯渲染层，不动 server 语义 / 不动既有选择器）：
//     · 每条日志段收进一个 .log-entry 包装节点（.stage-col 追加
//       .log 类），条目边界转为可查询结构；
//     · 最新一段挂 data-latest="1"（全日志唯一），样式给出 3px
//       左侧强调轨 + 极淡系统色底；非最新条以 padding 预留同宽
//       边位，高亮下移时正文列不左右跳；
//     · .log-entry 入场淡入 240ms（<=300ms），prefers-reduced-motion
//       下归零（全局 * 规则 + 组件级媒体查询双保险）；
//     · 条目间距 sp-5 大于段内段落间距 sp-4。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空，client/dist
//   缺失或为外部软链时先补 worktree 构建），新档经输入框连发 3 次
//   「观察」（指令形态走 /action，最稳），随后断言：
//     a) .log > .log-entry 条目可数且 >= 3，全部命中同一选择器族；
//     b) 全 .log 内恰好 1 个 .log-entry 带 data-latest="1"，且它就
//        是 DOM 序最末一条 .log-entry；
//     c) 最新一条与上一条的 computedStyle 至少一项不同：
//        borderLeftWidth / backgroundColor / opacity；
//     d) 1440×900 与 390×844 各跑一次：.log scrollWidth <=
//        clientWidth（无横向溢出）且相邻条目间距 > 0。
//   失败打印 [ASSERT] 明细并 exit=1；全过 exit=0。
//
//   旧码红证：改动前 .stage-col 没有 .log 类、条目没有 .log-entry
//   包装——断言 (a) 立即失败（.log-entry count=0）；即便按旧结构
//   （.narration/.echo/.holo 平铺为直接子节点）手工补出条目集，断言
//   (c) 也必然红：相邻两条的 borderLeftWidth/backgroundColor/opacity
//   computedStyle 完全一致（无左轨、无底色的同色字墙正是本任务要
//   修的现象）。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建（与
// attr-plus-disabled / stage-bottom-clearance 同口径）；dist 是指向
// 外部产物的软链（如 rest-feedback 兜底链向主仓）→ 摘掉再构建——
// 本断言验的正是本 worktree 的客户端代码，外部 bundle 里没有
// .log-entry / data-latest。
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
      console.error("[E2E] log-increment-style: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f252-"));
const dbPath = path.join(tmpDir, "game.db");
const env = {
  ...process.env,
  PORT: String(port),
  DB_PATH: dbPath,
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

const API = `http://127.0.0.1:${port}/game/api`;
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
    console.error(`[E2E] log-increment-style: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const NAME = `f252-${Date.now().toString(36)}`;
const ACTIONS = 3;

// [ASSERT] 明细先行（值全量落 stderr），再走 assert 终止——排查时
// 不用复跑就能看到两侧 computedStyle / 几何原始读数。
function report(tag, detail) {
  console.error(`[ASSERT] ${tag} ${detail}`);
}

run("log-increment-style", async ({ page }) => {
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  await createSave(page, NAME);
  await waitIdle();

  // 「观察」走自由输入框（指令形态 → /action）：交战组换键时按钮面
  // 可能整组替换，输入框恒定存在——连发最稳。
  for (let i = 1; i <= ACTIONS; i++) {
    const respP = page.waitForResponse(
      (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
      { timeout: 8000 }
    );
    await page.fill(".input-row input", "观察");
    await page.press(".input-row input", "Enter");
    await respP.then((r) => r.finished().catch(() => {}));
    await waitIdle();
    const n = await page.locator(".log .log-entry").count();
    console.log(`    OBS${i}: .log-entry=${n}`);
  }
  // 等入场动画（<=240ms）落定再取 computedStyle——动画中 opacity<1
  // 会污染 (c) 的 opacity 通道，产生偶发假绿/假红。
  await page.waitForTimeout(500);

  // ── 单视口一轮完整取证：a) 结构族 b) 唯一定位 c) 样式差异
  //    d) 无横溢 + 条目间距。两个视口各跑同一口径。 ──
  const probe = () =>
    page.evaluate(() => {
      const log = document.querySelector(".log");
      if (!log) return { hasLog: false };
      const entries = [...log.querySelectorAll(".log-entry")];
      const direct = [...log.children].filter((el) => el.classList.contains("log-entry"));
      const flagged = entries.filter((el) => el.getAttribute("data-latest") === "1");
      const last = entries[entries.length - 1];
      const prev = entries[entries.length - 2];
      const cs = (el) => {
        const s = getComputedStyle(el);
        return {
          borderLeftWidth: s.borderLeftWidth,
          backgroundColor: s.backgroundColor,
          opacity: s.opacity,
        };
      };
      // 相邻条目几何间距（折叠外边距生效后两盒间净距）。
      let minGap = Infinity;
      for (let i = 1; i < entries.length; i++) {
        const g =
          entries[i].getBoundingClientRect().top - entries[i - 1].getBoundingClientRect().bottom;
        if (g < minGap) minGap = g;
      }
      return {
        hasLog: true,
        entryCount: entries.length,
        directCount: direct.length,
        allDiv: entries.every((el) => el.tagName === "DIV"),
        flaggedCount: flagged.length,
        lastIsFlagged: last ? last.getAttribute("data-latest") === "1" : false,
        lastStyle: last ? cs(last) : null,
        prevStyle: prev ? cs(prev) : null,
        scrollW: log.scrollWidth,
        clientW: log.clientWidth,
        minGap: entries.length >= 2 ? minGap : null,
      };
    });

  const checkViewport = async (w, h, tag) => {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200); // 版心 reflow 落定
    const m = await probe();

    assert(m.hasLog, `(a) ${tag}: .log 容器不存在（.stage-col 未挂 .log 类）`);
    assert(
      m.entryCount >= ACTIONS,
      `(a) ${tag}: .log-entry 仅 ${m.entryCount} 条（要求 >= ${ACTIONS}）`
    );
    assert(
      m.directCount === m.entryCount && m.allDiv,
      `(a) ${tag}: .log-entry 非同一选择器族——${m.entryCount} 条里只有 ` +
        `${m.directCount} 条是 .log 直接子节点或 tagName 非 DIV`
    );
    if (m.flaggedCount !== 1 || !m.lastIsFlagged) {
      report(
        "(b)",
        `${tag}: data-latest="1" 命中 ${m.flaggedCount} 个（要求恰好 1），` +
          `最末条带标=${m.lastIsFlagged}`
      );
    }
    assert(m.flaggedCount === 1, `(b) ${tag}: [data-latest="1"] 不是恰好 1 个（=${m.flaggedCount}）`);
    assert(m.lastIsFlagged, `(b) ${tag}: data-latest="1" 不在最末条 .log-entry 上`);
    const sDiff =
      m.lastStyle &&
      m.prevStyle &&
      (m.lastStyle.borderLeftWidth !== m.prevStyle.borderLeftWidth ||
        m.lastStyle.backgroundColor !== m.prevStyle.backgroundColor ||
        m.lastStyle.opacity !== m.prevStyle.opacity);
    if (!sDiff) {
      report(
        "(c)",
        `${tag}: 最新一条与上一条 computedStyle 完全一致 ` +
          `last=${JSON.stringify(m.lastStyle)} prev=${JSON.stringify(m.prevStyle)}`
      );
    }
    assert(sDiff, `(c) ${tag}: 最新一条与上一条无可见计算样式差异`);
    if (!(m.scrollW <= m.clientW)) {
      report("(d)", `${tag}: .log 横向溢出 scrollWidth=${m.scrollW} > clientWidth=${m.clientW}`);
    }
    assert(m.scrollW <= m.clientW, `(d) ${tag}: .log 横向溢出 ${m.scrollW} > ${m.clientW}`);
    if (!(m.minGap > 0)) {
      report("(d)", `${tag}: 条目间距 minGap=${m.minGap} <= 0（相邻条目盒间无净距）`);
    }
    assert(m.minGap > 0, `(d) ${tag}: 条目间距 ${m.minGap} <= 0`);
    console.log(
      `    [${tag}] entries=${m.entryCount} flagged=${m.flaggedCount} ` +
        `styleDiff last=${JSON.stringify(m.lastStyle)} prev=${JSON.stringify(m.prevStyle)} ` +
        `overflow=${m.scrollW}<=${m.clientW} minGap=${m.minGap.toFixed(1)}`
    );
  };

  await checkViewport(1440, 900, "1440x900");
  await checkViewport(390, 844, "390x844");

  console.log("[OK] log-increment-style: 条目独立成节点 / 唯一定位最新条 / 样式分层 / 双视口无横溢");
});
