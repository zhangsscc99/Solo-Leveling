#!/usr/bin/env node
// free-input-behind-drawer.mjs (F285): 档案抽屉展开时，底部自由输入框
// 不得静默吞指令——
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），干净档走真实
//   「觉醒」建档路径进第一幕。流程（390×844 与 1440×900 各一遍）：
//     1) 点 .btn-group-sys 的 [data-act=inventory] 打开档案面板；
//     2) 向 input[aria-label="自由行动输入"] 写入自由文本（禁用态下
//        page.fill 抛错属预期，跳过）；
//     3) 经 CDP Input.dispatchKeyEvent 派发真实 Enter（keyDown+keyUp，
//        windowsVirtualKeyCode:13）；
//     4) 600ms 内断言至少一条成立：
//        (a) .sys-toast 文案与派发前不同（或从无到有）；
//        (b) 输入框被清空且 .log-entry 数 / 正文长度 +1；
//        (c) 输入框 disabled===true 或 aria-disabled==="true"，且存在
//            可见原因（placeholder 含「抽屉」或 .input-hint 可见节点
//            width>0）。
//        三者皆无 → FAIL。
//     5) 390 档追加：点 .side-close 关抽屉后输入框须恢复可输入。
//
//   旧码红证：旧码输入框在抽屉打开时仍 enabled，CDP 派发的 Enter 落到
//   焦点外（抽屉点击后焦点在 body）即被表单吞掉——无 .sys-toast、正文
//   长度不变、输入框残留文本且无 disabled/原因节点，(a)(b)(c) 全灭
//   → FAIL。实测（git stash 后跑本脚本）：
//   [E2E] free-input-behind-drawer FAIL 390: Enter 后无任何回执
//   （toast 未变、正文未增、输入框未禁用且无原因文本）
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f285-"));
const env = {
  ...process.env,
  PORT: String(port),
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

{
  const deadline = Date.now() + 15000;
  let up = false;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/game/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (r.ok) {
        up = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 120));
  }
  if (!up) {
    console.error(`[E2E] free-input-behind-drawer: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

const INPUT_SEL = 'input[aria-label="自由行动输入"]';
const TEXT = "我蹲下检查石像脚边的刻痕";

// 读当前输入/toast/正文基线快照。
function snapshot() {
  const input = document.querySelector('input[aria-label="自由行动输入"]');
  const toast = document.querySelector(".sys-toast");
  const stage = document.querySelector(".stage-col");
  const hint = document.querySelector(".input-hint");
  return {
    value: input ? input.value : null,
    disabled: input ? input.disabled : null,
    ariaDisabled: input ? input.getAttribute("aria-disabled") : null,
    placeholder: input ? input.getAttribute("placeholder") || "" : "",
    toast: toast ? toast.textContent : null,
    logEntries: document.querySelectorAll(".log-entry").length,
    stageLen: stage ? (stage.innerText || "").length : 0,
    hintVisible: hint ? hint.getBoundingClientRect().width > 0 : false,
  };
}

// 任一验收口径是否已成立（返回命中的口径名或 null）。
function verdict(s, s0) {
  // (a) toast 从无到有或换文案。
  if (s.toast && s.toast !== s0.toast) return "a:toast";
  // (b) 真被派发：输入清空且日志增长（仅当文本真的写进过输入框）。
  if (s0.hadText && s.value === "" && (s.logEntries > s0.logEntries || s.stageLen > s0.stageLen))
    return "b:dispatched";
  // (c) 禁用态 + 可见原因。
  const disabled = s.disabled === true || s.ariaDisabled === "true";
  const reason = s.placeholder.includes("抽屉") || s.hintVisible;
  if (disabled && reason) return "c:disabled+hint";
  return null;
}

async function phase(page, tag, { blur = false } = {}) {
  // 打开档案面板：390 走抽屉，1440 走常驻侧栏页签（drawer 同位置真，
  // 但非遮挡抽屉——此时 Enter 应走正常派发，命中口径 b）。
  await page.click('[data-act="inventory"]');
  await page.waitForTimeout(300);

  // 写入文本——禁用态下 fill 会在超时内等 editable，收窄到 1.5s 跳过。
  await page.fill(INPUT_SEL, TEXT, { timeout: 1500 }).catch(() => {});
  if (blur) {
    // 复现走查现场：抽屉遮罩下真实手指根本点不到输入框，焦点不在其上
    // ——fill 会强制聚焦，必须主动 blur 回去再派 Enter，否则旧码会因
    // 表单正常提交而洗绿。
    await page.evaluate(() => {
      document.querySelector('input[aria-label="自由行动输入"]')?.blur();
      // 焦点彻底归零到 body——否则留在「背包」键上的 Enter 会退化成
      // 一次普通按钮激活，既不是输入回执也不是静默吞并。
      document.body.focus();
    });
  }
  const s0 = await page.evaluate(snapshot);
  s0.hadText = s0.value !== null && s0.value.includes(TEXT);

  // 真实 Enter：CDP 派发 keyDown+keyUp 到当前焦点元素。
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    text: "\r",
    unmodifiedText: "\r",
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
  });
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });

  // 600ms 窗口内轮询三种口径。
  const deadline = Date.now() + 600;
  let hit = null;
  let s = s0;
  while (Date.now() < deadline) {
    s = await page.evaluate(snapshot);
    s.hadText = s0.hadText;
    hit = verdict(s, s0);
    if (hit) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert(
    hit,
    `${tag}: Enter 后 600ms 内无任何回执——toast=${JSON.stringify(s.toast)} ` +
      `logEntries ${s0.logEntries}->${s.logEntries} stageLen ${s0.stageLen}->${s.stageLen} ` +
      `disabled=${s.disabled} aria=${s.ariaDisabled} hint=${s.hintVisible} value=${JSON.stringify(s.value)}`
  );
  console.log(`    [${tag}] 命中口径 ${hit}`);
  return { s, hit };
}

run("free-input-behind-drawer", async ({ page }) => {
  await createSave(page, `e2e-f285-${Date.now().toString(36)}`);
  await page.waitForTimeout(2000);

  // ── 390×844：抽屉态 ──────────────────────────────────
  const r390 = await phase(page, "390", { blur: true });
  assert(
    r390.hit !== "b:dispatched" || r390.s.disabled || r390.s.ariaDisabled === "true" || r390.s.toast,
    "390: 命中 b 但禁用/回执证据缺失"
  );

  // 关抽屉 → 输入框必须恢复可输入（禁用态不得残留）。
  await page.click(".side-close");
  await page.waitForTimeout(300);
  const restored = await page.evaluate(snapshot);
  assert(restored.disabled === false, "390: 关抽屉后输入框仍 disabled");
  await page.click(INPUT_SEL);
  const focused = await page.evaluate(
    () => document.activeElement === document.querySelector('input[aria-label="自由行动输入"]')
  );
  assert(focused, "390: 关抽屉后输入框不可聚焦");

  // ── 1440×900：常驻侧栏态——点页签不是遮挡抽屉，Enter 应正常派发 ──
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(300);
  await phase(page, "1440");
}, { viewport: { width: 390, height: 844 } });
