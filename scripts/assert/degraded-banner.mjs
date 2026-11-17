#!/usr/bin/env node
// F118 AI 降级提示契约（UI，第三版——F175 修订：AI 网关线上已启用，
// 「本环境恰好没 key」的假降级前提不再成立）：
//
//   F174 散文快路径后，自然语言长句不打 AI 网关——无论是否配 key，
//   叙事回包都不再带 degraded:true；且客户端只把叙事长句分流到
//   /ai-action，唯一能降级的指令形态走 /action。「经真实 UI 触发降级」
//   在 F174 之后已不存在，本断言因此拆成两段：
//
//   Part A · 隔离无 key 实例（本脚本内 spawn 自起自停）：空闲端口 +
//     DB_PATH=<tmp>/game.db + OPENCODE_GO_*/AI_ALIYUN_* 置空（置空串而
//     非 delete——load-env 不覆盖已定义键，空串同时挡住根 .env 注回）。
//     POST /ai-action 指令形态「遭遇哥布林」→ 回包必须 degraded:true
//     且正文回显原句（降级链路的 API 级正向证据）；同实例上散文长句
//     /ai-action 正文必须是具象否认（含「碎片」+ 否认词、无「重新审视」），
//     确认快路径在降级可发生的环境下仍不走 observe 模板。
//
//   Part B · UI 契约（E2E_BASE_URL，默认 https://openfolio.uk/game）：
//     page.route 拦截 /api/ai-action，把真实回包 degraded 置 true——
//     这正是网关降级时客户端会收到的回包形态，(a)–(d) UI 断言原强度：
//     (a) 尾注只盖在本会话第一条降级气泡尾部，第二条起不再追加；
//     (b) 状态栏一次性细条「叙事引擎：规则模式（AI 暂不可用）· 点 ×
//         收起」，× 收起后本会话不再出现（再降级也不复发）；
//     (c) 从未访问 /ai-action 的新档不得出现横幅/尾注；
//     (d) 390px 下横幅单行不换行、不遮输入框与行动按钮、页面无横向
//         溢出，全程无 console error。
import net from "node:net";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COMMAND_INPUT = "遭遇哥布林"; // 指令形态：echoRequired→true，打 AI 网关
const PROSE_INPUT = "我蹲下身，捡起地上一枚发烫的碎片";

const { run, createSave, assert, BASE_URL } = await import("../e2e/lib.mjs");

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function postTo(base, pathname, body, ms = 25000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(`${base}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {}
    return { status: res.status, body: json };
  } finally {
    clearTimeout(timer);
  }
}

// ── Part A：隔离无 key 实例 —— degraded:true 的 API 级证据 ────────────
const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f118-"));
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: path.join(tmpDir, "game.db"),
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

const ISO = `http://127.0.0.1:${gamePort}/game/api`;
{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${ISO}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[F118] 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

try {
  const { status: ss, body: sv } = await postTo(ISO, "/saves", {
    player_name: `f118-${Date.now().toString(36)}`.slice(0, 20),
  });
  assert(ss === 201 && sv && sv.save && sv.save.id, `隔离实例建存档失败 HTTP ${ss}`);
  const sid = sv.save.id;

  const { status: ds, body: d } = await postTo(ISO, "/ai-action", {
    save_id: sid,
    input: COMMAND_INPUT,
  });
  const textD = d && d.reply && d.reply.content;
  assert(
    ds === 200 && d && d.degraded === true,
    `隔离无 key 实例 /ai-action 未 degraded:true：${JSON.stringify(d).slice(0, 200)}`
  );
  assert(
    typeof textD === "string" && textD.includes(COMMAND_INPUT),
    `隔离实例降级回包未回显原句「${COMMAND_INPUT}」：${String(textD).slice(0, 160)}`
  );
  console.log(`    [iso] /ai-action degraded:true：${textD.split("\n")[0].slice(0, 90)}`);

  const { status: ps, body: p } = await postTo(ISO, "/ai-action", {
    save_id: sid,
    input: PROSE_INPUT,
  });
  const textP = p && p.reply && p.reply.content;
  assert(
    ps === 200 &&
      typeof textP === "string" &&
      textP.includes("碎片") &&
      /没有|不存在/.test(textP) &&
      !textP.includes("重新审视"),
    `隔离实例散文回包不是具象否认：${String(textP).slice(0, 160)}`
  );
  console.log(`    [iso] 散文回包（快路径，非降级）：${textP.split("\n")[0].slice(0, 90)}`);
} catch (e) {
  console.error(`[F118] Part A FAIL: ${e.message}`);
  process.exit(1);
} finally {
  try {
    child.kill("SIGKILL");
  } catch {}
}

// ── Part B：UI 契约 —— 拦截 /api/ai-action 注入 degraded:true ─────────
const NAME = `F118-${Date.now().toString(36)}`;
const NAME2 = `F118b-${Date.now().toString(36)}`;
// 必须避开指令信号词（攻击/前进/观察/数字等），否则客户端分流去 /action。
const SENTENCES = [
  "我蹲下身，捡起地上一枚发烫的碎片",
  "我抬头望向通道尽头，仔细听远处的动静",
  "我把碎片收进口袋，贴着墙根慢慢挪动脚步",
];

// 发一句自然语言长句并等回包落到日志（busy 态解除）。
async function sendSentence(page, sentence) {
  await page.fill(".input-row input", sentence);
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/api/ai-action") && r.request().method() === "POST"
    ),
    page.press(".input-row input", "Enter"),
  ]);
  await resp.finished().catch(() => {});
  const body = await resp.json().catch(() => null);
  assert(body && body.degraded === true, `/ai-action 回包未带 degraded:true：${JSON.stringify(body).slice(0, 200)}`);
  await page.waitForFunction(() => !document.querySelector(".pending"));
}

