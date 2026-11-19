#!/usr/bin/env node
// disabled-denied-feedback.mjs (F279): 锁定 / 禁用的动作键点了必须有回执。
//
//  第58轮实测：must_choose 下「探索前进」、满状态「休息」为 disabled，
//  连点 3 次 —— .sys-toast 空、日志条目不变、按钮无抖动、无请求，玩家
//  只能判定「游戏坏了」（intuitive-game-design Q5 Post 层缺失）。
//
//  本脚本自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），断言：
//   A) must_choose（ch1_law，HP/MP 满）——页面上每个 disabled 的
//      [data-act] 键，真实鼠标坐标点击后 400ms 内至少出现一种回执：
//        · .sys-toast 有非空文案；或
//        · 该键（或其承接壳）出现 data-denied="1"；或
//        · .sys-toast / [aria-live] 文案发生可见变化。
//   B) 交战态（DB 直落 combat 行 + MP=2）——「连击」欠蓝是 aria-disabled
//      死键，点击后必须给「魔力不足」口径回执；交战态「存档」同理。
//   C) 全程零副作用：日志条目数、HP/MP/XP/金币不变，且没有任何 /api/
//      出站请求（拒绝回执纯前端）。
//   D) 390×844 下无横向溢出、按钮矩形点击前后一致（承接壳不改布局）。
//
//  旧码红证：前进/休息的承接壳只认 restBlocked||choiceLocked，观察看尽、
//  连击欠蓝、交战存档三处仍无任何回执；且旧壳不打 data-denied → A 的首个
//  无 toast 元素必然 FAIL。
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
const encounterEngine = require(path.join(ROOT, "server", "engine", "encounter.js"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MC = CH1.scenes.find((s) => s.must_choose === true);
const MOB_SCENE = CH1.scenes.find((s) => s.kind === "mob") || CH1.scenes.find((s) => s.must_choose !== true);

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`[E2E] disabled-denied-feedback FAIL: ${msg}`);
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f279-"));
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
      `[E2E] disabled-denied-feedback: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { run, createSave } = await import("./lib.mjs");

let page;
let apiHits = [];

// 收集「当前可见且被禁用」的行动键：data-act 集合（不含系统页签——它们
// 可点），并带上各自的 selector 与文案。
const disabledActs = () =>
  page.$$eval("[data-act]", (els) =>
    els
      .map((el, i) => {
        el.setAttribute("data-f279-idx", String(i));
        return {
          idx: i,
          act: el.getAttribute("data-act"),
          text: (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 20),
          disabled: el.disabled === true,
          ariaDisabled: el.getAttribute("aria-disabled") === "true",
          rect: (() => {
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
          })(),
        };
      })
      .filter((b) => b.disabled || b.ariaDisabled)
  );

const snapshot = () =>
  page.evaluate(() => ({
    rows: document.querySelectorAll(".stage-col.log > *").length,
    vitals: (document.querySelector(".status")?.innerText || "").replace(/\s+/g, " "),
    toast: [...document.querySelectorAll(".sys-toast")].map((t) => t.textContent).join("|"),
    denied: document.querySelectorAll('[data-denied="1"]').length,
  }));

// 点一次禁用键，400ms 内必须有回执。
const denyClick = async (el, tag) => {
  const box = await el.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${tag}: boundingBox 无效`);
  const before = await snapshot();
  const hits0 = apiHits.length;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  let ok = false;
  try {
    await page.waitForFunction(
      (prevToast) => {
        const toast = [...document.querySelectorAll(".sys-toast")]
          .map((t) => (t.textContent || "").trim())
          .filter(Boolean)
          .join("|");
        const denied = document.querySelectorAll('[data-denied="1"]').length;
        return denied > 0 || (toast.length > 0 && toast !== prevToast);
      },
      before.toast,
      { timeout: 400, polling: 50 }
    );
    ok = true;
  } catch {
    ok = false;
  }
  const after = await snapshot();
  assert(
    ok,
    `${tag}: 点击禁用键零回执（toast="${after.toast}" denied=${after.denied}）`
  );
  assert(
    after.rows === before.rows,
    `${tag}: 拒绝回执改了日志条目 ${before.rows} -> ${after.rows}`
  );
  assert(
    after.vitals === before.vitals,
    `${tag}: 拒绝回执改了状态读数（${before.vitals} -> ${after.vitals}）`
  );
  assert(
    apiHits.length === hits0,
    `${tag}: 拒绝回执发出了 ${apiHits.length - hits0} 个 /api 请求（应零请求）`
  );

  // 回执文案本身要有信息（不是空白/省略号）。
  const toastText = await page.evaluate(
    () =>
      [...document.querySelectorAll(".sys-toast")]
        .map((t) => (t.textContent || "").trim())
        .filter(Boolean)
        .join("|") || document.querySelector('[data-denied="1"]')?.getAttribute("aria-label") || ""
  );
  assert(
    toastText.replace(/[|\s]/g, "").length >= 4,
    `${tag}: 回执文案过短「${toastText}」`
  );
  // 等抖动窗口过去，避免污染下一次快照。
  await page.waitForTimeout(520);
  return toastText;
};

