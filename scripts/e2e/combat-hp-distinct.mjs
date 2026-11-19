#!/usr/bin/env node
// combat-hp-distinct.mjs (F286): 交战浮层敌我血条必须可分辨、己方 HP
// 数字不与顶栏重复——
//
//   第 86 轮走查实测（docs/runs/walk-20261119T0533Z-m4-combat.png）：
//   交战浮层里我方与敌方 HP 条同为红色、同款样式，阵营只能靠名字文字
//   区分（违反 game-detail-bar §9d「Never colour alone」）；同时己方
//   HP「97/100」在顶栏状态区与浮层各渲染一次（违反 §9b 保留 HUD 区不
//   重复占位）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，前端走
//   client/dist 构建产物），真实浏览器新档连点「环顾四周」直至遭遇
//   触发（与 observe-threat-pays 同口径，第 7 次确定性开战），交战
//   浮层自动展开后断言：
//     a) 存在 [data-side="enemy"] 与 [data-side="player"]，两侧各有
//        .gauge-hp .gauge-fill；
//     b) 敌侧 HP 填充与己侧 HP 填充的 computed backgroundImage 不同
//        （底色/填充色不同）；
//     c) 敌侧填充 backgroundImage 含 repeating-linear-gradient（斜纹
//        非颜色标识），且敌侧 .gauge-num 仍渲染 \d+/\d+ 数字；
//     d) 页面可见文本中，己方「hp/max_hp」数字串只出现 1 次（顶栏那次），
//        浮层己方 HP 不再重复渲染该数字（role=meter 承载语义值）；
//     e) 390×844 与 1440×900 两个视口下，.combat 与 .combat-sides 均无
//        横向溢出（scrollWidth <= clientWidth）。
//     f) F303：顶栏 .status .gauge-hp .gauge-fill 与浮层己方填充的
//        computed backgroundImage 字符串完全相等（共用 --hp-player-fill）；
//     g) 敌方填充与该己方填充不相等，且仍含 repeating-linear-gradient
//        斜纹（颜色+纹理双通道可分辨）。
//
//   旧码红证：前端回退到 F286 之前（无 data-side 标记、双方同款红条、
//   浮层己方 HP 仍渲染 97/100）实测，(a) 即拦下，exit=1：
//     [ASSERT] (a) 交战浮层缺 [data-side="enemy"] 语义标记——
//     敌我两侧无法被程序化区分
//   修复后 (a)–(e) 全过，390/1440 双视口无溢出，连跑 2 次 PASS、exit=0。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f286-"));
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
    console.error(`[E2E] combat-hp-distinct: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定（指向隔离实例，不打公网）。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { launch, createSave } = await import("./lib.mjs");

let page = null; // 截图用
function assert(cond, msg) {
  if (cond) return;
  const done = (shot) => {
    console.error(`[ASSERT] ${msg}${shot ? ` screenshot=${shot}` : ""}`);
    process.exit(1);
  };
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    const shot = `/root/logs/e2e-combat-hp-distinct-${Date.now()}.png`;
    if (page) {
      page.screenshot({ path: shot, fullPage: true }).then(() => done(shot)).catch(() => done(""));
    } else done("");
  } catch {
    done("");
  }
}

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(8000) });
  const j = await r.json().catch(() => null);
  return j && j.save;
}

const ACTION_RE = /\/api\/(ai-)?action$/;

// 完整断言组：在某一视口下对（已开战的）页面跑 a)–e)。
async function check(tag, playerHpStr) {
  // (a) 语义标记 + 两侧血条填充都在
  assert(
    (await page.locator('.combat [data-side="enemy"]').count()) > 0,
    `(a) ${tag}: 交战浮层缺 [data-side="enemy"] 语义标记——敌我两侧无法被程序化区分`
  );
  assert(
    (await page.locator('.combat [data-side="player"]').count()) > 0,
    `(a) ${tag}: 交战浮层缺 [data-side="player"] 语义标记`
  );
  const enemyFill = page.locator('.combat [data-side="enemy"] .gauge-hp .gauge-fill').first();
  const playerFill = page.locator('.combat [data-side="player"] .gauge-hp .gauge-fill').first();
  assert((await enemyFill.count()) > 0, `(a) ${tag}: 敌侧无 HP 填充条`);
  assert((await playerFill.count()) > 0, `(a) ${tag}: 己侧无 HP 填充条`);

  // (b) 敌我填充的 computed background 不同（分色）
  const eBg = await enemyFill.evaluate((el) => getComputedStyle(el).backgroundImage);
  const pBg = await playerFill.evaluate((el) => getComputedStyle(el).backgroundImage);
  assert(
    eBg !== pBg,
    `(b) ${tag}: 敌我 HP 填充 computed backgroundImage 相同（同色同款）: ${eBg.slice(0, 120)}`
  );
  console.log(`    [OK] (b) ${tag}: 敌我填充不同 player=${pBg.slice(0, 60)}… enemy=${eBg.slice(0, 60)}…`);

  // (c) 敌侧带非颜色标识（斜纹 repeating-linear-gradient）+ 敌方数字仍在
  assert(
    /repeating-linear-gradient/.test(eBg),
    `(c) ${tag}: 敌侧 HP 填充无纹理等非颜色标识（backgroundImage=${eBg.slice(0, 120)}）`
  );
  const enemyNum = await page.locator('.combat [data-side="enemy"] .gauge-hp .gauge-num').innerText();
  assert(/\d+\s*\/\s*\d+/.test(enemyNum), `(c) ${tag}: 敌方 HP 数字丢失: "${enemyNum}"`);
  console.log(`    [OK] (c) ${tag}: 敌侧斜纹 + 数字 "${enemyNum.trim()}" 均在`);

  // (d) 己方 hp/max_hp 可见数字串全页只出现 1 次（顶栏独占）
  {
    const bodyText = await page.locator("body").innerText();
    const re = new RegExp(`(?<![\\d/])${playerHpStr.replace("/", "\\s*/\\s*")}(?![\\d/])`, "g");
    const hits = bodyText.match(re) || [];
    assert(
      hits.length === 1,
      `(d) ${tag}: 己方 HP 数字 "${playerHpStr}" 在可见文本中出现 ${hits.length} 次（期望 1=顶栏独占）`
    );
  }
  // 顶栏状态区不得带 data-side（语义标记只属于浮层）
  assert(
    (await page.locator(".status [data-side]").count()) === 0,
    `(d) ${tag}: 顶栏状态区被误标 data-side`
  );
  console.log(`    [OK] (d) ${tag}: 己方 "${playerHpStr}" 仅顶栏出现 1 次，浮层不再重复`);

  // (e) 浮层无横向溢出
  for (const sel of [".combat", ".combat-sides"]) {
    const overflow = await page.locator(sel).first().evaluate((el) => el.scrollWidth - el.clientWidth);
    assert(overflow <= 0, `(e) ${tag}: ${sel} 横向溢出 ${overflow}px`);
  }
  console.log(`    [OK] (e) ${tag}: .combat/.combat-sides 无横向溢出`);

  // (f) F303 同一含义同一语言：顶栏己方 HP 填充与浮层己方 HP 填充的
  //     computed backgroundImage 字符串完全相等（共用 --hp-player-fill）
  const topFill = page.locator(".status .gauge-hp .gauge-fill").first();
  assert((await topFill.count()) > 0, `(f) ${tag}: 顶栏无 .status .gauge-hp .gauge-fill`);
  const tBg = await topFill.evaluate((el) => getComputedStyle(el).backgroundImage);
  assert(
    tBg === pBg,
    `(f) ${tag}: 顶栏己方 HP 与浮层己方 HP 填充不一致\n      top=${tBg.slice(0, 140)}\n      cbt=${pBg.slice(0, 140)}`
  );
  console.log(`    [OK] (f) ${tag}: 顶栏/浮层己方 HP 填充完全一致 ${tBg.slice(0, 60)}…`);

  // (g) 敌方填充与（顶栏=浮层）己方填充不相等，且仍含 45° 斜纹标识
  assert(
    eBg !== tBg,
    `(g) ${tag}: 敌方 HP 填充与己方填充相同（无法区分）: ${eBg.slice(0, 120)}`
  );
  assert(
    /repeating-linear-gradient/.test(eBg),
    `(g) ${tag}: 敌方 HP 填充丢失斜纹纹理标识（backgroundImage=${eBg.slice(0, 120)}）`
  );
  console.log(`    [OK] (g) ${tag}: 敌方填充 ≠ 己方且仍带斜纹`);
}

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  // 建档闸口会被 localStorage 里的旧档跳过——先拿存储句柄再清。
  await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await createSave(page, `e2e-f286-${Date.now().toString(36)}`);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "localStorage 无 save_id");

  // 连点「环顾四周」直至遭遇触发（确定性第 7 次，上限 9 兜底）。
  const obsBtn = () => page.locator(".actions-main .btn", { hasText: "环顾四周" }).first();
  let fired = false;
  for (let i = 1; i <= 9 && !fired; i++) {
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await obsBtn().click();
    await respP;
    await page.waitForTimeout(60);
    fired = (await page.locator(".combat").count()) > 0;
  }
  assert(fired, "9 次观察后仍未进入交战（.combat 未出现）");
  const sv = await fetchSave(saveId);
  assert(sv && sv.combat && sv.combat.enemy, "触发后 save.combat 未落库");
  console.log(`    交战就位：${sv.combat.enemy.name} Lv.${sv.combat.enemy.level} HP ${sv.combat.enemy.hp}/${sv.combat.enemy.max_hp} vs 你 HP ${sv.hp}/${sv.max_hp}`);

  // (d) 前置：若敌方 HP 串与己方撞字（如都是 100/100），先打一回合让
  // 双方数值错开，再取最新己方案串做唯一性断言。
  let playerHpStr = `${sv.hp}/${sv.max_hp}`;
  const enemyHpStr = `${sv.combat.enemy.hp}/${sv.combat.enemy.max_hp}`;
  if (enemyHpStr === playerHpStr) {
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.fill(".input-row input", "攻击");
    await page.press(".input-row input", "Enter");
    await respP;
    const sv2 = await fetchSave(saveId);
    playerHpStr = `${sv2.hp}/${sv2.max_hp}`;
  }

  await check("1440×900", playerHpStr);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);
  await check("390×844", playerHpStr);

  await browser.close();
  console.log("[E2E] combat-hp-distinct PASS：敌我血条色+纹双通道可分辨，己方 HP 数字顶栏独占");
  process.exit(0);
} catch (e) {
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    const shot = `/root/logs/e2e-combat-hp-distinct-${Date.now()}.png`;
    if (page) await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error(`[ASSERT] ${e && e.message} screenshot=${shot}`);
  } catch {
    console.error(`[ASSERT] ${e && e.message}`);
  }
  process.exit(1);
}
