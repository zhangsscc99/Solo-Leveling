#!/usr/bin/env node
// rest-feedback.mjs (F236): 「休息」三分支禁用/可用现场取证——
//
//   48 轮走查结论「休息键不是 disabled / 点了无任何反馈」需要一条
//   E2E 锁死真实行为。自起隔离实例（空闲端口 + 临时 DB_PATH，AI key
//   置空），浏览器走 lib.mjs launch()，新档由 createSave 落地：
//     A) 新档满状态（hp/mp 俱满）：「休息」disabled === true 且
//        aria-disabled === "true"；.rest-hint 存在、isVisible、文本
//        匹配 /体力|魔力/（服务端 save.rest.reason 原文，反馈证据
//        不取 title/hover）；element.click()（DOM 直调，禁用键不收
//        点击事件）后 .stage-col 子节点数与文本零增量；
//     B) DB 直改 hp=max_hp/2、rest_used=0（encounter_cd=9 压住休憩
//        掷敌，口径与 encounterBlockedByCooldown 一致，保证确定性）：
//        「休息」disabled === false（负向锁——写死禁用在这里红）、
//        .rest-hint count()===0；Playwright 真点击，每次 .stage-col
//        有日志增量。回血口径 +ceil(max_hp*0.35)/次（rest-narration.mjs
//        锁定契约），hp=50 时两次触顶——循环点到 GET /saves/:id 的
//        hp === max_hp（真回血入账，不是只回包），上限=本章配额 3；
//     C) DB 直改 hp=max_hp/2、rest_used=3：「休息」disabled === true
//        且 .rest-hint 文本匹配 /次数|用完/（「本章休息次数已用完」）。
//
//   任一分支出现「键可按/该禁却没禁且整页无任何可见反馈（无文案、
//   无日志增量）」→ stderr 打 DEFECT: <分支> <现象> 并让断言 FAIL；
//   本脚本只取证，不改产品代码。
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
      `[E2E] rest-feedback: node ABI=${process.versions.modules} ≠ 137（better-sqlite3 需要 node v24），` +
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
    console.warn(`[E2E] rest-feedback: client/dist 软链失败（继续）: ${e.message}`);
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f236-"));
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
    console.error(`[E2E] rest-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

// 「休息真回血了吗」的服务端口径——独立 fetchSave，不经界面读数。
async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

// DB 直改口径与 deny-feedback/attr-plus-disabled 相同：同一临时
// DB_PATH 上开短连接写（WAL 多连接安全），写完即关。
function dbWrite(fn) {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

// 「无任何可见反馈」是 DEFECT 口径：stderr 留痕后照常 FAIL，不改产品码。
function defect(branch, desc) {
  console.error(`DEFECT: ${branch} ${desc}`);
  throw new Error(`[REST-${branch}] ${desc}`);
}

run("rest-feedback", async ({ page }) => {
  const REST_BTN = page.locator("footer.actions .btn", { hasText: "休息" }).first();
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const reload = async () => {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await waitIdle();
  };
  const shot = (tag) =>
    page.screenshot({ path: `/root/logs/e2e-rest-feedback-${tag}-${Date.now()}.png`, fullPage: true });

  const restBtnState = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("footer.actions .btn")].find((x) =>
        (x.textContent || "").includes("休息")
      );
      if (!b) return null;
      return {
        disabled: b.disabled,
        ariaDisabled: b.getAttribute("aria-disabled"),
        text: (b.textContent || "").trim(),
      };
    });
  const hintState = async () => {
    const loc = page.locator(".rest-hint");
    const count = await loc.count();
    if (!count) return { count: 0, visible: false, text: "" };
    return { count, visible: await loc.first().isVisible(), text: (await loc.first().innerText()).trim() };
  };
  const stageState = () =>
    page.evaluate(() => {
      const c = document.querySelector(".stage-col");
      return { kids: c ? c.children.length : -1, text: c ? c.textContent || "" : "" };
    });
  // DOM 直调 click()：禁用键不收点击事件，是「禁用键零副作用」的探针；
  // enabled 时等价一次真实点击（走 React onClick → dispatch）。
  const domClickRest = () =>
    page.evaluate(() => {
      const b = [...document.querySelectorAll("footer.actions .btn")].find((x) =>
        (x.textContent || "").includes("休息")
      );
      if (b) b.click();
      return Boolean(b);
    });

  // ── A 新档满状态：禁用 + 常驻 .rest-hint，DOM click 零增量 ────────
  const name = `rf${Date.now().toString(36)}`; // ≤20 字，避 409 重名
  assert(name.length <= 20, `save name 超长：${name}`);
  await createSave(page, name);
  await waitIdle();
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "save_id missing in localStorage");

  let st = await restBtnState();
  let hint = await hintState();
  assert(st, "「休息」按钮不在 footer.actions（选择器失效？）");

  const s0 = await stageState();
  await domClickRest();
  await page.waitForTimeout(400);
  const s1 = await stageState();
  const grew = s1.kids > s0.kids || s1.text !== s0.text;
  if (!(st.disabled === true && st.ariaDisabled === "true") && !(hint.count && hint.visible) && !grew) {
    defect(
      "A",
      `满状态「休息」disabled=${st.disabled} aria-disabled=${st.ariaDisabled}、` +
        `.rest-hint count=${hint.count} visible=${hint.visible}，DOM click 后 .stage-col ` +
        `${s0.kids}->${s1.kids} 零增量——键可按且无任何可见反馈`
    );
  }
  assert(st.disabled === true, `A: 满状态「休息」未禁用 disabled=${st.disabled} aria=${st.ariaDisabled}`);
  assert(st.ariaDisabled === "true", `A: aria-disabled=${st.ariaDisabled}（≠"true"）`);
  assert(hint.count >= 1 && hint.visible, `A: .rest-hint 不存在或不可见 count=${hint.count}`);
  assert(/体力|魔力/.test(hint.text), `A: .rest-hint 不含体力/魔力：「${hint.text}」`);
  assert(
    !grew,
    `A: 禁用键 DOM click 后 .stage-col 变了：kids ${s0.kids}->${s1.kids}` +
      `${s1.text !== s0.text ? "，文本亦有增量" : ""}`
  );
  await shot("A");
  console.log(
    `[REST-A] disabled=true aria-disabled=true hint=「${hint.text}」 ` +
      `stage-col ${s0.kids}->${s1.kids}（禁用键零增量）`
  );

  // ── B hp<max 可休息：enabled 负向锁 + 真点击真回血 ────────────────
  const sv0 = await fetchSave(saveId);
  const hurt = Math.max(1, Math.floor(Number(sv0.max_hp) / 2));
  dbWrite((db) => {
    db.prepare("UPDATE saves SET hp = ?, rest_used = 0, encounter_cd = 9 WHERE id = ?").run(hurt, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await reload();

  st = await restBtnState();
  hint = await hintState();
  assert(st, "B: 「休息」按钮不在 footer.actions");
  assert(
    st.disabled === false,
    `B: hp=${hurt}/${sv0.max_hp} 时「休息」仍禁用 disabled=${st.disabled} aria=${st.ariaDisabled}` +
      `（写死禁用旧毛病——负向锁）`
  );
  assert(
    hint.count === 0,
    `B: 可休息态 .rest-hint 仍渲染 count=${hint.count}「${hint.text}」`
  );

  const b0 = await stageState();
  let prevKids = b0.kids;
  let lastSave = null;
  let clicks = 0;
  // 每击 +ceil(max_hp*0.35)（clamp 到上限）：hp=50 → 85 → 100，两次
  // 触顶；循环上限取本章配额 REST_LIMIT=3，回血缩水会被终值断言拦下。
  for (let i = 0; i < 3; i++) {
    const respP = page.waitForResponse(
      (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
      { timeout: 8000 }
    );
    await REST_BTN.click();
    await respP.then((r) => r.finished().catch(() => {}));
    await waitIdle();
    clicks++;
    const now = await stageState();
    lastSave = await fetchSave(saveId);
    if (now.kids === prevKids && lastSave.hp === hurt && clicks === 1) {
      defect(
        "B",
        `可休息态真点击后 .stage-col ${prevKids}->${now.kids} 无日志增量、` +
          `存档 hp 仍 ${lastSave.hp}——键可按但无任何可见反馈`
      );
    }
    assert(
      now.kids > prevKids,
      `B: 第${clicks}次真点击后 .stage-col 无日志增量 ${prevKids}->${now.kids}`
    );
    prevKids = now.kids;
    if (lastSave.hp >= lastSave.max_hp) break;
  }
  assert(lastSave && lastSave.hp > hurt, `B: 休息未真实回血 ${hurt}->${lastSave && lastSave.hp}`);
  assert(
    lastSave.hp === lastSave.max_hp,
    `B: ${clicks} 次休息后存档 hp=${lastSave.hp}/${lastSave.max_hp} 未回满（回血入账异常）`
  );
  await shot("B");
  console.log(
    `[REST-B] disabled=false hint=无 stage-col ${b0.kids}->${prevKids} ` +
      `hp ${hurt}->${lastSave.hp}/${lastSave.max_hp} rest_used=${lastSave.rest_used}（${clicks}次真点击）`
  );

  // ── C 配额用尽：禁用 + .rest-hint 「次数…用完」 ───────────────────
  dbWrite((db) => {
    db.prepare("UPDATE saves SET hp = ?, rest_used = 3 WHERE id = ?").run(hurt, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await reload();

  st = await restBtnState();
  hint = await hintState();
  assert(st, "C: 「休息」按钮不在 footer.actions");
  if (!(st.disabled === true) && !(hint.count && hint.visible)) {
    defect(
      "C",
      `rest_used=3 配额用尽后 disabled=${st.disabled} aria=${st.ariaDisabled}、` +
        `.rest-hint count=${hint.count} visible=${hint.visible}——键可按且无任何可见反馈`
    );
  }
  assert(st.disabled === true, `C: rest_used=3 时「休息」未禁用 disabled=${st.disabled} aria=${st.ariaDisabled}`);
  assert(hint.count >= 1 && hint.visible, `C: .rest-hint 不存在或不可见 count=${hint.count}`);
  assert(/次数|用完/.test(hint.text), `C: .rest-hint 不含次数/用完：「${hint.text}」`);
  await shot("C");
  console.log(`[REST-C] disabled=true aria-disabled=${st.ariaDisabled} hint=「${hint.text}」`);
});
