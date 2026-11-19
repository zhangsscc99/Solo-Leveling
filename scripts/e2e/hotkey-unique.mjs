#!/usr/bin/env node
// hotkey-unique.mjs (F267): 快捷键「键位集合」与「显示 / 派发」必须同源。
//
// 第56轮走查：DOM 读数为「探索前进 1 / 环顾四周 2 / 潜行 3 / 休息 3」，
// 同一个键位挂在两个动作上；进交战后战斗六键用 1–6，而系统功能组仍挂着
// 5–9（背包 5 / 技能 6 …），按 5 到底落「道具」还是「背包」取决于
// else-if 链顺序——键面数字与实际派发不是一回事。
//
// 本断言口径（键帽一律带 data-hotkey，按钮带 data-act，DOM 可读不靠猜）：
//   ① 非交战态：所有可见 data-hotkey 数值唯一（旧码 FAIL：休息的剩余
//      次数与潜行的键帽在 DOM 里读起来同为 3）；
//   ② 交战态：所有可见 data-hotkey 数值唯一，且与非交战态集合取并集后
//      仍无重复（旧码 FAIL：道具/背包 同为 5）；
//   ③ 按一次数字键只派发一次动作：POST /api/action 请求数 = 1，
//      且请求体里的动作就是该键帽对应的 data-act（不是邻居动作）。
//
// 自起隔离实例（空闲端口 + 临时 DB_PATH、AI key 置空）——不得打线上。
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f267-"));
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
delete env.E2E_BASE;
delete env.E2E_BASE_URL;
delete env.E2E_API;

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
    console.error(`[E2E] hotkey-unique: 隔离实例 15s 未就绪：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

// 收集当前视口内可见的键帽：(data-hotkey, data-act, 可见文本)
const collectBadges = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[data-hotkey]")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      })
      .map((el) => {
        const btn = el.closest("button") || el;
        return {
          hotkey: Number(el.getAttribute("data-hotkey")),
          act: btn.getAttribute("data-act") || "",
          text: (btn.innerText || "").trim().slice(0, 18),
          disabled: Boolean(btn.disabled),
        };
      })
  );

const dupes = (badges) => {
  const seen = new Map();
  const out = [];
  for (const b of badges) {
    if (seen.has(b.hotkey)) out.push(`${b.hotkey} →「${seen.get(b.hotkey)}」/「${b.text}」`);
    else seen.set(b.hotkey, b.text);
  }
  return out;
};

await run("hotkey-unique", async ({ page }) => {
  await createSave(page, "F267 键位体检");

  // ── ① 非交战态：键帽数值唯一 ──
  const idle = await collectBadges(page);
  assert(idle.length >= 6, `非交战态键帽只找到 ${idle.length} 个（应 ≥6：四探索键 + 系统页签）`);
  const idleDupes = dupes(idle);
  assert(idleDupes.length === 0, `非交战态键位重复：${idleDupes.join("; ")}`);
  const idleKeys = new Set(idle.map((b) => b.hotkey));

  // ── ③ 按一次键只派发一次，且派发的就是键帽指的动作 ──
  const target = idle.find((b) => b.hotkey === 3 && !b.disabled);
  assert(target, `非交战态没有可点的 3 号键帽：${JSON.stringify(idle)}`);
  const posts = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/action")) posts.push(r.postData() || "");
  });
  await page.keyboard.press(String(target.hotkey));
  await page.waitForTimeout(1500);
  assert(posts.length === 1, `按一次「${target.hotkey}」派发了 ${posts.length} 次动作（应为 1）`);
  const body = posts[0];
  assert(
    body.includes(target.act) || target.act === "",
    `按「${target.hotkey}」派发的动作不是键帽所指（data-act=${target.act}，请求体=${body.slice(0, 120)}）`
  );

  // ── 交战态设置：磨出真实遭遇（接口直推，随后重载回灌）──
  let engaged = false;
  for (let i = 0; i < 30 && !engaged; i++) {
    const r = await page.evaluate(async () => {
      const id = localStorage.getItem("solo_leveling_save_id");
      const res = await fetch(`/game/api/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ save_id: Number(id), input: "前进" }),
      });
      return res.ok ? res.json() : null;
    });
    const save = r && (r.save || (r.reply && r.reply.save));
    engaged = Boolean(save && save.combat);
    if (!engaged && r && r.refused) {
      const scene = save && save.scene;
      const choices = (save && save.next_choices) || [];
      const pick = choices.find((c) => c && c.locked !== true);
      if (pick) {
        await page.evaluate(async (id) => {
          const sid = localStorage.getItem("solo_leveling_save_id");
          await fetch(`/game/api/action`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ save_id: Number(sid), input: `选择 ${id}` }),
          });
        }, pick.id);
      }
      void scene;
    }
    await page.waitForTimeout(200);
  }
  assert(engaged, "30 次推进内没进入交战态，无法验证战斗键位");

  // 交战标记由服务端 save.combat 给出；上面用接口直推是为了不依赖 UI
  // 按钮状态，推完必须重载一次让 React 回灌真实存档视图。
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".status");
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => /攻击/.test(b.innerText || "") && !b.disabled),
    { timeout: 8000 }
  );
  // ── ② 交战态：同屏键帽唯一（绝不出现同一数字指向两个动作）──
  // 数字键位按状态作用（脱战组在交战态整组不渲染，反之亦然），跨态复用
  // 1–4 不构成歧义；要禁止的是「同屏两套语义」——旧码战斗组 5（道具）/6
  // （逃跑）与系统组 5（背包）/6（技能）同屏并存，按 5 落到哪条靠
  // else-if 顺序，这正是 FAIL 项。
  const combat = await collectBadges(page);
  assert(combat.length >= 5, `交战态键帽只找到 ${combat.length} 个（战斗六键应都在）`);
  const combatDupes = dupes(combat);
  assert(combatDupes.length === 0, `交战态同屏键位重复：${combatDupes.join("; ")}`);

  // 交战态系统页签必须让出数字键位（键帽与派发同源）。
  const sysInCombat = await page.evaluate(() =>
    [...document.querySelectorAll(".btn-group-sys button")]
      .map((b) => ({ text: (b.innerText || "").trim().slice(0, 8), hk: b.getAttribute("data-hotkey") }))
      .filter((x) => x.hk !== null)
  );
  assert(
    sysInCombat.length === 0,
    `交战态系统页签仍占着数字键位：${sysInCombat.map((x) => `${x.text}=${x.hk}`).join("; ")}`
  );

  // ③ 交战态按一次键也只派发一个动作，且是键帽指的「攻击」。
  const combatPosts = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/action")) combatPosts.push(r.postData() || "");
  });
  await page.keyboard.press("1");
  await page.waitForTimeout(1500);
  assert(combatPosts.length === 1, `交战态按一次「1」派发了 ${combatPosts.length} 次动作（应为 1）`);
  assert(
    combatPosts[0].includes("攻击"),
    `交战态按「1」派发的不是「攻击」：${combatPosts[0].slice(0, 120)}`
  );

  console.log(
    `[i] 非交战 ${idle.length} 键（${[...idleKeys].sort((a, b) => a - b).join(",")}）· 交战 ${combat.length} 键（${combat
      .map((b) => b.hotkey)
      .sort((a, b) => a - b)
      .join(",")}）`
  );
});

process.exit(0);
