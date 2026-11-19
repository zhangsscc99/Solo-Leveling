#!/usr/bin/env node
// combat-hp-sync.mjs (F313): 交战态玩家/敌方 HP 数字单一事实源——
//
//   第 108 轮走查实测（docs/runs/walk-20261119T2010Z-m24.png）：
//   同一屏三个互不同步的玩家 HP 口径——顶栏 87/100（跟随 save）、
//   开战时定格的【系统】「石像守卫」HP75 · 你94/100（此后整战不再
//   更新、冒充实时提示）、战斗日志「你 HP 94→87」——玩家不知道该
//   信哪个（game-detail-bar §9b「HUD state has an owner and a
//   lifetime」）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，前端走
//   client/dist 构建产物）。开战路径选「直落 ch1 守关房前一场景
//   + 前进落地开战」（observe-in-choice-lock 同口径 DB 直落）：
//   F313 的过期快照只由 guardianWarning 的落地开战 brief 句产出，
//   「环顾四周」过盖遭遇（combat-hp-distinct 口径的小怪战）从来不
//   写这句——要断言「过期数字被抓出来」就必须走守关战落地通道。
//   开战后攻击直至我方 HP 真实下降（≥2 回合），断言（真值一律取
//   GET /game/api/saves/:id，不从 DOM 反推）：
//     C) 全页可见文本里不存在与当前 save.hp 不相等的玩家 HP 数字
//        串（玩家串 = 分母为 max_hp 的 a/b，或「你」字领起的 a/b；
//        tooltip/title/aria-label 本就不进 innerText）。旧码必红：
//        那句定格的「你 97/100」在 save.hp=87 时被当场抓出；
//     A) 顶栏 .status HP 数字 == 战斗面板 [data-side="player"] 数字
//        == .stage-col 最后一条「你 HP a→b」的 b == save.hp；
//     B) 全部玩家 HP 串（含顶栏/面板/系统行）逐一枚举且值全等于
//        save.hp——面板侧还必须以 role="meter" + aria-valuenow
//        承载同一数值；
//     D) 面板 [data-side="enemy"] 数字与 meter 语义值等于
//        save.combat.enemy.hp/max_hp。
//   A/B/C/D 在 1440×900 与 390×844 双视口各跑一遍。
//
//   旧码红证：本断言组先跑 (C)，旧码在面板数字缺位之前就倒在那句
//   定格快照上，exit=1，形如：
//     [ASSERT] C 1440×900: 交战态可见区发现过期玩家 HP 数字
//     97/100（当前真值 87/100）· 语境「…· 你 97/100——说「攻击」…」
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

