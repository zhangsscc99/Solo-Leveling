#!/usr/bin/env node
// resume-log-count.mjs (F227): 刷新续档不得丢非豁免日志行——
//
//   第 47 轮走查实测：战斗 + 一次抉择后 .stage-col 有 64 个日志行，
//   page.reload() 后只剩 55——丢的是战斗行与叙述行（非回执），最后
//   一条逐字相同、HP/MP/XP/金币全对，即丢的是日志节点而非数值。
//   根因：续档/切档回灌只取末 50 条（LOG_PAGE），内存里累积超窗的
//   行回灌后凭空消失。修法：回灌放宽为整窗 LOG_CAP（服务端硬上限
//   200），「加载更早」入口保留。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空，客户端
//   dist 为本 worktree 构建产物）：
//     a) UI 建档 → 「攻击」空挥不耗冷却循环逼出真实遭遇 → 「攻击」
//        打到战斗结束（reload-log-parity 同循环）；
//     b) 沿主线「前进」，被 must_choose 拒绝时按 mustChoosePick
//        真实点击一个主线选项键——日志因此超过 50 行（n0 > 50 是
//        本断言能对旧码显红的前提，不达标直接 FAIL）；
//     c) 记录 .stage-col > :not(.holo-ephemeral) 的条数 n0 与末 3
//        条 innerText；
//     d) page.reload()，等日志回灌完成（.stage-col 子节点数连续
//        两次采样稳定，不死等固定毫秒）；
//     e) 断言 n1 === n0 且末 3 条逐字相同；豁免行数 <= 2 且每条
//        innerText 命中 F222 白名单正则（白名单不得扩大）。
//
//   豁免类别（与 F222 同口径）：.holo-ephemeral——仅内存态的本地
//   回执行（抽屉展开回执 / 断线警报），服务端不落库，刷新后按设计
//   消失。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f227-"));
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

