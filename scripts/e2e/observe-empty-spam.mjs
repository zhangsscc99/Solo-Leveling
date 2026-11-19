#!/usr/bin/env node
// observe-empty-spam.mjs (F314): 免费观察次数用尽后「环顾四周」必须是
// 显性不可用键——连点/热键一律零日志增长——
//
//   第 108 轮真实玩家走查：ch1_law（must_choose）里把免费观察次数用
//   尽后，「环顾四周」仍可点击——每次点击正文追加「观察」回显 + 一行
//   【系统】拒绝（「抉择未定——这一带已经看熟了…」等），日志净增 2 行，
//   HP/MP/动静零变化。违反 game-balance-analyst「Dead option」与
//   intuitive-game-design Q5（拒绝没有任何正反馈出口，点了才告诉你
//   不能点）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，骨架照抄
//   observe-in-choice-lock.mjs / observe-cost-claim.mjs），390×844 与
//   1440×900 双视口各起一个新档、DB 直落第 1 章 must_choose 场景
//   （oracle 取自 chapters.json，不经被测引擎）：
//     D) 防过度禁用：free_left>0 期间按钮必须为可点态，且能真实发出
//        /action 回包——逐次点击直到键被锁；
//     B) 锁定期断言：button[data-act="观察"] 满足 disabled===true 或
//        aria-disabled==="true"，且 title / 就地小字（.observe-hint）
//        给出非空原因；
//     A) 耗尽后对键位中心真实鼠标连点 3 次（点击落承接壳），.log-entry
//        增量 ≤1（理想 0；1 是「只记一次已耗尽」实现的余量）；
//     C) 耗尽态热键（数字键 2 = 「环顾四周」槽位）与自由输入「观察」
//        同样零日志增长——同一 ≤1 判据；刷新重进后 .log-entry 总数
//        与连点前一致（服务端确实零落库，不只是前端藏行）。
//
//   旧码红证：键不锁、每次点击净增 2 行——断言 A 首轮即 FAIL。
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

// Oracle：第 1 章首个 must_choose 场景，不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);

