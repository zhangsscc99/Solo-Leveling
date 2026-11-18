#!/usr/bin/env node
// stat-row-fit.mjs (F229): 顶栏数值行不得贴视口右缘、移动端字号下限——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 gate
//   注册进主界面；390×844 与 1440×900 两视口各断言：
//     a) .status-nums .stat 数 >= 3（防选择器失效空断言假绿）；
//     b) 每个 .stat 的 getBoundingClientRect().right <= innerWidth - 8
//        ——含金币/攻/防全部单元格，XP 的 F214 先行 order 不改判；
//     c) label 计算字号 >= 11px、数值 <b> 计算字号 >= 12px（无 <b>
//        的单元格按同一元素承担两职，断言 >= 12px）；
//     d) document.documentElement.scrollWidth <= clientWidth + 1。
//
//   旧码红证（修复前实测，390×844）：.status-nums scrollWidth 460 对
//   槽宽 366 横滚溢出——「防9」right=418、「金币0」right=472 整格落
//   出视口，「攻20」right=377 压进 28px 右缘渐隐被 vision 读成「攻2」。
//   撕掉修复（删掉 ≤880 的 padding-right:28px 与 ≤640 字号/间距/
//   xp-bar 块后 `npm --prefix client run build`）：(b) 在 390 视口对
//   「防」「金币」两项红（right 均 > innerWidth-8=382）；(c) 若要单独
//   撕红，把 ≤640 的 .stat font-size 改到 11px 以下即可。1440 档新旧
//   均绿（右缘本就有 help-toggle+padding 兜底），它是 (b)/(d) 的桌面
//   回归护栏。
//   实测（feat/F229）：撕修复红 `390x844: .stat「防9」 right=418.0 >
//   382`；带修复绿——390: stats=9 最右「金币0」right=350.0≤382
//   label>=11 num>=12 docSW=390；1440: 最右「XP0」right=1352.0≤1432
//   label/num>=13 docSW=1440。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管：dist 缺失时先补构建（ci-deploy /
// verify 管线通常已构建，这里只是兜底，避免断言打到不存在的页面）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  const buildEnv = { ...process.env };
  delete buildEnv.NODE_CHANNEL_FD;
  delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
  const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: buildEnv,
  });
  if (b.status !== 0) {
    console.error("[E2E] stat-row-fit: client/dist 缺失且 npm --prefix client run build 失败");
    process.exit(1);
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f229-"));
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
    console.error(`[E2E] stat-row-fit: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

async function measure(page) {
  return page.evaluate(() => {
    const stats = [...document.querySelectorAll(".status-nums .stat")];
    const r = stats.map((el, i) => {
      const b = el.getBoundingClientRect();
      const num = el.querySelector("b");
      return {
        i,
        cls: el.className,
        text: (el.textContent || "").trim().slice(0, 16),
        left: b.left,
        right: b.right,
        width: b.width,
        labelFs: parseFloat(getComputedStyle(el).fontSize),
        numFs: num ? parseFloat(getComputedStyle(num).fontSize) : null,
      };
    });
    const de = document.documentElement;
    return {
      vw: window.innerWidth,
      docSW: de.scrollWidth,
      docCW: de.clientWidth,
      stats: r,
    };
  });
}

function checkViewport(m, tag) {
  // (a) 选择器健康：拿不到 .stat 时后面全是空断言假绿。
  assert(m.stats.length >= 3, `${tag}: .status-nums .stat 仅 ${m.stats.length} 个（<3，选择器失效？）`);

  for (const s of m.stats) {
    // (b) 每项右缘离视口右边 >= 8px——「金币」「防」横滚落出、
    //     「攻」压渐隐区都在此红。
    assert(
      s.right <= m.vw - 8,
      `${tag}: .stat「${s.text}」(${s.cls}) 右缘贴边/越界 right=${s.right.toFixed(1)} > vw-8=${m.vw - 8}`
    );
    // (c) 字号下限：label >= 11px、数值 >= 12px。
    assert(
      s.labelFs >= 11,
      `${tag}: .stat「${s.text}」(${s.cls}) label 字号 ${s.labelFs}px < 11px`
    );
    if (s.numFs !== null) {
      assert(
        s.numFs >= 12,
        `${tag}: .stat「${s.text}」(${s.cls}) 数值字号 ${s.numFs}px < 12px`
      );
    } else {
      assert(
        s.labelFs >= 12,
        `${tag}: .stat「${s.text}」(${s.cls}) 无 <b> 数值节点，单元素字号 ${s.labelFs}px < 12px`
      );
    }
  }

  // (d) 文档级无横溢（数值行/顶栏把页面撑宽也算坏）。
  assert(
    m.docSW <= m.docCW + 1,
    `${tag}: documentElement 横向溢出 scrollWidth=${m.docSW} > clientWidth=${m.docCW}+1`
  );

  const last = m.stats.reduce((a, b) => (b.right > a.right ? b : a));
  const minLabel = Math.min(...m.stats.map((s) => s.labelFs));
  const minNum = Math.min(...m.stats.map((s) => (s.numFs === null ? s.labelFs : s.numFs)));
  console.log(
    `    [${tag}] stats=${m.stats.length} 最右项「${last.text}」right=${last.right.toFixed(1)} ` +
      `(限 ${m.vw - 8}) label>=${minLabel}px num>=${minNum}px docSW=${m.docSW}/${m.docCW}`
  );
}

run("stat-row-fit", async ({ page }) => {
  await createSave(page, `e2e-f229-${Date.now().toString(36)}`);
  await page.waitForSelector(".status-nums .stat");

  for (const [w, h] of [
    [390, 844],
    [1440, 900],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForSelector(".status-nums .stat");
    const m = await measure(page);
    checkViewport(m, `${w}x${h}`);
  }
});
