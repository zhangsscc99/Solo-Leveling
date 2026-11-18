#!/usr/bin/env node
// stage-bottom-clearance.mjs (F242): 首屏正文末行不得在 .stage-col 裁剪
// 缘被「铡刀式」截断——
//
//   第49轮 vision 对 docs/runs/walk-20261118T1519Z-d2-main.png（1440×900）
//   报「正文最底部一行被底部固定操作区遮挡/截断，首屏阅读不完整」
//   （game-detail-bar §9b Layout that never spills out of its frame）。
//   实测几何（旧码、新档 F217 停顶 scroll=0、未点任何键）：
//     · 1440×900：.stage-col 裁剪缘 clipBottom=630.4 / .actions top=631.4，
//       最低可见正文 .narration top=614.0 bottom=738.8——底缘下 108.3px
//       被硬裁（矩形并不相交，padding-bottom=32 的滚到底态本来就绿：
//       末行 bottom=582.4 距 actions top 49.0px）。病在「中间滚动位/
//       首屏停顶时，框缘把文字拦腰铡断」而不是矩形相交——故断言形态
//       改成：最低可见元素越过裁剪缘时，.stage-col 必须有下缘渐隐
//       （mask-image 渐变）把越界行「溶出」而不是铡断（.status-nums
//       右缘渐隐 / .sys-fade 同一语言），且滚到底后末行仍完整、间距
//       ≥8px。旧码 mask-image=none → 本断言红。
//     · 390×844：同态红——.holo bottom=602.2 越出裁剪缘 576.4 共
//       25.8px，mask=none。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH，AI key 置空），新档由 gate
//   注册进主界面；390×844 与 1440×900 两视口各断言：
//     a) 日志不足一屏时点「探索前进」/「环顾四周」补足（最多 12 次，
//        仍未溢出才走自由输入观察兜底，绝不卡死）；
//     b) scrollTop=0 首屏停顶态：找 .stage-col 最低半可见正文元素
//        （越过裁剪缘 padding-box bottom >1px 即「被铡」）并量报越界
//        像素；容器可滚即必有某滚动位把行铡在框缘——无条件断言
//        .stage-col computed mask-image 为 linear-gradient（下缘渐
//        隐，越界行溶出而非铡断）；
//     c) scrollTop=scrollHeight 滚到底：最后一个正文子元素 bottom 不
//        越过裁剪缘（≤clipBottom+1），且与 .actions top 间距 ≥8px；
//     d) 末行矩形中心 elementFromPoint 命中须属于 .stage-col 内正文
//        （closest('.stage-col') 非空），不得命中 .actions，命中元素
//        computed position 不得为 fixed（浮层遮挡即红）；
//     e) document.documentElement.scrollWidth === clientWidth；
//     f) 反洗绿：.actions computed position 不得为 fixed/absolute
//        （遮罩式布局），且 .stage 与 .actions 矩形不重叠
//        （stage.bottom <= actions.top + 1），底栏须在视口内——
//        证明间距不是靠把底栏挪出视口骗过的。
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// 前端由 server 以 client/dist 静态托管：dist 缺失时先补构建（与
// stat-row-fit.mjs 同口径兜底）。
if (!fs.existsSync(path.join(ROOT, "client", "dist", "index.html"))) {
  const buildEnv = { ...process.env };
  delete buildEnv.NODE_CHANNEL_FD;
  delete buildEnv.NODE_CHANNEL_SERIALIZATION_MODE;
  const b = spawnSync("npm", ["--prefix", "client", "run", "build"], {
    cwd: ROOT,
    stdio: "inherit",
    env: buildEnv,
  });
  if (b.status !== 0) {
    console.error("[E2E] stage-bottom-clearance: client/dist 缺失且 npm --prefix client run build 失败");
    process.exit(1);
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f242-"));
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
    console.error(`[E2E] stage-bottom-clearance: 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

// .stage-col 内非 .pending 的直接子元素 = 正文行（narration/echo/holo…）。
const KID_SEL = ".stage-col > :not(.pending)";

// (a) 保证 .stage-col 出现纵向滚动；已溢出立即返回，不足先点行动键，
// 再退自由输入「观察」兜底——任何一步无响应都不死等。
async function ensureOverflow(page) {
  const overflowed = () =>
    page.evaluate(() => {
      const el = document.querySelector(".stage-col");
      return el ? el.scrollHeight > el.clientHeight + 4 : false;
    });
  const clickIfEnabled = async (sel) => {
    const btn = page.locator(sel).first();
    if ((await btn.count()) === 0) return false;
    const enabled = await btn.isEnabled().catch(() => false);
    if (!enabled) return false;
    await btn.click().catch(() => {});
    return true;
  };
  const waitIdle = async () => {
    await page
      .waitForFunction(() => !document.querySelector(".pending"), null, { timeout: 15000 })
      .catch(() => {});
    await page.waitForTimeout(120);
  };
  for (let i = 0; i < 12; i++) {
    if (await overflowed()) return;
    const acted =
      (await clickIfEnabled('.actions-main .btn:has-text("探索前进")')) ||
      (await clickIfEnabled('.actions-main .btn:has-text("环顾四周")')) ||
      (await clickIfEnabled(".btn-group-choice .btn")) ||
      (await clickIfEnabled('.actions-combat .btn:has-text("攻击")'));
    if (!acted) {
      await page.fill(".input-row input", "观察").catch(() => {});
      await page.press(".input-row input", "Enter").catch(() => {});
    }
    await waitIdle();
  }
  // 兜底观察/前进循环：自由输入观察不回包就换前进，仍限步数不死等。
  for (let i = 0; i < 12; i++) {
    if (await overflowed()) return;
    await page.fill(".input-row input", i % 2 ? "前进" : "观察").catch(() => {});
    await page.press(".input-row input", "Enter").catch(() => {});
    await waitIdle();
  }
  assert(
    await overflowed(),
    "24 步内 .stage-col 始终未出现纵向滚动——内容不足一屏，断言环境不成立"
  );
}

// 首屏停顶态（scrollTop=0）量「最低半可见正文元素」与下缘渐隐。
const measureTop = (page) =>
  page.evaluate((kidSel) => {
    const col = document.querySelector(".stage-col");
    const colR = col.getBoundingClientRect();
    const colCs = getComputedStyle(col);
    const clipBottom = colR.bottom - parseFloat(colCs.borderBottomWidth);
    const kids = [...col.querySelectorAll(kidSel)];
    let bottommost = null;
    for (const el of kids) {
      const r = el.getBoundingClientRect();
      if (r.top < clipBottom - 1) {
        if (!bottommost || r.top > bottommost.top) {
          bottommost = {
            cls: String(el.className).split(" ")[0],
            top: r.top,
            bottom: r.bottom,
          };
        }
      }
    }
    return {
      clipBottom,
      padB: parseFloat(colCs.paddingBottom),
      scrollTop: col.scrollTop,
      scrollH: col.scrollHeight,
      clientH: col.clientHeight,
      mask: colCs.maskImage !== "none" ? colCs.maskImage : colCs.webkitMaskImage,
      bottommost,
    };
  }, KID_SEL);

// 滚到底态：末行矩形/命中测试/框间几何/横溢。
const measureBottom = (page) =>
  page.evaluate((kidSel) => {
    const col = document.querySelector(".stage-col");
    const actions = document.querySelector(".actions");
    const stage = document.querySelector(".stage");
    const colR = col.getBoundingClientRect();
    const aR = actions.getBoundingClientRect();
    const sR = stage.getBoundingClientRect();
    const colCs = getComputedStyle(col);
    const clipBottom = colR.bottom - parseFloat(colCs.borderBottomWidth);
    const kids = [...col.querySelectorAll(kidSel)];
    const last = kids[kids.length - 1];
    const lastR = last.getBoundingClientRect();
    const cx = Math.min(Math.max(lastR.left + lastR.width / 2, 1), innerWidth - 1);
    const cy = lastR.top + lastR.height / 2;
    let hit = null;
    if (cy >= 0 && cy < innerHeight) {
      const h = document.elementFromPoint(cx, cy);
      if (h) {
        hit = {
          cls: String(h.className).slice(0, 60),
          tag: h.tagName,
          inCol: Boolean(h.closest(".stage-col")),
          inActions: Boolean(h.closest(".actions")),
          pos: getComputedStyle(h).position,
        };
      }
    }
    const de = document.documentElement;
    return {
      vh: innerHeight,
      docSW: de.scrollWidth,
      docCW: de.clientWidth,
      clipBottom,
      clientH: col.clientHeight,
      kids: kids.length,
      lastCls: String(last.className).split(" ")[0],
      lastTop: lastR.top,
      lastBottom: lastR.bottom,
      lastH: lastR.height,
      actionsTop: aR.top,
      actionsBottom: aR.bottom,
      actionsPos: getComputedStyle(actions).position,
      stageBottom: sR.bottom,
      cy,
      hit,
    };
  }, KID_SEL);

run("stage-bottom-clearance", async ({ page }) => {
  await createSave(page, `e2e-f242-${Date.now().toString(36)}`);
  await page.waitForSelector(".actions-main .btn");

  for (const [w, h] of [
    [390, 844],
    [1440, 900],
  ]) {
    const tag = `${w}x${h}`;
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(250);

    // (a) 不足一屏先补足日志。
    await ensureOverflow(page);

    // (b) 首屏停顶态：最低半可见行不得被框缘「铡断」——可滚且存在
    //     越界行时，.stage-col 必须带下缘渐隐（mask-image 渐变）使其
    //     溶出。旧码 mask=none → 红（见头注红证数字）。
    await page.evaluate(() => {
      document.querySelector(".stage-col").scrollTop = 0;
    });
    await page.waitForTimeout(200);
    const t = await measureTop(page);
    assert(
      t.scrollH > t.clientH + 4,
      `${tag}: .stage-col 未溢出 scrollH=${t.scrollH} clientH=${t.clientH}（ensureOverflow 失效？）`
    );
    assert(
      t.bottommost,
      `${tag}: .stage-col 可视区内没有任何正文子元素（选择器失效？）`
    );
    {
      const over = t.bottommost.bottom - t.clipBottom;
      const fade =
        typeof t.mask === "string" &&
        t.mask.includes("linear-gradient") &&
        (t.mask.includes("transparent") || t.mask.includes("rgba(0, 0, 0, 0)"));
      // 可滚即必有某滚动位把行铡在框缘——渐隐存在性与本次采样是否
      // 恰好越界无关，无条件断言，不给「裁剪缘恰好落在元素缝」的假绿。
      assert(
        fade,
        `${tag}: .stage-col 可滚但框缘硬裁、无下缘渐隐——末可见 .${t.bottommost.cls} ` +
          `bottom=${t.bottommost.bottom.toFixed(1)} 裁剪缘 ${t.clipBottom.toFixed(1)} ` +
          `越界=${over.toFixed(1)}px，mask-image=${t.mask}`
      );
      console.log(
        `    [${tag}] 停顶态 末可见 .${t.bottommost.cls} bottom=${t.bottommost.bottom.toFixed(1)} ` +
          `clip=${t.clipBottom.toFixed(1)} 越界=${Math.max(0, over).toFixed(1)}px ` +
          `mask=${fade ? "下缘渐隐" : t.mask}`
      );
    }

    // (c) 滚到底：末元素完整落在裁剪盒内，与 .actions 顶间距 ≥8px。
    await page.evaluate(() => {
      const el = document.querySelector(".stage-col");
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(200);
    const m = await measureBottom(page);
    assert(m.kids > 0, `${tag}: .stage-col 无正文子元素`);
    assert(
      m.lastBottom <= m.clipBottom + 1,
      `${tag}: 末元素 .${m.lastCls} bottom=${m.lastBottom.toFixed(1)} 越出裁剪缘 ` +
        `${m.clipBottom.toFixed(1)}（滚到底仍被裁 ${(m.lastBottom - m.clipBottom).toFixed(1)}px）`
    );
    const gap = m.actionsTop - m.lastBottom;
    assert(
      gap >= 8,
      `${tag}: 末行与 .actions 间距 ${gap.toFixed(1)}px < 8px ` +
        `(lastBottom=${m.lastBottom.toFixed(1)} actionsTop=${m.actionsTop.toFixed(1)})`
    );

    // (d) 末行中心 elementFromPoint 命中正文，不得命中 .actions/浮层。
    assert(m.hit, `${tag}: 末行中心 (cy=${m.cy.toFixed(1)}) elementFromPoint 为 null`);
    assert(
      m.hit.inCol && !m.hit.inActions,
      `${tag}: 末行中心命中 ${m.hit.tag}.${m.hit.cls}（非 .stage-col 正文，inActions=${m.hit.inActions}）`
    );
    assert(
      m.hit.pos !== "fixed",
      `${tag}: 末行被 fixed 浮层遮挡（命中 ${m.hit.tag}.${m.hit.cls} position=fixed）`
    );

    // (e) 无横溢。
    assert(
      m.docSW === m.docCW,
      `${tag}: 横向溢出 scrollWidth=${m.docSW} !== clientWidth=${m.docCW}`
    );

    // (f) 反洗绿：.actions 非遮罩式布局、与 .stage 矩形不重叠、在视口内。
    assert(
      m.actionsPos !== "fixed" && m.actionsPos !== "absolute",
      `${tag}: .actions position=${m.actionsPos}（遮罩式布局，间距无意义）`
    );
    assert(
      m.stageBottom <= m.actionsTop + 1,
      `${tag}: .stage 与 .actions 矩形重叠 stage.bottom=${m.stageBottom.toFixed(1)} ` +
        `> actions.top=${m.actionsTop.toFixed(1)} +1`
    );
    assert(
      m.actionsTop < m.vh && m.actionsBottom > 0,
      `${tag}: .actions 不在视口内 top=${m.actionsTop.toFixed(1)} bottom=${m.actionsBottom.toFixed(1)} vh=${m.vh}`
    );
    console.log(
      `    [${tag}] 滚到底 末行 .${m.lastCls} bottom=${m.lastBottom.toFixed(1)} ` +
        `clip=${m.clipBottom.toFixed(1)} actionsTop=${m.actionsTop.toFixed(1)} ` +
        `间距=${gap.toFixed(1)}px clientH=${m.clientH} docSW=${m.docSW}/${m.docCW} ` +
        `stage.bottom=${m.stageBottom.toFixed(1)} hit=${m.hit.tag}.${m.hit.cls}`
    );
  }
});
