#!/usr/bin/env node
// gate-prefill.mjs (F282): 刷新/重开后回到门牌页（入场/登记页）时，本机
// 存有上次代号 → 必须预填输入框或提供「继续 xxx」一键接档，玩家不再
// 凭记忆重敲代号。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），干净浏览器
//   上下文走真实「觉醒」建档，推进若干步后清除存档 id 绑定
//   （solo_leveling_save_id，模拟重开/换端回登记页场景）再 reload：
//     a) 门牌页 .gate-form input 的 value === 上次代号；或
//     b) 门牌页存在文案含该代号的按钮，点击一次即接入存档（.status
//        出现），全程零键盘输入。
//   两者皆无 → FAIL。
//
//   旧码红证：门牌页 input 为受控空串、页面无任何含代号按钮——(a)(b)
//   均不成立 → FAIL（已用 git stash 实测：旧码报「input value 为空且
//   无含代号按钮」）。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f282-"));
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
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
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
    console.error(`[E2E] gate-prefill: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave, stageCount } = await import("./lib.mjs");

const NAME = "预填者282";

// 推进一步：「探索前进」可点则点；must_choose 置灰则点第一个选项
// （口径同 action.mjs 的 F247 分支）。
async function advanceOnce(page) {
  const n0 = await stageCount(page);
  const advBtn = page.locator(".actions-main .btn", { hasText: "探索前进" }).first();
  const choice = page.locator(".btn-group-choice > .btn").first();
  if ((await advBtn.count()) > 0 && !(await advBtn.isDisabled())) {
    await advBtn.click();
  } else if ((await choice.count()) > 0) {
    await choice.click();
  } else {
    return; // 无推进手段（如交战态）——本轮跳过
  }
  await page
    .waitForFunction(
      (n) =>
        document.querySelectorAll(".stage-col > *").length > n &&
        !document.querySelector(".pending"),
      n0,
      { timeout: 8000 }
    )
    .catch(() => {});
}

run("gate-prefill", async ({ page }) => {
  await createSave(page, NAME);
  await page.waitForSelector(".status");

  // 推进到第 2 章附近：连按数次「探索前进」，遇选项点第一个。
  for (let i = 0; i < 8; i++) await advanceOnce(page);

  // 模拟重开/解绑后回登记页：清掉存档 id 绑定（F159「重新登记」同口径），
  // 再刷新——门牌页应在本机存的代号上做文章。
  await page.evaluate(() => localStorage.removeItem("solo_leveling_save_id"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".gate-form input");

  const inputVal = await page.inputValue(".gate-form input");
  const prefilled = inputVal === NAME;
  console.log(
    `    [gate] 门牌页 input value=${JSON.stringify(inputVal)} 预填命中=${prefilled}`
  );

  // 含代号的接档按钮（如「继续 预填者282」/「继续「预填者282」」）。
  const contBtn = page.locator(".gate-body .btn, .gate-body button").filter({ hasText: NAME });
  const contCount = await contBtn.count();
  console.log(`    [gate] 含代号按钮数=${contCount}`);

  if (!prefilled && contCount === 0) {
    throw new Error(
      `[ASSERT] 门牌页既未预填代号（input=${JSON.stringify(inputVal)}）也无含「${NAME}」的接档按钮`
    );
  }

  if (contCount > 0) {
    // 一键继续：点击一次即进存档，全程不碰键盘。
    await contBtn.first().click();
    await page.waitForSelector(".status");
    const resumedName = await page.locator(".status-name").innerText().catch(() => "");
    assert(
      resumedName.includes(NAME),
      `一键继续后接入存档代号不符：${JSON.stringify(resumedName)}`
    );
    console.log(`    [gate] 一键继续接档成功（${resumedName.trim()}）`);
  }
}, { viewport: { width: 390, height: 844 } });
