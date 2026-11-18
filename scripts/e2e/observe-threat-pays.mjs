#!/usr/bin/env node
// observe-threat-pays.mjs (F257): 「观察」攒出的威胁必须兑现成真实遭遇——
//
//   第 52–54 轮走查实测（干净档 ch1_double_gate）：连点「环顾四周」8 次，
//   「动静」计数 1/4→4/4 封顶，第 7/8 次文案已写「越过了界…下一刻多半
//   撞上」，但 HP 100/MP 20/XP 0/金币 0 全程零变化、从不进入遭遇、观察
//   键始终可按——威胁停在纸面，最优解仍是「一直观察」（零成本重复获益）。
//
//   本脚本对隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，前端走
//   client/dist 构建产物）用真实浏览器连点「环顾四周」：
//     a) 第 1–3 次（免费观察区）：HP/MP 与建档时完全相等，.stage-col
//        行数严格增长——防「一开始就禁止观察」式洗绿；
//     b) 保底账在 clock 1–3 时仍只是预告（第 4–6 次不开战，正文继续
//        增长）——阈值必须是 clockNext >= PITY_LIMIT(=4)，不能是 3；
//     c) 第 7 次（clockNext=4）：回包到达后 300ms 内正文出现「【遭遇】」
//        且 .combat 交战面板出现；触发回包仍含「动静 4/4」计数串；
//        触发必须恰在第 7 次（3 次免费 + 3 格预告后第 4 格兑现，确定
//        性无随机）；
//     d) 触发后再「观察」：交战门禁把该意图拦回（refused）或至少不再
//        产出景物正文——「一直观察」从此不是零成本选项；
//     e) 两轮独立新档连跑：触发位置、进入交战的结果一致（确定性）。
//
//   旧码红证：不改 server/index.js 直接跑本脚本，连点 9 次零遭遇、
//   .combat 从不出现——(c) 在 deadline 内等不到「【遭遇】」，FAIL：
//     [ASSERT] 第9次观察后 300ms 内未出现【遭遇】/.combat 交战面板——
//     威胁仍是纸面压力
//   修复后两轮连跑 PASS、exit=0。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f257-"));
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
    console.error(`[E2E] observe-threat-pays: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定（指向隔离实例，不打公网）。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { launch, createSave, readVitals } = await import("./lib.mjs");

let page = null; // 截图用
function assert(cond, msg) {
  if (cond) return;
  const done = (shot) => {
    console.error(`[ASSERT] ${msg}${shot ? ` screenshot=${shot}` : ""}`);
    process.exit(1);
  };
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    const shot = `/root/logs/e2e-observe-threat-pays-${Date.now()}.png`;
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

// 一轮完整走查：新档 → 连点「环顾四周」直到遭遇触发（≤9 次）→ 战后
// 观察被拒。返回 { trigger, enemy }，触发位置供两轮一致性比对。
async function scenario(roundTag) {
  // 建档闸口会被 localStorage 里的旧档跳过——先导航到游戏域拿到
  // localStorage 句柄再清（about:blank 上没有存储权限），再走新档流程。
  await page.goto(`${process.env.E2E_BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await createSave(page, `e2e-f257-${roundTag}-${Date.now().toString(36)}`);
  const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
  assert(saveId > 0, `${roundTag}: localStorage 无 save_id`);
  const sv0 = await fetchSave(saveId);
  assert(
    sv0 && sv0.scene === "ch1_double_gate" && !sv0.combat,
    `${roundTag}: 新档应落 ch1_double_gate 且无交战: ${JSON.stringify(sv0 && sv0.scene)}`
  );
  const v0 = await readVitals(page);
  assert(v0.hp && v0.mp, `${roundTag}: 读不到 HP/MP 仪表`);

  const stageKids = () => page.locator(".stage-col > *").count();
  const stageText = () => page.locator(".stage-col").innerText().catch(() => "");
  const obsBtn = () => page.locator(".actions-main .btn", { hasText: "环顾四周" }).first();

  let prevKids = await stageKids();
  let trigger = -1;
  let triggerBody = null;
  for (let i = 1; i <= 9; i++) {
    const btn = obsBtn();
    assert(
      (await btn.count()) > 0 && (await btn.isEnabled()),
      `${roundTag}: 第${i}次观察前「环顾四周」键不可点（交战态提前出现或键被锁）`
    );
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await btn.click();
    const resp = await respP;
    const tResp = Date.now();
    const body = await resp.json().catch(() => null);
    const replyText = String((body && body.reply && body.reply.content) || "");

    // (c) 300ms 预算：回包到达起算，「【遭遇】」字样与 .combat 面板都要出现。
    const deadline = tResp + 300;
    let fired = false;
    while (Date.now() <= deadline) {
      const [combatN, txt] = await Promise.all([page.locator(".combat").count(), stageText()]);
      if (combatN > 0 && txt.includes("【遭遇】")) {
        fired = true;
        break;
      }
      await page.waitForTimeout(15);
    }

    const kids = await stageKids();
    if (fired) {
      trigger = i;
      triggerBody = replyText;
      break;
    }
    // (a)/(b) 未触发时：正文必须有增量（第 1–6 次都不是空转键）。
    assert(
      kids > prevKids,
      `${roundTag}: 第${i}次观察未触发遭遇且正文无增量 ${prevKids} -> ${kids}——观察变死键`
    );
    prevKids = kids;
    // (a) 免费区反向断言：前 3 次 HP/MP 全程不变。
    if (i <= 3) {
      const v = await readVitals(page);
      assert(
        v.hp.v === v0.hp.v && v.mp.v === v0.mp.v,
        `${roundTag}: 第${i}次免费观察动了 HP/MP：${v0.hp.v}/${v0.mp.v} -> ${v.hp.v}/${v.mp.v}`
      );
    }
    // (b) 保底未过线时不得提前开战。
    const sv = await fetchSave(saveId);
    assert(!sv.combat, `${roundTag}: 第${i}次观察（clock 未过线）就开了战——阈值提前到 3`);
    if (i === 9) {
      assert(
        false,
        `${roundTag}: 第9次观察后 300ms 内未出现【遭遇】/.combat 交战面板——威胁仍是纸面压力`
      );
    }
  }

  assert(
    trigger === 7,
    `${roundTag}: 遭遇触发于第 ${trigger} 次观察（期望 7 = 3 次免费 + 3 格预告后第 4 格兑现）`
  );
  // (c) 触发回包文本口径：【遭遇】行 + 「动静 4/4」计数串不得丢。
  assert(triggerBody.includes("【遭遇】"), `${roundTag}: 触发回包缺【遭遇】行: ${triggerBody.slice(0, 120)}`);
  assert(
    /动静\s*4\s*\/\s*4/.test(triggerBody),
    `${roundTag}: 触发回包丢「动静 4/4」计数串: ${triggerBody.slice(0, 160)}`
  );
  // HP/MP 开战瞬间不变（伤害还没结算），但交战态必须落库。
  const svFire = await fetchSave(saveId);
  assert(
    svFire && svFire.combat && svFire.combat.enemy,
    `${roundTag}: 触发后 save.combat 未落库`
  );
  assert(
    svFire.hp === v0.hp.v && svFire.mp === v0.mp.v,
    `${roundTag}: 触发当次 HP/MP 异常变动：${v0.hp.v}/${v0.mp.v} -> ${svFire.hp}/${svFire.mp}`
  );
  const enemy = `${svFire.combat.enemy.name} Lv.${svFire.combat.enemy.level}`;
  console.log(`    ${roundTag}: 第 ${trigger} 次观察撞上 ${enemy}（300ms 内【遭遇】+.combat 就位）`);

  // (d) 触发之后再「观察」：不再产出景物正文——交战门禁拦回。
  {
    const respP = page.waitForResponse(
      (r) => ACTION_RE.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 15000 }
    );
    await page.fill(".input-row input", "观察");
    await page.press(".input-row input", "Enter");
    const resp = await respP;
    const body = await resp.json().catch(() => null);
    const txt = String((body && body.reply && body.reply.content) || "");
    const sceneryAgain = txt.startsWith("「") && txt.includes("——");
    assert(
      body && (body.refused === true || !sceneryAgain),
      `${roundTag}: 触发后「观察」仍产出景物正文: ${txt.slice(0, 120)}`
    );
    console.log(`    ${roundTag}: 触发后「观察」被拒/不再产出：${txt.replace(/\s+/g, "").slice(0, 60)}`);
  }
  return { trigger, enemy };
}

const browser = await launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  page = await ctx.newPage();
  page.setDefaultTimeout(20000);

  // (e) 两轮独立新档：确定性要求两轮触发位置完全一致。
  const r1 = await scenario("R1");
  const r2 = await scenario("R2");
  assert(
    r1.trigger === r2.trigger,
    `两轮触发位置不一致：R1 第${r1.trigger}次 / R2 第${r2.trigger}次——观察引战不是确定行为`
  );
  console.log(`    两轮结果一致：都在第 ${r1.trigger} 次观察触发遭遇（R1=${r1.enemy} / R2=${r2.enemy}）`);

  await browser.close();
  console.log("[E2E] observe-threat-pays PASS：保底账过线当场兑现成真实遭遇");
  process.exit(0);
} catch (e) {
  try {
    fs.mkdirSync("/root/logs", { recursive: true });
    const shot = `/root/logs/e2e-observe-threat-pays-${Date.now()}.png`;
    if (page) await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error(`[ASSERT] ${e && e.message} screenshot=${shot}`);
  } catch {
    console.error(`[ASSERT] ${e && e.message}`);
  }
  process.exit(1);
}