// 前端由 server 以 client/dist 静态托管——本断言验的正是本 worktree 的
// 客户端，dist 缺失或是外部软链时先补构建（同族脚本同口径）。
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
      console.error("[E2E] observe-empty-spam: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f314-"));
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
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
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
    console.error(
      `[E2E] observe-empty-spam: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    cleanup();
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const ACTION_RESP = (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname);
const ENTRY_SEL = ".stage-col .log-entry";
const OBS_SEL = '.actions-main button[data-act="观察"]';
const OBS_HOTKEY = "2"; // ACTION_BUTTONS 槽位 2 = 「环顾四周」
const MAX_CLICKS = 8;

assert(MC && MC.id, "oracle: ch1 must_choose scene missing in chapters.json");

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

run("observe-empty-spam", async ({ page }) => {
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const entryCount = () => page.locator(ENTRY_SEL).count();

  for (const vp of [
    { width: 390, height: 844, tag: "390x844" },
    { width: 1440, height: 900, tag: "1440x900" },
  ]) {
    console.log(`\n── viewport ${vp.tag} ──`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await createSave(page, `e2e-f314-${vp.tag}-${Date.now().toString(36)}`);
    await waitIdle();
    const saveId = await page.evaluate(() =>
      Number(localStorage.getItem("solo_leveling_save_id"))
    );
    assert(saveId > 0, "save_id missing in localStorage");

    // 直落 must_choose 场景（同族脚本同口径）：清交战、清遭遇保底账。
    {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      try {
        db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(
          MC.id,
          saveId
        );
        db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
      } finally {
        db.close();
      }
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForSelector(".btn-group-choice");
    await waitIdle();

    const obsBtn = page.locator(OBS_SEL).first();
    assert((await obsBtn.count()) > 0, `[${vp.tag}] 找不到「环顾四周」键（${OBS_SEL}）`);

    // ── D) 免费次数内按钮必须可点；逐次点击直到锁定 ──────────────
    let freeClicks = 0;
    for (let guard = 0; guard < MAX_CLICKS; guard++) {
      const s0 = await fetchSave(saveId);
      const freeLeft = Number(s0.observe && s0.observe.free_left) || 0;
      const disabled = await obsBtn.isDisabled().catch(() => false);
      const ariaDisabled = await obsBtn.getAttribute("aria-disabled");
      if (freeLeft > 0) {
        // D：次数尚存不得禁用——「确实无新信息」之外的过度禁用在此现形。
        assert(
          !disabled && ariaDisabled !== "true",
          `[${vp.tag}] D 防过度禁用：free_left=${freeLeft} 时「环顾四周」已被置灰 ` +
            `disabled=${disabled} aria-disabled=${ariaDisabled}`
        );
        const respP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
        await obsBtn.click();
        const resp = await respP;
        const body = await resp.json().catch(() => null);
        assert(body && body.reply, `[${vp.tag}] D 第 ${freeClicks + 1} 次观察回包缺 reply`);
        await waitIdle();
        freeClicks += 1;
        continue;
      }
      break;
    }
    const sSpent = await fetchSave(saveId);
    assert(
      Number(sSpent.observe && sSpent.observe.free_left) === 0,
      `[${vp.tag}] 驱动异常：${MAX_CLICKS} 次内未把免费观察用尽（free_left=${sSpent.observe && sSpent.observe.free_left}）`
    );
    console.log(`    [${vp.tag}] D ok 免费区内可点 · ${freeClicks} 次后 free_left=0`);

    // ── B) 耗尽态按钮显性不可用 + 非空原因 ───────────────────────
    const lock = await page.evaluate((sel) => {
      const b = document.querySelector(sel);
      if (!b) return null;
      return {
        disabled: b.disabled,
        ariaDisabled: b.getAttribute("aria-disabled"),
        title: b.getAttribute("title") || "",
        hint: [...document.querySelectorAll(".observe-hint, [data-observe-hint]")]
          .map((n) => (n.textContent || "").trim())
          .join(" | "),
      };
    }, OBS_SEL);
    assert(lock, `[${vp.tag}] B 耗尽后「环顾四周」键从 DOM 消失（应置灰而非移除）`);
    assert(
      lock.disabled === true || lock.ariaDisabled === "true",
      `[${vp.tag}] B 耗尽后「环顾四周」未置灰：disabled=${lock.disabled} ` +
        `aria-disabled=${lock.ariaDisabled}`
    );
    assert(
      (lock.title + lock.hint).trim().length > 0,
      `[${vp.tag}] B 禁用键无任何原因说明（title/就地小字皆空）`
    );
    console.log(
      `    [${vp.tag}] B ok disabled=${lock.disabled} aria=${lock.ariaDisabled} ` +
        `原因「${(lock.title || lock.hint).slice(0, 40)}」`
    );

    // ── A) 耗尽后真实鼠标连点 3 次：.log-entry 增量 ≤1 ───────────
    const n0 = await entryCount();
    const box = await obsBtn.boundingBox();
    assert(box, `[${vp.tag}] A 「环顾四周」boundingBox 取不到`);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(cx, cy);
      await page.waitForTimeout(250);
    }
    const n1 = await entryCount();
    assert(
      n1 - n0 <= 1,
      `[${vp.tag}] A 耗尽后连点 3 次 .log-entry 净增 ${n1 - n0} 行（${n0}→${n1}，上限 1）——` +
        `连点刷屏未断`
    );
    console.log(`    [${vp.tag}] A ok 连点 3 次 .log-entry ${n0}→${n1}（增量 ≤1）`);

    // ── C) 热键与自由输入同判据：仍零日志增长 ────────────────────
    await page.keyboard.press(OBS_HOTKEY);
    await page.waitForTimeout(300);
    const n2 = await entryCount();
    assert(
      n2 - n0 <= 1,
      `[${vp.tag}] C 耗尽态热键 ${OBS_HOTKEY} 触发观察使 .log-entry 净增 ` +
        `${n2 - n1} 行（${n1}→${n2}）`
    );
    // 自由输入「观察」是绕过禁用键直达服务端的最后一条路——回包应是
    // refused 轻提示，撤回乐观行后日志不涨。窄视口输入框可能收进抽屉
    // （disabled/不可见），那时只验热键路径。
    const freeInput = page.locator(".input-row input").first();
    let n3 = n2;
    if ((await freeInput.isVisible()) && (await freeInput.isEnabled())) {
      const typedRespP = page.waitForResponse(ACTION_RESP, { timeout: 8000 });
      await freeInput.fill("观察");
      await freeInput.press("Enter");
      const typedResp = await typedRespP;
      const typedBody = await typedResp.json().catch(() => null);
      assert(
        typedBody && typedBody.refused === true,
        `[${vp.tag}] C 耗尽态自由输入「观察」未被服务端拒绝（回包无 refused）`
      );
      await waitIdle();
      n3 = await entryCount();
      assert(
        n3 - n0 <= 1,
        `[${vp.tag}] C 耗尽态自由输入「观察」使 .log-entry 净增 ${n3 - n2} 行（${n2}→${n3}）`
      );
    } else {
      console.log(`    [${vp.tag}] C 自由输入框不可用（抽屉态）——只验热键路径`);
    }
    console.log(
      `    [${vp.tag}] C ok 热键+自由输入后 .log-entry ${n0}→${n3}（增量 ≤1，回执走瞬时提示）`
    );

    // 刷新重进后总数一致——服务端确实零落库，不只是前端把行藏起来。
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await waitIdle();
    const nReload = await entryCount();
    assert(
      nReload <= n0 + 1,
      `[${vp.tag}] C 刷新后 .log-entry=${nReload}，超出连点前 ${n0}+1——服务端仍有落库`
    );
    console.log(`    [${vp.tag}] C ok 刷新后 .log-entry=${nReload}（连点前 ${n0}，零落库确认）`);
  }
});