// Oracle：第 1 章守关场景与它的主线链前驱（落地必开战的前一站），
// 不经被测引擎。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const BOSS_SCENE = CH1.scenes.find((s) => s.kind === "boss");
const PREV_SCENE = CH1.scenes.find((s) => s.next_scene === BOSS_SCENE.id);

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建——本断言验的正是本 worktree 的客户端。
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
      console.error("[E2E] combat-hp-sync: client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f313-"));
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
    console.error(`[E2E] combat-hp-sync: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
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
    const shot = `/root/logs/e2e-combat-hp-sync-${Date.now()}.png`;
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
const HP_PAIR_RE = /(\d+)\s*\/\s*(\d+)/;

const parsePair = (t) => {
  const m = String(t || "").match(HP_PAIR_RE);
  return m ? { a: Number(m[1]), b: Number(m[2]) } : null;
};

// 枚举某 DOM 区域内可见文本中的玩家 HP 数字串：
//   · 分母等于 save.max_hp 的 a/b（我方 HP 串的分母永远是我方上限）；
//   · 或「你」字领起的 a/b（「你 94/100」「你的 HP 94/100」快照口径）。
// 敌方 HP 串（「拦住去路——HP 75/75」「它的 HP 42/42」）是交战那一刻的
// 事件记录，不在本口径内——它们的实时家只有战斗面板（断言 D）。
function collectPlayerHpStrings(text, maxHp) {
  const out = [];
  const re = /(\d+)\s*\/\s*(\d+)/g;
  let m;
  while ((m = re.exec(text))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const pre = text.slice(Math.max(0, m.index - 12), m.index);
    const youMarked = /你\s*(?:的\s*)?(?:HP\s*)?$/.test(pre);
    if (b === maxHp || youMarked) {
      out.push({
        a,
        b,
        ctx: text.slice(Math.max(0, m.index - 24), m.index + m[0].length + 8).replace(/\s+/g, " ").trim(),
      });
    }
  }
  return out;
}

async function regionText(sel) {
  return page
    .locator(sel)
    .first()
    .evaluate((el) => el.innerText)
    .catch(() => "");
}

// 完整断言组：在某一视口下对（交战中的）页面跑 C → A → B → D。
// (C) 先扫过期数字——旧码必须倒在这里（面板数字缺位之前），红证文本
// 直接报出抓到的过期串与真值。
async function check(tag, sv) {
  const hp = Math.trunc(Number(sv.hp));
  const maxHp = Math.trunc(Number(sv.max_hp));
  const enemy = sv.combat && sv.combat.enemy;

  // (C) 交战态可见区不得有与 save.hp 不相等的玩家 HP 数字
  {
    const body = await page.locator("body").innerText();
    const stale = collectPlayerHpStrings(body, maxHp).filter((s) => s.a !== hp);
    assert(
      stale.length === 0,
      `C ${tag}: 交战态可见区发现过期玩家 HP 数字 ` +
        stale.map((s) => `${s.a}/${s.b}（当前真值 ${hp}/${maxHp}）· 语境「…${s.ctx}…」`).join("；")
    );
    console.log(`    [OK] C ${tag}: 全页玩家 HP 串均等于真值 ${hp}/${maxHp}（无过期快照）`);
  }

  // (A) 顶栏 == 面板玩家侧 == 战报末条「你 HP a→b」的 b == save.hp
  {
    const top = parsePair(await regionText(".status .gauge-hp .gauge-num"));
    assert(top, `A ${tag}: 顶栏 .status .gauge-hp .gauge-num 取不到 a/b 数字`);
    const panelNum = page.locator('.combat [data-side="player"] .gauge-hp .gauge-num');
    assert(
      (await panelNum.count()) > 0,
      `A ${tag}: 战斗面板玩家侧无可见 HP 数字（.combat [data-side=player] .gauge-num 缺席）`
    );
    const panel = parsePair(await panelNum.first().innerText());
    const stage = await regionText(".stage-col");
    const arrows = [...stage.matchAll(/你\s*HP\s*(\d+)\s*→\s*(\d+)/g)];
    assert(arrows.length > 0, `A ${tag}: .stage-col 里找不到「你 HP a→b」战报行`);
    const logB = Number(arrows[arrows.length - 1][2]);
    assert(
      top.a === hp && panel.a === hp && logB === hp,
      `A ${tag}: 三口径不一致——顶栏=${top.a} 面板=${panel.a} 战报末值=${logB} 真值=${hp}`
    );
    console.log(`    [OK] A ${tag}: 顶栏/面板/战报末值 三口径同读 ${hp}`);
  }

  // (B) 全部玩家 HP 串逐一枚举值全等 save.hp；面板/敌侧走 meter 语义
  {
    const body = await page.locator("body").innerText();
    const all = collectPlayerHpStrings(body, maxHp);
    assert(all.length >= 2, `B ${tag}: 玩家 HP 串仅枚举到 ${all.length} 处（顶栏+面板应 ≥2）`);
    const bad = all.filter((s) => s.a !== hp || s.b !== maxHp);
    assert(
      bad.length === 0,
      `B ${tag}: 玩家 HP 串与真值 ${hp}/${maxHp} 不符：` +
        bad.map((s) => `${s.a}/${s.b}「…${s.ctx}…」`).join("；")
    );
    const meter = page.locator('.combat [data-side="player"] .gauge-hp[role="meter"]').first();
    assert(
      (await meter.count()) > 0,
      `B ${tag}: 面板玩家 HP 条缺 role="meter" 语义承载`
    );
    const vnow = Number(await meter.getAttribute("aria-valuenow"));
    assert(
      vnow === hp,
      `B ${tag}: 面板玩家 HP meter aria-valuenow=${vnow} ≠ 真值 ${hp}`
    );
    console.log(`    [OK] B ${tag}: 枚举玩家 HP 串 ×${all.length} 全等 ${hp}/${maxHp}，meter 语义同值`);
  }

  // (D) 面板敌方 HP 数字与 meter 值 == save.combat.enemy.hp/max_hp
  {
    assert(enemy, `D ${tag}: save.combat.enemy 缺失（交战态已脱？）`);
    const eHp = Math.trunc(Number(enemy.hp));
    const eMax = Math.trunc(Number(enemy.max_hp));
    const eNum = page.locator('.combat [data-side="enemy"] .gauge-hp .gauge-num');
    assert((await eNum.count()) > 0, `D ${tag}: 面板敌侧无可见 HP 数字`);
    const got = parsePair(await eNum.first().innerText());
    assert(
      got && got.a === eHp && got.b === eMax,
      `D ${tag}: 面板敌方 HP=${got ? `${got.a}/${got.b}` : "无法解析"} ≠ 真值 ${eHp}/${eMax}`
    );
    const eMeter = page.locator('.combat [data-side="enemy"] .gauge-hp[role="meter"]').first();
    assert((await eMeter.count()) > 0, `D ${tag}: 面板敌方 HP 条缺 role="meter"`);
    assert(
      Number(await eMeter.getAttribute("aria-valuenow")) === eHp,
      `D ${tag}: 面板敌方 HP meter aria-valuenow ≠ ${eHp}`
    );
    console.log(`    [OK] D ${tag}: 面板敌方 HP ${eHp}/${eMax} 与 meter 语义同值`);
  }
}

assert(BOSS_SCENE && PREV_SCENE, "oracle: ch1 boss 场景或其前驱缺失");

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await createSave(page, `e2e-f313-${Date.now().toString(36)}`);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, "localStorage 无 save_id");

  // 直落守关房前一站（observe-in-choice-lock 同口径）：清交战、清保底账，
  // 回灌后一次「前进」确定性落到 boss 场景开战——F313 过期快照只在这条
  // 落地路径产出。
  {
    const Database = require("better-sqlite3");
    const db = new Database(dbPath);
    try {
      db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(
        PREV_SCENE.id,
        saveId
      );
      db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
    } finally {
      db.close();
    }
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(() => !document.querySelector(".pending"));

  // 「前进」→ 落地守关房必开战，回包带【遭遇】+ guardianWarning brief 句。
  {
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.fill(".input-row input", "前进");
    await page.press(".input-row input", "Enter");
    await respP;
  }
  await page.waitForSelector(".combat", { timeout: 10000 });
  let sv = await fetchSave(saveId);
  assert(sv && sv.combat && sv.combat.enemy, "落地后 save.combat 未落库");
  assert(
    sv.combat.enemy.boss === true,
    `落点敌人不是守关者（${sv.combat.enemy.name}）——直落场景口径失效？`
  );
  const hpAfterLand = Math.trunc(Number(sv.hp));
  console.log(
    `    交战就位：${sv.combat.enemy.name} Lv.${sv.combat.enemy.level} ` +
      `HP ${sv.combat.enemy.hp}/${sv.combat.enemy.max_hp} vs 你 HP ${sv.hp}/${sv.max_hp}`
  );

  // 攻击直至我方 HP 真实下降（≥2 回合；敌方反击命中率 ~0.85，虚位兜底
  // 4 次）——快照值与真值必须真实错开，断言才有判别力。
  let attacks = 0;
  while (attacks < 4 && sv.combat && (sv.hp >= hpAfterLand || attacks < 2)) {
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.fill(".input-row input", "攻击");
    await page.press(".input-row input", "Enter");
    await respP;
    attacks += 1;
    sv = await fetchSave(saveId);
  }
  assert(sv.combat, `${attacks} 次攻击后已脱战（守关者被速杀/阵亡？）`);
  assert(
    sv.hp < hpAfterLand,
    `${attacks} 次攻击后我方 HP 未降（${hpAfterLand}→${sv.hp}）——敌方反击全落空，断言无判别力`
  );
  console.log(`    ${attacks} 回合后：你 HP ${hpAfterLand}→${sv.hp} · 敌 HP ${sv.combat.enemy.hp}/${sv.combat.enemy.max_hp}`);

  // 等顶栏 count-up 落定再读数（F259 滚动 ~400ms，中间帧会读出假过期）。
  await page
    .waitForSelector('.status .gauge-hp .gauge-num[data-counting="0"]', { timeout: 5000 })
    .catch(() => page.waitForTimeout(600));

  sv = await fetchSave(saveId);
  await check("1440×900", sv);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await check("390×844", await fetchSave(saveId));

  await browser.close();
  console.log("[E2E] combat-hp-sync PASS：交战态玩家/敌方 HP 数字全屏同源，无过期快照");
  process.exit(0);
} catch (e) {
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    const shot = `/root/logs/e2e-combat-hp-sync-${Date.now()}.png`;
    if (page) await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error(`[ASSERT] ${e && e.message} screenshot=${shot}`);
  } catch {
    console.error(`[ASSERT] ${e && e.message}`);
  }
  process.exit(1);
}
