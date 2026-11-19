#!/usr/bin/env node
// locked-action-feedback.mjs (F289): 抉择锁定键必须「点得到回执 + 说得清原因」。
//
//  第91轮实测（线上 390×844，干净档）：must_choose 决策点连点「探索前进」3 次，
//  第 2、3 次按钮 `class="btn choice-locked" disabled=true aria-disabled=true`，
//  `.sys-toast` 空、`.log` 子节点不变、HUD 零变化——玩家只能判定「游戏卡死」。
//  （intuitive-design Q5 Immediate/Post 层缺失 + game-detail-bar §9c「disabled
//  shakes with the denied sound」）
//
//  脚本自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，直落第 1 章
//  must_choose 场景），断言：
//   1. `[data-act="前进"]` 处于 choice-locked（disabled 或 aria-disabled）；
//   2. 真实鼠标点击键中心，300ms 内至少一种可见回执：
//        a) `.sys-toast` 文案出现/变化且含「选择」；或
//        b) 该键或其承接壳触发 animation/data-denied，且出现一条
//           「需要先做出选择」类可见提示节点；
//   3. 该键 `aria-describedby` 非空，指向的元素存在、可见（有尺寸、非
//      display:none/visibility:hidden）、文本含「选择」；
//   4. 零副作用：点击前后日志条目数、HP/MP/XP/金币不变；
//   5. 390×844 下无横向溢出，键位矩形点击前后一致（回执不改布局）。
//
//  旧码红证：choice-locked 键既无 aria-describedby（第 3 条首轮 FAIL），
//  也无承接壳（真实点击落在 disabled 上无任何回执 → 第 2 条 FAIL）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(path.join(ROOT, "noop.js"));

