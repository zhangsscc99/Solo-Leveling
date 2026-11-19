#!/usr/bin/env node
// mobile.mjs: 390x844 viewport -> bottom action bar visible, drawer button
// opens the sidebar as a drawer.
// F295 起默认自起隔离实例（空闲端口 + 临时 DB_PATH，与 attr-plus-disabled
// 同口径）——默认 BASE_URL 指向已部署实例，断言的是 worktree 新码会假红；
// 显式传 E2E_BASE_URL 时仍按外部地址跑（跳过自举）。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

if (!process.env.E2E_BASE_URL) {
  // 前端由 server 以 client/dist 静态托管：dist 缺失时先补构建。
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
      console.error("[E2E] mobile: client/dist 缺失且 npm --prefix client run build 失败");
      process.exit(1);
    }
  }

  const port = await new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, "127.0.0.1", () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on("error", reject);
  });
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f295-"));
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

  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/game/api/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[E2E] mobile: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
  // E2E_BASE_URL 须在 lib.mjs 求值前落定。
  process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
}

const { assert, createSave, run } = await import("./lib.mjs");

const NAME = `e2e-mob-${Date.now().toString(36)}`;
const VW = 390;
const VH = 844;

run(
  "mobile",
  async ({ page }) => {
    await createSave(page, NAME);

    // Bottom action bar pinned to the viewport bottom.
    const bar = page.locator(".actions");
    assert(await bar.isVisible(), "bottom action bar visible");
    const box = await bar.boundingBox();
    assert(box && box.y + box.height >= VH - 5, `action bar pinned to bottom (bottom=${box && box.y + box.height})`);

    // Action buttons reachable inside the bottom bar.
    const btn = page.locator(".actions .btn", { hasText: "探索前进" });
    assert((await btn.count()) >= 1, "探索前进 reachable in bottom bar");

    // F295：触屏下不得出现键盘提示——正文无 ↵ / 独立成词 Enter，
    // 键帽（.key-badge/.hotkey）全部不可见，发送键用触摸语义文案。
    const text = await page.locator("body").innerText();
    assert(!text.includes("↵"), "no ↵ Enter hint on touch");
    assert(!/\bEnter\b/.test(text), "no standalone Enter wording on touch");

    const badges = page.locator(".key-badge, .hotkey");
    const n = await badges.count();
    for (let i = 0; i < n; i++) {
      const el = badges.nth(i);
      const shown = await el.isVisible();
      assert(!shown, `key badge #${i} hidden on touch`);
    }

    const send = page.locator(".input-send");
    assert((await send.count()) >= 1, "send button present");
    const sbox2 = await send.boundingBox();
    assert(sbox2 && sbox2.height >= 44, `send >=44px tall (${sbox2 && sbox2.height})`);
    const sendText = (await send.innerText()).trim();
    assert(!sendText.includes("↵") && !/\bEnter\b/.test(sendText), `send uses touch wording (got "${sendText}")`);

    // Drawer toggle exists on mobile and meets 44px touch target.
    const toggle = page.locator(".drawer-toggle");
    assert(await toggle.isVisible(), "drawer toggle visible on mobile");
    const tbox = await toggle.boundingBox();
    assert(tbox && tbox.height >= 44, `drawer toggle >=44px tall (${tbox && tbox.height})`);

    await toggle.click();
    await page.waitForFunction(
      (vw) => {
        const el = document.querySelector(".sidebar.open");
        if (!el) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.x < vw;
      },
      VW
    );
    const sbox = await page.locator(".sidebar.open").boundingBox();
    assert(sbox && sbox.width >= 200, `sidebar drawer slides in (w=${sbox && sbox.width})`);
  },
  { viewport: { width: VW, height: VH }, context: { hasTouch: true, isMobile: true } }
);
