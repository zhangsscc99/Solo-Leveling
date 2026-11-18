#!/usr/bin/env node
// attr-plus-disabled.mjs (F243): 「剩余属性点 0」时 +1 按钮必须是明确
// 禁用态，且 390 视口下不得贴属性面板右内边——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 DB
//   直落 free_points=0（新档默认即 0，显式写死口径）并清交战：
//     a) 1440 打开「属性」面板：5 颗 .stat-add 全部 disabled 或
//        aria-disabled=true，computed opacity ≤0.45，且 cursor 计算值
//        === "not-allowed"——禁用 signifier 不得只剩「变暗」；
//     b) 390×844 下每颗 .stat-add 右缘距 .stat-panel padding-box 右
//        内边 ≥8px（含 border+padding 折算），documentElement 无横溢；
//     c) 1440×900 下 documentElement 无横溢、.stat-panel 完整落在
//        视口内（不截断）；
//     d) 反向：DB 把 free_points 调回 3 → 重开面板至少一颗 +1 处于
//        enabled（防把按钮写死禁用洗绿）。
//
//   旧码红证：旧 .stat-add:disabled 只有 dashed + opacity:.35 +
//   cursor:default——(a) 的 cursor 断言红（default≠not-allowed）；
//   且 .stat-line 无右内边、+1 是行尾 flex 末项，按钮 right 与
//   .stat-panel padding-box 右内边重合 → (b) 边距断言红（gap 0<8）。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

// 前端由 server 以 client/dist 静态托管：dist 缺失时先补构建（与
// stat-row-fit.mjs 同口径兜底）。
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
    console.error("[E2E] attr-plus-disabled: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f243-"));
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
    console.error(`[E2E] attr-plus-disabled: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

run("attr-plus-disabled", async ({ page }) => {
  await createSave(page, `e2e-f243-${Date.now().toString(36)}`);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落 free_points 口径并清交战（inCombat 会连带禁用 +1，反向用例
  // 必须排除）。
  const setPoints = (pts) => {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE saves SET free_points = ? WHERE id = ?").run(pts, saveId);
      db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
    } finally {
      db.close();
    }
  };

  const openStats = async () => {
    await page.locator(".btn-group-sys .btn", { hasText: "属性" }).first().click();
    await page.waitForSelector(".sidebar.open");
    await page.waitForSelector(".stat-panel .stat-add");
  };

  // 面板 padding-box 右内边 = border-box.right - border - padding；
  // .stat-panel 本无边无内距，先折算再量，选择器口径不偷懒。
  const measure = () =>
    page.evaluate(() => {
      const panel = document.querySelector(".stat-panel");
      const cs = getComputedStyle(panel);
      const pr = panel.getBoundingClientRect();
      const innerRight =
        pr.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight);
      const de = document.documentElement;
      return {
        vw: window.innerWidth,
        docSW: de.scrollWidth,
        docCW: de.clientWidth,
        panel: { left: pr.left, right: pr.right, bottom: pr.bottom, innerRight },
        buttons: [...document.querySelectorAll(".stat-add")].map((b, i) => {
          const r = b.getBoundingClientRect();
          const bc = getComputedStyle(b);
          return {
            label: b.closest(".stat-line")?.querySelector(".stat-line-label")?.textContent || `#${i}`,
            disabled: b.disabled,
            ariaDisabled: b.getAttribute("aria-disabled"),
            opacity: parseFloat(bc.opacity),
            cursor: bc.cursor,
            w: r.width,
            right: r.right,
          };
        }),
      };
    });

  // ── free_points=0：禁用态 + 边距全量断言 ─────────────────────────
  setPoints(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await openStats();

  // (a)+(c) 1440：禁用 signifier、面板完整可见、无横溢。
  let m = await measure();
  assert(m.buttons.length === 5, `.stat-add 仅 ${m.buttons.length} 颗（<5，选择器失效？）`);
  for (const b of m.buttons) {
    assert(
      b.disabled === true || b.ariaDisabled === "true",
      `「${b.label}」+1 未禁用：disabled=${b.disabled} aria-disabled=${b.ariaDisabled}`
    );
    assert(b.opacity <= 0.45, `「${b.label}」+1 opacity=${b.opacity} > 0.45`);
    assert(
      b.cursor === "not-allowed",
      `「${b.label}」+1 cursor=${b.cursor}（≠not-allowed——禁用 signifier 不足，旧毛病）`
    );
  }
  assert(
    m.docSW <= m.docCW,
    `1440 横向溢出：scrollWidth=${m.docSW} > clientWidth=${m.docCW}`
  );
  assert(
    m.panel.left >= 0 && m.panel.right <= m.vw + 0.5 && m.panel.bottom > 0,
    `1440 面板越出视口：${JSON.stringify(m.panel)} vw=${m.vw}`
  );
  console.log(
    `    [1440] 5颗 +1 全禁用 opacity=${m.buttons[0].opacity} cursor=${m.buttons[0].cursor} ` +
      `docSW=${m.docSW}/${m.docCW} 面板 right=${m.panel.right.toFixed(1)}/vw=${m.vw}`
  );

  // (b) 390：每颗 +1 右缘距 .stat-panel padding-box 右内边 ≥8px，无横溢。
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForSelector(".stat-panel .stat-add");
  m = await measure();
  assert(m.buttons.length === 5, `390: .stat-add 仅 ${m.buttons.length} 颗`);
  for (const b of m.buttons) {
    const gap = m.panel.innerRight - b.right;
    assert(
      gap >= 8 - 0.01,
      `390: 「${b.label}」+1 右缘距面板内边 ${gap.toFixed(1)}px < 8px ` +
        `（btn.right=${b.right.toFixed(1)} panelInnerRight=${m.panel.innerRight.toFixed(1)}）`
    );
    assert(b.w >= 43, `390: 「${b.label}」+1 触达宽 ${b.w.toFixed(1)}px < 44px（缩按钮凑边距？）`);
  }
  assert(
    m.docSW <= m.docCW,
    `390 横向溢出：scrollWidth=${m.docSW} > clientWidth=${m.docCW}`
  );
  const worst = Math.min(...m.buttons.map((b) => m.panel.innerRight - b.right));
  console.log(
    `    [390] +1 右缘最小内收 ${worst.toFixed(1)}px（≥8）按钮宽 ${m.buttons[0].w.toFixed(1)} ` +
      `docSW=${m.docSW}/${m.docCW}`
  );

  // ── (d) 反向：free_points=3 重开面板，至少一颗 +1 可点 ───────────
  await page.setViewportSize({ width: 1440, height: 900 });
  setPoints(3);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await openStats();
  m = await measure();
  const enabled = m.buttons.filter((b) => b.disabled === false && b.ariaDisabled !== "true");
  assert(
    enabled.length >= 1,
    `free_points=3 时没有任何可点 +1（5颗仍全禁用——按钮被写死禁用洗绿）`
  );
  console.log(`    [reverse] free_points=3 → enabled ${enabled.length}/5`);
});