const noOverflow = (page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth === document.documentElement.clientWidth
  );

run(
  "degraded-banner",
  async ({ page }) => {
    const consoleErrs = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrs.push(m.text());
    });
    page.on("pageerror", (e) => consoleErrs.push(String(e)));

    // 显式制造降级：透传真实回包、仅把 degraded 置 true——与「网关
    // 降级」时客户端收到的回包形态逐字段一致。
    await page.route("**/api/ai-action", async (route) => {
      const resp = await route.fetch();
      let body = null;
      try {
        body = await resp.json();
      } catch {}
      if (body && typeof body === "object") {
        body.degraded = true;
        await route.fulfill({ response: resp, json: body });
      } else {
        await route.fulfill({ response: resp });
      }
    });

    await createSave(page, NAME);
    await page.waitForSelector(".input-row input");

    // ── 第一句降级长句：首条气泡带尾注 + 一次性细条出现 ──
    await sendSentence(page, SENTENCES[0]);

    await page.waitForSelector(".degraded-note", { timeout: 8000 });
    assert(
      (await page.locator(".degraded-note").count()) === 1,
      "(a) 首条降级气泡尾注数量异常"
    );
    const note = await page.locator(".degraded-note").last().innerText();
    assert(
      note.includes("系统叙事降级：按规则解析"),
      `(a) 尾注文案不符：${note}`
    );

    const banner = page.locator(".degraded-banner");
    assert((await banner.count()) === 1, "(b) 一次性降级细条未出现");
    const bannerText = (await banner.innerText()).trim();
    assert(
      bannerText.includes("规则模式"),
      `(b) 细条文案不符：${bannerText}`
    );
    assert(await banner.isVisible(), "(b) 降级细条不可见");

    // 不挡输入框与行动按钮：细条整体在输入行上方（几何不重叠）。
    const bb = await banner.boundingBox();
    const ib = await page.locator(".input-row input").boundingBox();
    const ab = await page
      .locator(".actions-main .btn", { hasText: "探索前进" })
      .first()
      .boundingBox();
    assert(bb && ib && ab, "(b) 无法读取细条/输入框/按钮几何");
    assert(
      bb.y + bb.height <= ib.y && bb.y + bb.height <= ab.y,
      `(b) 细条与输入行/行动按钮重叠：banner y=${bb.y}+${bb.height}, input y=${ib.y}, action y=${ab.y}`
    );
    assert(
      await page.locator(".input-row input").isEnabled(),
      "(b) 降级后输入框不可用"
    );

    // 390px：细条单行、页面无横向溢出。
    assert(await noOverflow(page), "(d) 390px 下出现横向溢出");
    const bannerLines = await banner.evaluate(
      (el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    );
    assert(bannerLines <= 1, `(d) 390px 下细条折成 ${bannerLines} 行`);

    // ── 第二句降级长句：不再追加尾注 ──
    await sendSentence(page, SENTENCES[1]);
    assert(
      (await page.locator(".degraded-note").count()) === 1,
      "(a) 第二条降级回包仍追加尾注"
    );
    assert(await noOverflow(page), "(d) 第二句后出现横向溢出");

    // ── × 收起：细条消失且本会话不复发 ──
    await page.click(".degraded-banner-close");
    assert(
      (await page.locator(".degraded-banner").count()) === 0,
      "(b) × 收起后细条仍存在"
    );
    await sendSentence(page, SENTENCES[2]);
    assert(
      (await page.locator(".degraded-banner").count()) === 0,
      "(b) 收起后再降级细条复发"
    );
    assert(await noOverflow(page), "(d) 收起后出现横向溢出");

    // ── 刷新：会话态重置，页面正常不报错 ──
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");

    // ── (c) 从未访问 /ai-action 的新档：横幅/尾注都不存在 ──
    await page.evaluate(() => localStorage.clear());
    await createSave(page, NAME2);
    await page.waitForSelector(".input-row input");
    const body2 = await page.locator("body").innerText();
    assert(
      !body2.includes("规则模式") && !body2.includes("系统叙事降级"),
      "(c) 未降级的新档出现降级文案"
    );
    assert(
      (await page.locator(".degraded-banner, .degraded-note").count()) === 0,
      "(c) 未降级的新档渲染了 .degraded-banner/.degraded-note"
    );
    assert(await noOverflow(page), "(d) 新档出现横向溢出");

    assert(consoleErrs.length === 0, `console error: ${consoleErrs.join(" | ")}`);
    console.log(`    降级提示：首条尾注+一次性细条，× 收起不复发，新档干净（目标 ${BASE_URL}）`);
  },
  { viewport: { width: 390, height: 844 } }
);
