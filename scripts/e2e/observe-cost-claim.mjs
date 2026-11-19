#!/usr/bin/env node
// observe-cost-claim.mjs (F308): 「环顾四周」宣称的代价与实扣必须一致——
//
//   第 105 轮真实玩家走查：交互区「环顾四周」按钮/提示自称「不耗体力
//   魔力 · 免费×N」，但点完一次观察后正文区仍留着一句无主语的机制括
//   注「（体力消耗 HP 100→97 · MP 20→18）」，同屏两套说法，玩家无法把
//   扣点归因到任何一次动作（intuitive-game-design Q2 False affordance；
//   game-detail-bar §9a「Explain before the player commits」）。
//
//   诊断结论（本脚本即按此设计）：「（体力消耗…）」不是观察写的——
//   观察全程 patch:null（前 OBSERVE_TOTAL 次免费，复核区只推进
//   encounter_clock）；括注由「前进/选择」的真实推进产生（vitalsCost
//   + ADVANCE_HP_COST/ADVANCE_MP_COST），只是注脚本身没有主语，又跟
//   「免费×3」同屏相邻才被误读成观察扣血。修法是给注脚带上动作主语
//   ——断言 C 钉的正是「扣点括注必须能归因」。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空，骨架照抄
//   observe-cost.mjs / prose-hygiene.mjs），390×844 与 1440×900 各跑
//   一遍同一流程：
//     0) 干净档进第一章，读 button[data-act="观察"] 键面文本/title 与
//        [data-observe-cost] 角标，记下它宣称的代价；
//     A) 在免费次数内（按服务端 free_left，不写死魔数）真实点「环顾
//        四周」：每次点击后 save.hp/mp 与点击前完全相等，且该次新增
//        的所有 .log-entry innerText 不命中机制括注
//        /（[^）]*(体力消耗|HP\s*\d+→\d+|MP\s*\d+→\d+)/；
//     B) 用尽免费次数后再点一次：free_left===0，且按钮/角标/提示文案
//        已换成非「免费」口径（防写死文案）；宣称的 N 与实际免费点击
//        数一致；
//     C) 制造一次真实推进（ch1_law 主线选项，encounter_cd 压住遭遇
//        掷点）拿到含「（体力消耗…）」的条目——该条目必须把扣点归
//        因给推进动作：剔除【…】元信息行后仍含 前进|推进|下一幕|过门
//        之一，否则 FAIL 并打印该 entry 全文（旧码注脚无主语，红证）。
//        再点一次「环顾四周」复验 A——同屏既有扣点条目又有免费宣称
//        时，两套说法仍能各自归因。
//
//   旧码红证见 F308 落地记录；新码 PASS。
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

// 前端由 server 以 client/dist 静态托管——本断言验的是本 worktree 的
// 客户端，dist 缺失或是外部软链时先补构建（observe-cost-disclosed 同口径）。
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
      console.error("[E2E] observe-cost-claim: client/dist 缺失且 npm --prefix client run build 失败");
      process.exit(1);
    }
  }
}

// Oracle：第一章主线链上第一个 must_choose 场景与其主线选项（不经被
// 测引擎）——用它制造一次真实付费推进，拿到含「（体力消耗…）」的条目。
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const ch1Ids = new Set(CH1.scenes.map((s) => s.id));
const CHAIN = [];
{
  const byId = new Map(CH1.scenes.map((s) => [s.id, s]));
  const seen = new Set();
  let cur = CH1.scenes[0];
  while (cur && !seen.has(cur.id)) {
    CHAIN.push(cur.id);
    seen.add(cur.id);
    let nxt =
      typeof cur.next_scene === "string" && byId.has(cur.next_scene) && !seen.has(cur.next_scene)
        ? byId.get(cur.next_scene)
        : null;
    if (!nxt) {
      const pick = (cur.choices || []).find(
        (x) => x && typeof x.next === "string" && byId.has(x.next) && !seen.has(x.next)
      );
      nxt = pick ? byId.get(pick.next) : null;
    }
    cur = nxt;
  }
}
const MC = CH1.scenes.find((s) => s.must_choose === true && CHAIN.includes(s.id));
const MC_CHOICE =
  MC && (MC.choices || []).find((x) => x && CHAIN.includes(x.next));

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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f308-"));
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
    console.error(
      `[E2E] observe-cost-claim: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`
    );
    cleanup();
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定——该模块在 import 时读取环境变量。
process.env.E2E_BASE_URL = BASE;
const { assert, run, createSave } = await import("./lib.mjs");

