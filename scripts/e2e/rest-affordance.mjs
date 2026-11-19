#!/usr/bin/env node
// rest-affordance.mjs (F253): 满状态「休息」死选项占位 → 次级文字态——
//
//   骨架照抄 rest-feedback.mjs：自起隔离实例（空闲端口 + 临时
//   DB_PATH，AI key 置空），浏览器走 lib.mjs launch()，新档由
//   createSave 落地。断言「不可用即压缩、可用即复原」：
//     A) 新档满状态（hp/mp 俱满，save.rest.available === false）：
//        footer.actions 内「休息」带 .rest-dim 降权样式（透明底 +
//        dashed 虚线边 + 低对比文字）、disabled === true（禁用语义不动）、
//        data-rest-state === "blocked"；F301 起触控尺寸回归——两态同
//        ≥44px，降权只改质感不改尺寸；
//     B) DB 直改 hp=max_hp/2、rest_used=0（encounter_cd=9 压掷敌，
//        口径同 rest-feedback）后 reload：同一按钮
//        offsetHeight >= 44（完整按钮体积）、disabled === false、
//        data-rest-state === "available"、.rest-dim 摘除；
//     C) 两态降权样式互斥：blocked 有 rest-dim + dashed + 透明底，
//        available 三样全无（降权语义不随 F301 尺寸回归回退）；
//     D) 两态 footer.actions 无横向溢出（scrollWidth <= clientWidth+1）
//        且按钮内文字单行（scrollHeight <= clientHeight * 1.2）。
//   旧码（无 rest-dim / 无 data-rest-state，按钮恒满色）上首跑即 FAIL。
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

// better-sqlite3 原生模块锁 ABI 137（node v24）：外层 node 版本不符时
// 用 v24.5.0 重 exec 本脚本一次；该路径缺失则明示退出。
if (process.versions.modules !== "137") {
  const node24 = "/root/.nvm/versions/node/v24.5.0/bin/node";
  if (!fs.existsSync(node24)) {
    console.error(
      `[E2E] rest-affordance: node ABI=${process.versions.modules} ≠ 137（better-sqlite3 需要 node v24），` +
        `且 ${node24} 不存在`
    );
    process.exit(1);
  }
  const r = spawnSync(node24, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: "inherit",
    env: process.env,
  });
  process.exit(r.status === null ? 1 : r.status);
}

// worktree 无 client/dist 时软链主仓构建产物（已存在跳过；失败仅告警
// 继续——server 会以 404 暴露缺 dist，健康检查照常）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  try {
    fs.symlinkSync("/www/Solo-Leveling/client/dist", path.join(ROOT, "client", "dist"), "dir");
  } catch (e) {
    console.warn(`[E2E] rest-affordance: client/dist 软链失败（继续）: ${e.message}`);
  }
}