const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`[E2E] locked-action-feedback FAIL: ${msg}`);
    process.exit(1);
  }
};

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f289-"));
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
    console.error(
      `[E2E] locked-action-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { run, createSave } = await import("./lib.mjs");

run("locked-action-feedback", async ({ page }) => {
  const name = `e2e-f289-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "localStorage 里没有 save_id");

  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    db.prepare(
      "UPDATE saves SET scene = ?, encounter_clock = 0, hp = max_hp, mp = max_mp WHERE id = ?"
    ).run(MC.id, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  } finally {
    db.close();
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await page.waitForTimeout(300);

  // ── 1) 锁定态成立 ────────────────────────────────────────────────
  const fwd = page.locator('[data-act="前进"]').first();
  assert((await fwd.count()) > 0, "390 下找不到 [data-act=\"前进\"]");
  const state = await fwd.evaluate((el) => ({
    disabled: el.disabled === true,
    ariaDisabled: el.getAttribute("aria-disabled") === "true",
    cls: el.className,
  }));
  assert(
    state.disabled || state.ariaDisabled,
    `must_choose 下「前进」未锁定（disabled=${state.disabled} aria-disabled=${state.ariaDisabled} class=${state.cls}）`
  );

  // ── 3) aria-describedby 指向可见原因 ─────────────────────────────
  const descId = await fwd.getAttribute("aria-describedby");
  assert(!!descId, "locked 键缺 aria-describedby（读屏/键盘拿不到「为什么点不动」）");
  const desc = await page.evaluate((id) => {
    const el = document.getElementById(id);
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      found: true,
      text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim(),
      visible:
        r.width > 0 &&
        r.height > 0 &&
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        Number(cs.opacity) > 0.05,
      inViewport: r.top >= 0 && r.bottom <= window.innerHeight + 1,
    };
  }, descId);
  assert(desc.found, `aria-describedby="${descId}" 指向的元素不存在`);
  assert(desc.visible, `aria-describedby="${descId}" 指向的元素不可见（0 尺寸/隐藏/透明）`);
  assert(/选择/.test(desc.text), `描述文案未说明要「选择」：「${desc.text.slice(0, 60)}」`);
  console.log(`    [390] aria-describedby=${descId} → 「${desc.text.slice(0, 40)}」`);

  // ── 2) 真实点击必须有 300ms 内可见回执 ───────────────────────────
  const snap = () =>
    page.evaluate(() => ({
      rows: document.querySelectorAll(".stage-col.log > *").length,
      vitals: (document.querySelector(".status")?.innerText || "").replace(/\s+/g, " "),
      toast: [...document.querySelectorAll(".sys-toast")]
        .map((t) => (t.textContent || "").trim())
        .filter(Boolean)
        .join("|"),
      denied: document.querySelectorAll('[data-denied="1"]').length,
      hint: [...document.querySelectorAll('[role="note"]')]
        .filter((n) => n.offsetWidth > 0 && n.offsetHeight > 0)
        .map((n) => (n.textContent || "").replace(/\s+/g, " ").trim())
        .filter((t) => /先.*选择|需要先做/.test(t)).length,
    }));

  const rectsBefore = await page.$$eval("[data-act]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    })
  );

  const box = await fwd.boundingBox();
  assert(box && box.width > 0 && box.height > 0, "「前进」键 boundingBox 无效");
  const before = await snap();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  let receipt = null;
  try {
    const handle = await page.waitForFunction(
      (prev) => {
        const toast = [...document.querySelectorAll(".sys-toast")]
          .map((t) => (t.textContent || "").trim())
          .filter(Boolean)
          .join("|");
        const denied = document.querySelectorAll('[data-denied="1"]').length;
        const shaken = [...document.querySelectorAll(".choice-locked, .deny-tap-catcher, [data-denied]")].some(
          (el) => getComputedStyle(el).animationName !== "none"
        );
        const hint = [...document.querySelectorAll('[role="note"]')]
          .some((n) => n.offsetWidth > 0 && /先.*选择|需要先做/.test(n.textContent || ""));
        if (denied > 0) return { kind: "denied", toast, shaken, hint };
        if (/选择/.test(toast) && toast !== prev.toast) return { kind: "toast", toast, shaken, hint };
        if ((shaken || denied > 0) && hint) return { kind: "shake+hint", toast, shaken, hint };
        return false;
      },
      before,
      { timeout: 300, polling: 25 }
    );
    receipt = await handle.jsonValue();
  } catch {
    receipt = null;
  }
  const after = await snap();
  assert(
    !!receipt,
    `点击锁定键 300ms 内零回执（toast="${after.toast}" denied=${after.denied} hint=${after.hint}）`
  );
  assert(
    /选择/.test(receipt.toast || "") || receipt.hint > 0,
    `回执没有说明「请先做出选择」（toast="${receipt.toast}" hint=${receipt.hint}）`
  );
  console.log(`    点击回执 kind=${receipt.kind} toast=「${(receipt.toast || "").slice(0, 40)}」`);

  // ── 4) 零副作用 ─────────────────────────────────────────────────
  assert(after.rows === before.rows, `回执改了日志条目 ${before.rows} -> ${after.rows}`);
  assert(after.vitals === before.vitals, `回执改了状态读数（${before.vitals} -> ${after.vitals}）`);

  // ── 5) 布局不变 + 无横向溢出 ────────────────────────────────────
  await page.waitForTimeout(520);
  const rectsAfter = await page.$$eval("[data-act]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    })
  );
  assert(
    JSON.stringify(rectsBefore) === JSON.stringify(rectsAfter),
    `回执改变了键位矩形（${rectsBefore.join(" ")} vs ${rectsAfter.join(" ")}）`
  );
  const fit = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
    stageBottom: document.querySelector(".stage")?.getBoundingClientRect().bottom ?? 0,
    actionsTop: document.querySelector(".actions-main")?.getBoundingClientRect().top ?? 0,
  }));
  assert(fit.sw <= fit.cw, `390 横向溢出 ${fit.sw} > ${fit.cw}`);

  // 连点 2 次都要有回执（一次性动画/文案不能只命中首击）。
  for (let i = 2; i <= 3; i++) {
    const b0 = await snap();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    let ok = false;
    try {
      await page.waitForFunction(
        (prev) => {
          const toast = [...document.querySelectorAll(".sys-toast")]
            .map((t) => (t.textContent || "").trim())
            .filter(Boolean)
            .join("|");
          return (
            document.querySelectorAll('[data-denied="1"]').length > 0 ||
            (/选择/.test(toast) && toast !== prev.toast)
          );
        },
        b0,
        { timeout: 300, polling: 25 }
      );
      ok = true;
    } catch {}
    assert(ok, `第 ${i} 次点击锁定键零回执`);
    await page.waitForTimeout(520);
  }

  console.log(`    [390] 连点 3 次全部有回执，键位零位移，无横向溢出（stage 底 ${Math.round(fit.stageBottom)} / actions 顶 ${Math.round(fit.actionsTop)}）`);
  console.log("    [pass] F289：锁定键回执 + aria-describedby 可见原因 + 零副作用");
});