run("disabled-denied-feedback", async ({ page: p }) => {
  page = p;
  page.on("request", (req) => {
    const u = req.url();
    if (/\/api\//.test(u)) apiHits.push(u);
  });

  const name = `e2e-f279-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  const withDb = (fn) => {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };

  // ── A) must_choose + 满 HP/MP：前进（抉择锁）与休息（满状态）都是死键 ──
  withDb((db) => {
    db.prepare(
      "UPDATE saves SET scene = ?, encounter_clock = 0, hp = max_hp, mp = max_mp WHERE id = ?"
    ).run(MC.id, saveId);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".btn-group-choice");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  const actsA = await disabledActs();
  assert(actsA.length >= 2, `A: 期望 ≥2 个禁用行动键（前进+休息），实得 ${actsA.length}`);

  const rectsBefore = await page.$$eval("[data-act]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    })
  );

  for (const a of actsA) {
    const el = page.locator(`[data-f279-idx="${a.idx}"]`).first();
    const text = await denyClick(el, `[390] 「${a.text}」(act=${a.act})`);
    console.log(`    [390] 「${a.text}」→ 回执「${text.slice(0, 40)}」`);
  }

  // D) 承接壳不改布局 + 无横向溢出
  const rectsAfter = await page.$$eval("[data-act]", (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`;
    })
  );
  assert(
    JSON.stringify(rectsBefore) === JSON.stringify(rectsAfter),
    `D: 拒绝回执改变了键位矩形（${rectsBefore.join(" ")} vs ${rectsAfter.join(" ")})`
  );
  const fit = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  assert(fit.sw === fit.cw, `D: 390 横向溢出 ${fit.sw} > ${fit.cw}`);

  // ── B) 交战态：连击欠蓝（MP=2）与存档都必须有回执 ──────────────────
  const mob = encounterEngine.spawn(1, 7, 1);
  withDb((db) => {
    db.prepare("UPDATE saves SET scene = ?, mp = 2, encounter_clock = 0 WHERE id = ?").run(
      MOB_SCENE.id,
      saveId
    );
    db.prepare(
      `INSERT INTO combat (save_id, enemy_json, turn, started_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(save_id) DO UPDATE SET enemy_json = excluded.enemy_json, turn = 1`
    ).run(saveId, JSON.stringify(mob));
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));
  await page.waitForTimeout(300);

  const combo = page.locator('[data-act="连击"]').first();
  assert((await combo.count()) > 0, "B: 交战态没有「连击」键");
  assert(
    (await combo.getAttribute("aria-disabled")) === "true",
    "B: MP=2 时「连击」aria-disabled 不等于 true"
  );
  const comboTxt = await denyClick(combo, '[战斗] 「连击」(MP=2)');
  assert(/魔力不足|MP/.test(comboTxt), `B: 连击回执未说明原因「${comboTxt}」`);
  console.log(`    [战斗] 「连击」→ 回执「${comboTxt.slice(0, 40)}」`);

  const saveBtn = page.locator(".btn-group-sys > .btn", { hasText: "存档" }).first();
  const saveTxt = await denyClick(saveBtn, '[战斗] 「存档」');
  assert(/交战|存档/.test(saveTxt), `B: 存档回执未说明原因「${saveTxt}」`);
  console.log(`    [战斗] 「存档」→ 回执「${saveTxt.slice(0, 40)}」`);

  const hp = await page.evaluate(() => {
    const t = document.querySelector(".status")?.innerText || "";
    return t.replace(/\s+/g, " ");
  });
  console.log(`    [战斗] 结束时状态读数：${hp.slice(0, 60)}`);
  console.log("    [pass] 禁用键回执全部命中，零副作用");
});
