#!/usr/bin/env node
// F217 新档首屏日志定位契约：
//
//   a) 全新存档（日志中只有开场条目、没有任何玩家输入行）首次进入时，
//      `.stage-col` 必须停在正文开头：首个子元素的 top 相对容器视口
//      >= 0——开场第一段（E 级猎人 / 母亲的药费）落在首屏内。旧码无条件
//      scrollTo(bottom)，实测首元素 top≈-764（390×844）/ -315（桌面），
//      第一屏读到的是中段「李珠熙朝你点头 / 石门在身后合拢」。
//      （或存在「从头读」锚点且点击后首元素可见——本实现直接停在开头。）
//   b) 同一存档追加 3 次动作（调 /action）后 reload()：有历史日志的档
//      保持滚到底部——最后一个日志元素可见（其 bottom <= 容器底 + 2）。
//
//   隔离实例：随机端口 + 临时 DB，spawn server/index.js 自起自停；
//   服务端静态托管 client/dist——dist 缺失时先跑 `npm --prefix client
//   run build` 再起。旧码红证：用例 a 首元素 top≈-764 必 FAIL。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME = `f217-${Date.now().toString(36)}`;

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

// dist 是服务端唯一静态源——没有就先构建（与 ci-deploy 同口径）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (b.status !== 0) {
    console.error("[ASSERT] FAIL step=build client/dist 缺失且构建失败");
    process.exit(1);
  }
}

const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f217-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: path.join(tmpDir, "game.db"),
};
delete env.NODE_CHANNEL_FD;
delete env.NODE_CHANNEL_SERIALIZATION_MODE;
// 隔离实例不吃调度 shell 泄漏的基址/库址——服务端只认本次 PORT/DB_PATH。
delete env.E2E_BASE_URL;
delete env.API_BASE;
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  cwd: ROOT,
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let childLog = "";
child.stdout.on("data", (d) => (childLog += d));
child.stderr.on("data", (d) => (childLog += d));
let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  process.exit(code);
}
process.on("SIGINT", () => cleanup(2));
process.on("SIGTERM", () => cleanup(2));
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {}
});

const BASE = `http://127.0.0.1:${gamePort}/game`;
const API = `${BASE}/api`;

// 等隔离实例就绪（最多 ~30s）。
{
  const t0 = Date.now();
  let up = false;
  while (Date.now() - t0 < 30000) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!up) {
    console.error(`[ASSERT] FAIL step=boot 隔离实例未就绪\n${childLog}`);
    cleanup(1);
  }
}

// lib.mjs 在模块加载时固化 BASE_URL——先设环境再动态 import。
process.env.E2E_BASE_URL = BASE;
const { run, createSave, assert } = await import("../e2e/lib.mjs");

// 首个 .stage-col 子元素 top 相对容器视口的偏移（>0 表示首段在首屏内，
// <0 表示开场正文被沉底动作推到视口上方）。1px 亚像素容差。
const firstTopProbe = `(() => {
  const col = document.querySelector(".stage-col");
  const first = col && col.firstElementChild;
  if (!col || !first) return null;
  return {
    relTop: first.getBoundingClientRect().top - col.getBoundingClientRect().top,
    scrollTop: col.scrollTop,
    children: col.children.length,
  };
})()`;

const lastBottomProbe = `(() => {
  const col = document.querySelector(".stage-col");
  const last = col && col.lastElementChild;
  if (!col || !last) return null;
  const colR = col.getBoundingClientRect();
  const lastR = last.getBoundingClientRect();
  return {
    lastBottomDelta: lastR.bottom - colR.bottom,
    lastVisible: lastR.bottom <= colR.bottom + 2 && lastR.top < colR.bottom,
    scrollTop: col.scrollTop,
    children: col.children.length,
  };
})()`;

run(
  "first-entry-scroll",
  async ({ page }) => {
    // ── a) 全新存档首屏：停在正文开头 ──────────────────────────
    await createSave(page, NAME);
    await page.waitForSelector(".stage-col > *");
    // 等 settle（首屏一次性动效/字体落地不改变 scrollTop=0 结论，
    // 但旧码的沉底动作需要先完成才能稳定取样）。
    await page.waitForTimeout(400);
    const m0 = await page.evaluate(firstTopProbe);
    assert(m0 && m0.children >= 1, ".stage-col 无子元素");
    console.log(
      `[ASSERT] fresh 390x844: first.relTop=${m0.relTop.toFixed(1)} ` +
        `scrollTop=${m0.scrollTop.toFixed(1)} children=${m0.children}`
    );
    // 「从头读」锚点兜底口径：若存在则点击后再量。
    const anchor = page.locator(".stage-col [data-read-from-start], .stage-col .read-from-start");
    if (m0.relTop < -1 && (await anchor.count()) > 0) {
      await anchor.first().click();
      await page.waitForTimeout(200);
      const m1 = await page.evaluate(firstTopProbe);
      assert(
        m1 && m1.relTop >= -1,
        `点击「从头读」后首元素 relTop=${m1 ? m1.relTop.toFixed(1) : "null"} 仍 < 0`
      );
    } else {
      assert(
        m0.relTop >= -1,
        `全新存档首屏未停在正文开头：首元素 relTop=${m0.relTop.toFixed(1)} ` +
          `scrollTop=${m0.scrollTop.toFixed(1)}（旧码实测 ≈-764）`
      );
    }

    // ── b) 同档追加 3 次动作 → reload → 仍滚到底 ──────────────
    const saveId = await page.evaluate(() =>
      Number(localStorage.getItem("solo_leveling_save_id"))
    );
    assert(saveId > 0, "localStorage 无 save_id");
    for (let i = 0; i < 3; i++) {
      const r = await page.evaluate(async ({ id, api }) => {
        const res = await fetch(`${api}/action`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ save_id: id, input: "环顾四周" }),
        });
        return { ok: res.ok, status: res.status };
      }, { id: saveId, api: API });
      assert(r.ok, `第 ${i + 1} 次 /action 失败 status=${r.status}`);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".stage-col > *");
    await page.waitForTimeout(400);
    const m2 = await page.evaluate(lastBottomProbe);
    assert(m2 && m2.children >= 1, "reload 后 .stage-col 无子元素");
    console.log(
      `[ASSERT] acted+reload: last.bottomDelta=${m2.lastBottomDelta.toFixed(1)} ` +
        `scrollTop=${m2.scrollTop.toFixed(1)} children=${m2.children}`
    );
    assert(
      m2.lastVisible && m2.lastBottomDelta <= 2,
      `追加动作后刷新未滚到底：last.bottomDelta=${m2.lastBottomDelta.toFixed(1)} ` +
        `scrollTop=${m2.scrollTop.toFixed(1)}`
    );
  },
  { viewport: { width: 390, height: 844 } }
);