assert(MC && MC_CHOICE && typeof MC_CHOICE.label === "string", "oracle: ch1 must_choose 场景或主线选项缺失");

const ACTION_RESP = (r) => /\/api\/action$/.test(new URL(r.url()).pathname);
// 机制括注：任何宣称/实报 HP·MP 扣点的括号——观察回包里一条都不许有。
const MECH_NOTE_RE = /（[^）]*(体力消耗|HP\s*\d+→\d+|MP\s*\d+→\d+)/;
// 断言 C：含「（体力消耗…）」括注的条目（无主语扣点）——归属判据见下。
const COST_PAREN_RE = /（体力消耗[^）]*）/;
const OWNER_RE = /前进|推进|下一幕|过门/;
// 【…】行头是元信息段（任务/遭遇/系统），不是扣点的归属主语——判据只看
// 叙事部分，防止「【任务】推进战线」这类板子把无主语注脚洗成已归因。
const META_LINE_RE = /^【/;

async function fetchSave(id) {
  const r = await fetch(`${API}/saves/${id}`, { signal: AbortSignal.timeout(5000) });
  const body = await r.json().catch(() => null);
  assert(r.ok && body && body.save, `GET /saves/${id} failed (HTTP ${r.status})`);
  return body.save;
}

run("observe-cost-claim", async ({ page }) => {
  const waitIdle = () => page.waitForFunction(() => !document.querySelector(".pending"));
  const entryCount = () => page.locator(".stage-col .log-entry").count();
  const newEntries = (from) =>
    page.locator(".stage-col .log-entry").evaluateAll(
      (els, f) => els.slice(f).map((e) => e.innerText),
      from
    );

  for (const vp of [
    { width: 390, height: 844, tag: "390x844" },
    { width: 1440, height: 900, tag: "1440x900" },
  ]) {
    console.log(`\n── viewport ${vp.tag} ──`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.evaluate(() => localStorage.clear()).catch(() => {});
    await createSave(page, `e2e-f308-${vp.tag}-${Date.now().toString(36)}`);
    await waitIdle();
    const saveId = await page.evaluate(() => Number(localStorage.getItem("solo_leveling_save_id")));
    assert(saveId > 0, "save_id missing in localStorage");

    // ── (0) 记下「环顾四周」宣称的代价 ────────────────────────────
    const obsBtn = page.locator('button[data-act="观察"]').first();
    assert((await obsBtn.count()) > 0, `[${vp.tag}] 找不到「环顾四周」行动键`);
    const btnText = (await obsBtn.innerText()).replace(/\s+/g, " ").trim();
    const btnTitle = (await obsBtn.getAttribute("title")) || "";
    const badgeEl = page.locator("[data-observe-cost]").first();
    const badge =
      (await badgeEl.count()) > 0 ? (await badgeEl.innerText()).trim() : "";
    console.log(
      `[${vp.tag}] 宣称: btn="${btnText}" badge="${badge}" title="${btnTitle}"`
    );
    const claimBlob = `${btnText} ${badge} ${btnTitle}`;
    const freeClaim = /免费[×x]?(\d+)/.exec(claimBlob);

    // ── (A) 免费次数内逐点「环顾四周」：hp/mp 不动、新条目零机制括注 ──
    let freeClicks = 0;
    for (let guard = 0; guard < 12; guard++) {
      const s0 = await fetchSave(saveId);
      const freeLeft = Number(s0.observe && s0.observe.free_left) || 0;
      if (freeLeft <= 0) break;
      const n0 = await entryCount();
      const respP = page.waitForResponse(ACTION_RESP, { timeout: 15000 });
      await obsBtn.click();
      const resp = await respP;
      const body = await resp.json().catch(() => null);
      assert(body && body.reply, `[${vp.tag}] 观察回包缺 reply`);
      await waitIdle();
      freeClicks += 1;
      const s1 = await fetchSave(saveId);
      assert(
        s1.hp === s0.hp && s1.mp === s0.mp,
        `[${vp.tag}] (A) 第${freeClicks}次免费观察动了数值：HP ${s0.hp}->${s1.hp} · MP ${s0.mp}->${s1.mp}`
      );
      const added = await newEntries(n0);
      for (const t of added) {
        assert(
          !MECH_NOTE_RE.test(t),
          `[${vp.tag}] (A) 第${freeClicks}次观察新增的 .log-entry 出现机制括注：\n${t}`
        );
      }
      console.log(
        `[${vp.tag}] A ok obs#${freeClicks} hp=${s1.hp} mp=${s1.mp} free_left ${s0.observe.free_left}->${s1.observe.free_left}`
      );
    }
    assert(freeClicks > 0, `[${vp.tag}] 免费观察一次都没点上（free_left 起算即 0？）`);
    if (freeClaim) {
      assert(
        freeClicks === Number(freeClaim[1]),
        `[${vp.tag}] (B) 宣称「免费×${freeClaim[1]}」与实际免费点击数 ${freeClicks} 不一致`
      );
    }

    // ── (B) 用尽后再点一次：free_left 恒 0、口径已换非「免费」 ──────
    {
      const n0 = await entryCount();
      const respP = page.waitForResponse(ACTION_RESP, { timeout: 15000 });
      await obsBtn.click();
      const resp = await respP;
      const body = await resp.json().catch(() => null);
      assert(body, `[${vp.tag}] 用尽后追加观察回包解析失败`);
      await waitIdle();
      const s1 = await fetchSave(saveId);
      assert(
        Number(s1.observe && s1.observe.free_left) === 0,
        `[${vp.tag}] (B) 用尽后追加点击 free_left=${s1.observe && s1.observe.free_left}（应恒 0）`
      );
      const btnText2 = (await obsBtn.innerText()).replace(/\s+/g, " ").trim();
      const btnTitle2 = (await obsBtn.getAttribute("title")) || "";
      const badge2 =
        (await badgeEl.count()) > 0 ? (await badgeEl.innerText()).trim() : "";
      const hint2 = s1.observe && s1.observe.hint ? s1.observe.hint : "";
      const blob2 = `${btnText2} ${badge2} ${btnTitle2} ${hint2}`;
      assert(
        !/免费/.test(blob2),
        `[${vp.tag}] (B) 免费次数用尽后宣称仍挂「免费」口径: btn="${btnText2}" badge="${badge2}" hint="${hint2}"`
      );
      console.log(
        `[${vp.tag}] B ok 用尽后 free_left=0，口径换成 badge="${badge2}"（新增条目 ${await entryCount() - n0} 个）`
      );
    }

    // ── (C) 真实付费推进一次 → 扣点括注必须能归因 ─────────────────
    // DB 直落 ch1_law（must_choose）并拉高击杀冷却——落地掷点被压制，
    // 主线选项一按就是一次干净的真实推进（vit 扣点、零遭遇）。
    {
      const Database = require("better-sqlite3");
      const db = new Database(dbPath);
      try {
        db.prepare(
          "UPDATE saves SET scene = ?, encounter_cd = 9, encounter_clock = 0 WHERE id = ?"
        ).run(MC.id, saveId);
        db.prepare("DELETE FROM combat WHERE save_id = ?").run(saveId);
      } finally {
        db.close();
      }
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForSelector(".btn-group-choice");
    await waitIdle();

    const choiceBtn = page
      .locator(".btn-group-choice .btn", { hasText: MC_CHOICE.label })
      .first();
    assert(
      (await choiceBtn.count()) > 0,
      `[${vp.tag}] 主线选项键未渲染：「${MC_CHOICE.label}」（scene=${MC.id}）`
    );
    {
      const s0 = await fetchSave(saveId);
      const respP = page.waitForResponse(ACTION_RESP, { timeout: 15000 });
      await choiceBtn.click();
      const resp = await respP;
      const body = await resp.json().catch(() => null);
      assert(body && body.reply, `[${vp.tag}] 主线选项回包缺 reply`);
      assert(
        !(body.save && body.save.combat),
        `[${vp.tag}] (C) 冷却压制下仍掷出遭遇——setup 前提不成立`
      );
      await waitIdle();
      const s1 = await fetchSave(saveId);
      assert(
        s1.hp < s0.hp || s1.mp < s0.mp,
        `[${vp.tag}] (C) setup 推进未扣点（HP ${s0.hp}->${s1.hp} · MP ${s0.mp}->${s1.mp}）`
      );
      console.log(
        `[${vp.tag}] setup 真实推进：HP ${s0.hp}->${s1.hp} · MP ${s0.mp}->${s1.mp}`
      );
    }

    // 全日志扫描：任何带「（体力消耗…）」括注的条目，其叙事部分必须含
    // 推进主语——无主语扣点括注 = 玩家归因无门（本断言要拦的东西）。
    {
      const all = await page
        .locator(".stage-col .log-entry")
        .evaluateAll((els) => els.map((e) => e.innerText));
      const costEntries = all.filter((t) => COST_PAREN_RE.test(t));
      assert(
        costEntries.length >= 1,
        `[${vp.tag}] (C) setup 后找不到含「（体力消耗…）」的条目——归属断言无从生效`
      );
      for (const t of costEntries) {
        const narrative = t
          .split("\n")
          .filter((l) => !META_LINE_RE.test(l.trim()))
          .join("\n");
        assert(
          OWNER_RE.test(narrative),
          `[${vp.tag}] (C) 无主语的扣点括注——含「（体力消耗…）」的条目未归因到推进动作：\n${t}`
        );
      }
      console.log(
        `[${vp.tag}] C ok ${costEntries.length} 条扣点括注全部归因到推进动作`
      );
    }

    // ── 同屏复验：扣点条目与「免费×N」宣称并存时再点观察，A 仍成立 ──
    {
      const s0 = await fetchSave(saveId);
      const freeLeft = Number(s0.observe && s0.observe.free_left) || 0;
      assert(
        freeLeft > 0,
        `[${vp.tag}] 新场景免费次数应重置（free_left=${freeLeft}）`
      );
      const n0 = await entryCount();
      const respP = page.waitForResponse(ACTION_RESP, { timeout: 15000 });
      const obsBtn2 = page.locator('button[data-act="观察"]').first();
      await obsBtn2.click();
      const resp = await respP;
      const body = await resp.json().catch(() => null);
      assert(body && body.reply, `[${vp.tag}] 复验观察回包缺 reply`);
      await waitIdle();
      const s1 = await fetchSave(saveId);
      assert(
        s1.hp === s0.hp && s1.mp === s0.mp,
        `[${vp.tag}] (A·复验) 同屏扣点条目下观察动了数值：HP ${s0.hp}->${s1.hp} · MP ${s0.mp}->${s1.mp}`
      );
      for (const t of await newEntries(n0)) {
        assert(
          !MECH_NOTE_RE.test(t),
          `[${vp.tag}] (A·复验) 观察新增的 .log-entry 出现机制括注：\n${t}`
        );
      }
      console.log(
        `[${vp.tag}] A·复验 ok 扣点条目与「免费×${freeLeft}」同屏，观察 HP ${s0.hp}→${s1.hp} 零变化`
      );
    }
  }
});