const BASE = `http://127.0.0.1:${port}/game`;
const API = `${BASE}/api`;
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
    console.error(`[E2E] resume-log-count: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL / API_BASE 须在 lib.mjs / _http.mjs 求值前落定。
process.env.E2E_BASE_URL = BASE;
process.env.API_BASE = API;
const { run, assert, createSave } = await import("./lib.mjs");
const { fetchSaveView, mustChoosePick } = await import("../assert/_http.mjs");

// 觉醒输入框 maxLength=20：名字必须带 Date.now().toString(36) 且 ≤20 字。
const NAME = `f227-${Date.now().toString(36)}`;
const EXEMPT = ".holo-ephemeral";
// F222 豁免白名单（闭集）：豁免行只能是点名的两种回执，innerText 必须
// 命中该正则——class 是运行时可控的，仅靠 class 不够。本轮不得扩大。
const EXEMPT_TEXT = /已调出(技能|道具)面板|【警报】与系统的连接中断/;
const EXEMPT_MAX = 2;
// 回灌窗口旧值：n0 必须超过它，否则旧码也能假绿。
const OLD_PAGE = 50;

// .stage-col 直接子节点中剔除豁免类后的 [数量, 文本列表, 豁免行文本列表]。
const snapshot = async (page) => {
  const [n, texts] = await page
    .locator(`.stage-col > :not(${EXEMPT})`)
    .evaluateAll((els) => [els.length, els.map((el) => el.innerText)]);
  const exemptTexts = await page
    .locator(`.stage-col > ${EXEMPT}`)
    .evaluateAll((els) => els.map((el) => el.innerText));
  return [n, texts, exemptTexts];
};

const assertExemptClosed = (exemptTexts) => {
  assert(
    exemptTexts.length <= EXEMPT_MAX,
    `exempt row count ${exemptTexts.length} > ${EXEMPT_MAX}: ${JSON.stringify(exemptTexts)}`
  );
  for (const t of exemptTexts) {
    assert(EXEMPT_TEXT.test(t), `exempt row out of whitelist: ${JSON.stringify(t)}`);
  }
};

async function send(page, text) {
  await page.fill(".input-row input", text);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  return resp.json().catch(() => null);
}

// 真实点击主线选项键：mustChoosePick 只挑落点仍在本章主线链上的选项
// （支线分支绝不代选）。点击按 next_choices 的下标定位按钮——label 可能
// 互为子串，文本匹配不可靠。点不中回 false，调用方继续推进。
async function clickChoice(page, saveId, pick) {
  const { save } = await fetchSaveView(saveId);
  const list = Array.isArray(save.next_choices) ? save.next_choices : [];
  const idx = list.findIndex((c) => c && c.id === pick.id);
  if (idx < 0) return false;
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/action") && r.request().method() === "POST"),
    page.locator(".btn-group-choice .btn").nth(idx).click(),
  ]);
  await resp.finished().catch(() => {});
  return true;
}

await run("resume-log-count", async ({ page }) => {
  await createSave(page, NAME);
  const saveId = Number(await page.evaluate(() => localStorage.getItem("solo_leveling_save_id")));
  assert(Number.isFinite(saveId) && saveId > 0, `save id unreadable: ${saveId}`);

  // ── a) 逼出真实遭遇：「攻击」空挥不耗冷却时循环「前进」磨遭遇 ──
  let engaged = false;
  for (let i = 0; i < 30 && !engaged; i++) {
    const r = await send(page, "攻击");
    if (r && r.save && r.save.combat) {
      engaged = true;
      break;
    }
    const s = r && r.save ? r.save : (await fetchSaveView(saveId)).save;
    const ra = await send(page, "前进");
    if (ra && ra.refused === true) {
      const pick = mustChoosePick((ra.save && ra.save.scene) || s.scene);
      if (pick) await send(page, `选择 ${pick.id}`);
    }
    if (ra && ra.save && ra.save.combat) engaged = true;
    await page.waitForTimeout(300);
  }
  assert(engaged, "never entered combat within 30 actions");

  // ── 打到战斗结束（阵亡/逃跑/击杀任一收场都算真实战斗）──
  let ended = false;
  for (let i = 0; i < 40 && !ended; i++) {
    const r = await send(page, "攻击");
    if (!r || !r.save || !r.save.combat) ended = true;
    await page.waitForTimeout(250);
  }
  assert(ended, "combat never ended within 40 attacks");
  await page.waitForSelector(".pending", { state: "detached" }).catch(() => {});
  console.log(`[i] first combat ended, stage-col non-exempt rows: ${(await snapshot(page))[0]}`);

  // ── b) 推进主线直到完成一次真实抉择且日志条目数 > 50 ──
  // 途中撞遭遇就打到底（同 a 的攻击循环）；must_choose 拒绝时按
  // mustChoosePick 真实点击主线选项键。
  // 注意口径：旧码截断的是服务端日志【条目】（getLog LIMIT 50），而
  // .stage-col 子节点是【拆分后的段】——一条日志可渲染成多行，行数
  // >50 不代表条目 >50（旧码照样全量回灌、假绿）。截断是否发生以
  // 服务端条目数为准。
  const logLen = async () => {
    const r = await fetch(`${API}/saves/${saveId}/log?limit=200`, {
      signal: AbortSignal.timeout(5000),
    });
    const b = await r.json().catch(() => null);
    return r.ok && b && Array.isArray(b.log) ? b.log.length : -1;
  };
  let chose = false;
  for (let i = 0; i < 80; i++) {
    const entries = await logLen();
    const [n] = await snapshot(page);
    if (chose && entries > OLD_PAGE && n > OLD_PAGE) break;
    const { save: sv } = await fetchSaveView(saveId);
    if (sv.combat) {
      await send(page, "攻击");
    } else {
      const r = await send(page, "前进");
      if (r && r.refused === true) {
        const pick = mustChoosePick(r.save && r.save.scene ? r.save.scene : sv.scene);
        if (pick && (await clickChoice(page, saveId, pick))) {
          chose = true;
          console.log(`[i] choice taken at scene ${sv.scene} -> ${JSON.stringify(pick.label || pick.id)}`);
        }
      }
    }
    await page.waitForTimeout(250);
  }
  await page.waitForSelector(".pending", { state: "detached" }).catch(() => {});
  assert(chose, "never reached a must_choose decision within 80 actions");

  // ── c) 刷新前快照：服务端条目数必须 > 50——旧码只回灌末 50 条，
  // 条目不超窗时新旧行为一致、断言显不了红。 ──
  const entries0 = await logLen();
  const [n0, texts0, exempt0] = await snapshot(page);
  assert(
    entries0 > OLD_PAGE,
    `server log entries ${entries0} <= ${OLD_PAGE}：未超出旧回灌窗口，断言对旧码显不了红`
  );
  assert(
    n0 > OLD_PAGE,
    `stage-col non-exempt rows ${n0} <= ${OLD_PAGE}：渲染行未超窗，覆盖不了走查场景`
  );
  const tail0 = texts0.slice(-3);
  assertExemptClosed(exempt0);
  console.log(`[i] before reload: n0=${n0} rows (server entries=${entries0}, exempt=${exempt0.length})`);

  // ── d) 刷新续档：等回灌稳定（子节点数连续两次采样不再变）──
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForSelector(".stage-col > *");
  await page.waitForSelector(".pending", { state: "detached" }).catch(() => {});
  {
    let prev = -1;
    let stable = 0;
    let settled = 0;
    for (let i = 0; i < 60; i++) {
      const n = await page.evaluate(() => {
        const el = document.querySelector(".stage-col");
        return el ? el.children.length : 0;
      });
      if (n === prev && n > 0) {
        stable += 1;
        if (stable >= 2) {
          settled = n;
          break;
        }
      } else {
        stable = 0;
      }
      prev = n;
      await page.waitForTimeout(150);
    }
    assert(settled > 0, "stage-col children never settled after reload");
  }

  // ── e) 刷新后断言 ──
  const [n1, texts1, exempt1] = await snapshot(page);
  const tail1 = texts1.slice(-3);
  assertExemptClosed(exempt1);
  console.log(`[i] after reload: n1=${n1} (exempt=${exempt1.length})`);
  if (n1 !== n0 || JSON.stringify(tail1) !== JSON.stringify(tail0)) {
    const minLen = Math.min(texts0.length, texts1.length);
    let firstDiff = -1;
    for (let i = 0; i < minLen; i++) {
      if (texts0[i] !== texts1[i]) {
        firstDiff = i;
        break;
      }
    }
    console.error(`[E2E] resume-log-count mismatch: n0=${n0} n1=${n1} firstDiff=${firstDiff}`);
    if (firstDiff >= 0) {
      console.error(`  before[${firstDiff}]: ${JSON.stringify(texts0[firstDiff])}`);
      console.error(`  after [${firstDiff}]: ${JSON.stringify(texts1[firstDiff])}`);
    }
    console.error(`  before tail: ${JSON.stringify(tail0)}`);
    console.error(`  after  tail: ${JSON.stringify(tail1)}`);
  }
  assert(
    n1 === n0,
    `.stage-col 非豁免子节点数刷新前后不一致：${n0} -> ${n1}`
  );
  assert(
    JSON.stringify(tail1) === JSON.stringify(tail0),
    `最后 3 条文本不一致：\n  before: ${JSON.stringify(tail0)}\n  after : ${JSON.stringify(tail1)}`
  );
  console.log(`[OK] resume parity: ${n0} -> ${n1} nodes, last3 identical (exempt ${exempt0.length}->${exempt1.length})`);
});