fs.mkdirSync("/root/logs", { recursive: true });

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f253-"));
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
    console.error(`[E2E] rest-affordance: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

// DB 直改口径与 rest-feedback 相同：同一临时 DB_PATH 上开短连接写
// （WAL 多连接安全），写完即关。
function dbWrite(fn) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

// .btn 标准态 min-height 在 ≤880px 档为 44px（桌面 40px），B 分支
// 「恢复完整按钮体积」断言 offsetHeight >= 44 需窄视口成立；窄屏
// 同时是 footer.actions 横向溢出最紧的口径（D 分支）。
run("rest-affordance", async ({ page }) => {
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await waitIdle();
  };
  const shot = (tag) =>
    page.screenshot({ path: `/root/logs/e2e-rest-affordance-${tag}-${Date.now()}.png`, fullPage: true });

  // 休息键现场取证：几何 + 禁用 + data-rest-state + footer 溢出 + 行数。
  const restBtnState = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("footer.actions .btn")].find((x) =>
        (x.textContent || "").includes("休息")
      );
      if (!b) return null;
      const footer = b.closest("footer.actions");
      const cs = getComputedStyle(b);
      return {
        height: b.offsetHeight,
        width: b.offsetWidth,
        disabled: b.disabled,
        dataRestState: b.getAttribute("data-rest-state"),
        dimCls: b.classList.contains("rest-dim"),
        borderStyle: cs.borderStyle,
        bg: cs.backgroundColor,
        footerScrollW: footer ? footer.scrollWidth : -1,
        footerClientW: footer ? footer.clientWidth : -1,
        scrollH: b.scrollHeight,
        clientH: b.clientHeight,
      };
    });
  const checkFit = (tag, st) => {
    assert(
      st.footerScrollW <= st.footerClientW + 1,
      `${tag}: footer.actions 横向溢出 scrollWidth=${st.footerScrollW} clientWidth=${st.footerClientW}`
    );
    assert(
      st.scrollH <= st.clientH * 1.2,
      `${tag}: 「休息」按钮内文字折行 scrollHeight=${st.scrollH} clientHeight=${st.clientH}`
    );
  };

  // ── A 新档满状态：文字态（<=20px）+ disabled + blocked ──────────
  const name = `ra${Date.now().toString(36)}`; // ≤20 字，避 409 重名
  assert(name.length <= 20, `save name 超长：${name}`);
  await createSave(page, name);
  await waitIdle();
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  const stA = await restBtnState();
  assert(stA, "A: 「休息」按钮不在 footer.actions（选择器失效？）");
  // F301：降权改由质感表达（rest-dim 透明底+虚线边），尺寸回归
  // ≥44px 触控——不再断言 ≤20px 文字态，改锁降权样式三件套。
  assert(
    stA.height >= 44 && stA.width >= 44,
    `A: 满状态「休息」触控尺寸 ${stA.width}x${stA.height}（须 ≥44x44，F301）` +
      ` disabled=${stA.disabled} data-rest-state=${stA.dataRestState}`
  );
  assert(
    stA.dimCls && /dashed/.test(stA.borderStyle) && /,\s*0\)$/.test(stA.bg),
    `A: 满状态「休息」缺降权样式 dimCls=${stA.dimCls} borderStyle=${stA.borderStyle} bg=${stA.bg}`
  );
  assert(
    stA.disabled === true,
    `A: 满状态「休息」未禁用 disabled=${stA.disabled} height=${stA.height} data-rest-state=${stA.dataRestState}`
  );
  assert(
    stA.dataRestState === "blocked",
    `A: data-rest-state=${stA.dataRestState}（≠"blocked"）height=${stA.height} disabled=${stA.disabled}`
  );
  checkFit("A", stA);
  await shot("A");
  console.log(
    `[AFFORD-A] size=${stA.width}x${stA.height} disabled=${stA.disabled} ` +
      `data-rest-state=${stA.dataRestState} dim=${stA.dimCls} border=${stA.borderStyle} ` +
      `footer ${stA.footerScrollW}/${stA.footerClientW}`
  );

  // ── B hp<max 可休息：恢复完整按钮（>=44px）+ enabled + available ──
  const sv0 = await fetchSave(saveId);
  const hurt = Math.max(1, Math.floor(Number(sv0.max_hp) / 2));
  dbWrite((db) => {
    db.prepare("UPDATE saves SET hp = ?, rest_used = 0, encounter_cd = 9 WHERE id = ?").run(hurt, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await reload();

  const stB = await restBtnState();
  assert(stB, "B: 「休息」按钮不在 footer.actions");
  assert(
    stB.height >= 44,
    `B: 可休息态「休息」未恢复按钮体积 offsetHeight=${stB.height}（<44）` +
      ` disabled=${stB.disabled} data-rest-state=${stB.dataRestState}`
  );
  assert(
    stB.disabled === false,
    `B: hp=${hurt}/${sv0.max_hp} 时「休息」仍禁用 disabled=${stB.disabled} height=${stB.height}`
  );
  assert(
    stB.dataRestState === "available",
    `B: data-rest-state=${stB.dataRestState}（≠"available"）height=${stB.height} disabled=${stB.disabled}`
  );
  assert(
    !stB.dimCls,
    `B: 可休息态仍挂 .rest-dim 降权类 height=${stB.height}`
  );
  checkFit("B", stB);
  await shot("B");
  console.log(
    `[AFFORD-B] height=${stB.height} disabled=${stB.disabled} data-rest-state=${stB.dataRestState} ` +
      `footer ${stB.footerScrollW}/${stB.footerClientW}`
  );

  // ── C 两态降权样式互斥（F301：尺寸不再区分，改锁质感差异）────────
  assert(
    stA.dimCls && !stB.dimCls,
    `C: 降权态互斥破 dimCls blocked=${stA.dimCls} available=${stB.dimCls}`
  );
  assert(
    /dashed/.test(stA.borderStyle) && !/dashed/.test(stB.borderStyle),
    `C: 虚线边互斥破 borderStyle blocked=${stA.borderStyle} available=${stB.borderStyle}`
  );
  console.log(
    `[AFFORD-C] blocked ${stA.width}x${stA.height} dim/dashed vs ` +
      `available ${stB.width}x${stB.height} solid — 降权样式互斥成立`
  );
}, { viewport: { width: 390, height: 844 } });
