#!/usr/bin/env node
// combat-lock-receipt.mjs (F309): 交战态点击「属性/背包/地图/任务/影子/存档/
// 档案」等被锁功能键，每一次都必须给【可见且逐击可区分】的回执——
//
//   第105轮线上真实走查（390×844）：交战态连点底部「属性/背包/休息」，
//   m6/m7/m8/m9 四张截图字节完全相同（166326 bytes）——无 toast、无面板、
//   无禁用说明，点击被静默吞掉（intuitive-game-design Q5 Immediate 层缺失
//   + game-detail-bar §9c「Cards and toasts never block play」）。
//
//   自起隔离实例（空闲端口 + 临时 DB_PATH + AI key 置空），better-sqlite3
//   直落 combat 行（与 disabled-denied-feedback B 段同口径，不赌掷点），
//   reload 回灌真实交战态后断言：
//     a) 390×844 与 1440×900 各跑一遍：真实 pointer 点击「属性」「背包」
//        （并覆盖 技能/地图/任务/影子/存档/档案 同组锁定键），每次 300ms
//        内出现可见回执节点——.sys-toast 可见且含「交战」字样，或点击键
//        亮起 [data-lock-receipt] 拒收态；
//     b) 同一键连点两次：两次回执必须可区分（data-receipt-seq 递增或
//        文案「· ×N」计数 +1）——第二次与第一次屏幕零变化 = 点击被吞；
//     c) 回执期间对应面板不得展开：.sidebar.open 不存在、attr 面板不出现；
//     d) 拒绝零副作用：不发 /api/ 请求、.stage-col.log 子行零增长；
//     e) 「休息」：交战态行动栏无此键（探索组整组让位给战斗五键），玩家
//        唯一通道是自由输入——发「休息」必须给明确结果反馈：/action 回包
//        refused:true 且正文新增含「无法休息」的回执行（不允许静默）；
//     f) 390 下 scrollWidth===clientWidth，回执不得撑出横向滚动。
//
//   旧码红证：交战态页签 onClick 直接 openTab——点击「属性」抽屉整幅
//   展开且 .sys-toast 为零（更老的部署构建上横滑容器吞手势、连抽屉都
//   不开，与走查的零变化截图同症）。a)/c) 双路断言都拦得住。
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

const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const encounterEngine = require(path.join(ROOT, "server", "engine", "encounter.js"));
const CH1 = CHAPTERS.chapters.find((c) => c.index === 1);
const MOB_SCENE =
  CH1.scenes.find((s) => s.kind === "mob") || CH1.scenes.find((s) => s.must_choose !== true);

// 前端由 server 以 client/dist 静态托管。dist 缺失 → 补构建；dist 是指向
// 外部产物的软链 → 摘掉再构建（本断言验的正是本 worktree 的客户端代码）。
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
      console.log("FAIL: combat-lock-receipt client/dist 缺失且 npm --prefix client run build 失败");
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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f309-"));
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
    console.log(`FAIL: combat-lock-receipt 隔离实例 15s 未就绪：\n${childLog.slice(-2000)}`);
    process.exit(1);
  }
}

// E2E_BASE_URL 须在 lib.mjs 求值前落定（指向隔离实例，不打公网）。
process.env.E2E_BASE_URL = `http://127.0.0.1:${port}/game`;
const { assert, run, createSave } = await import("./lib.mjs");

let page;
let apiHits = [];

const withDb = (fn) => {
  const Database = require("better-sqlite3");
  const db = new Database(dbPath);
  try {
    return fn(db);
  } finally {
    db.close();
  }
};

// aria-live 通道逐击增量签名——[role="status"]/[aria-live]/[data-receipt-seq]
// 节点的 class|text|seq 拼接（F307 lock-receipt 同口径）。回执「等幂」
// （同文案 toast 重挂载、零 seq）时连点签名不变，与第105轮「aria-live
// 文本零变化」同判。
const liveSig = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="status"],[aria-live],[data-receipt-seq]')]
      .map(
        (n) =>
          `${n.className}|${(n.textContent || "").trim()}|${n.getAttribute("data-receipt-seq") || ""}`
      )
      .join(";;")
  );

const snap = () =>
  page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        cs.display !== "none" &&
        cs.visibility !== "hidden" &&
        Number(cs.opacity) > 0.05
      );
    };
    const toasts = [...document.querySelectorAll(".sys-toast")];
    return {
      toastVisible: toasts.some(vis),
      toastText: toasts.map((t) => (t.textContent || "").trim()).join("|"),
      drawerOpen: !!document.querySelector(".sidebar.open"),
      attrPanel: !!document.querySelector(".sidebar.open .stat-panel"),
      logRows: document.querySelector(".stage-col.log")?.children.length ?? -1,
      deniedCount: document.querySelectorAll('[data-denied="1"]').length,
    };
  });

// a)+b) 合并判定：300ms 窗口内轮询——.sys-toast 可见且含「交战」字样 AND
// aria-live 通道有增量（seq 递增或文本变化；同一文案重挂载、屏幕零变化
// 不算回执）。返回 false 表示这次点击被静默吞掉。
const receiptWithin300 = async (beforeLive) => {
  try {
    await page.waitForFunction(
      (prev) => {
        const vis = (el) => {
          if (!el) return false;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            cs.display !== "none" &&
            cs.visibility !== "hidden" &&
            Number(cs.opacity) > 0.05
          );
        };
        const toasts = [...document.querySelectorAll(".sys-toast")];
        const visibleToast = toasts.some(vis);
        if (!visibleToast) return false;
        const toastText = toasts.map((t) => (t.textContent || "").trim()).join("|");
        // 「交战」字样优先落 .sys-toast；壳上 data-denied 抖动也算可见回执
        // （F307 三件套），但文案必须指认「交战」语境才算对得上的拒绝。
        const denialCue =
          /交战/.test(toastText) || document.querySelectorAll('[data-denied="1"]').length > 0;
        if (!denialCue) return false;
        const sig = [
          ...document.querySelectorAll('[role="status"],[aria-live],[data-receipt-seq]'),
        ]
          .map(
            (n) =>
              `${n.className}|${(n.textContent || "").trim()}|${n.getAttribute("data-receipt-seq") || ""}`
          )
          .join(";;");
        return sig !== prev;
      },
      beforeLive,
      { timeout: 300, polling: 20 }
    );
    return true;
  } catch {
    return false;
  }
};

// 键中心坐标——真实 pointer 点击必须落在键面/其承接层上（抽屉滑出动画
// 期间会短暂盖住底栏缘），拿到稳定命中再点。
const clickPoint = async (loc, tag) => {
  const box = await loc.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${tag}: boundingBox 取不到`);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.waitForFunction(
    ([x, y]) => {
      const el = document.elementFromPoint(x, y);
      return !!el;
    },
    [cx, cy],
    { timeout: 5000 }
  );
  return { cx, cy };
};

// 交战态应被锁定的功能键清单：选择器 + 回执文案必须各自指认的关键词
// （不共用一句泛泛拒绝——「属性」键的回执得说「属性面板」）。
const LOCKED_KEYS = [
  { name: "属性", sel: '.btn-group-sys .btn[data-act="stats"]', cue: /属性/ },
  { name: "背包", sel: '.btn-group-sys .btn[data-act="inventory"]', cue: /背包/ },
  { name: "技能", sel: '.btn-group-sys .btn[data-act="skills"]', cue: /技能/ },
  { name: "地图", sel: '.btn-group-sys .btn[data-act="map"]', cue: /地图/ },
  { name: "任务", sel: '.btn-group-sys .btn[data-act="quests"]', cue: /任务/ },
  { name: "影子", sel: '.btn-group-sys .btn[data-act="shadows"]', cue: /影子/ },
  { name: "存档", sel: '.btn-group-sys .btn:has-text("存档")', cue: /存档/ },
  { name: "档案", sel: "button.drawer-toggle", cue: /档案/ },
];

run("combat-lock-receipt", async ({ page: p }) => {
  page = p;
  page.on("request", (req) => {
    if (/\/api\//.test(req.url())) apiHits.push(req.url());
  });

  const name = `e2e-f309-${Date.now().toString(36)}`;
  await createSave(page, name);
  const saveId = await page.evaluate(() =>
    Number(localStorage.getItem("solo_leveling_save_id"))
  );
  assert(saveId > 0, "save_id missing in localStorage");

  // 直落交战态（不赌掷点）：mob 场景 + combat 行 → reload 回灌真实 save。
  const mob = encounterEngine.spawn(1, 7, 1);
  withDb((db) => {
    db.prepare("UPDATE saves SET scene = ?, encounter_clock = 0 WHERE id = ?").run(
      MOB_SCENE.id,
      saveId
    );
    db.prepare(
      `INSERT INTO combat (save_id, enemy_json, turn, started_at)
       VALUES (?, ?, 1, datetime('now'))
       ON CONFLICT(save_id) DO UPDATE SET enemy_json = excluded.enemy_json, turn = 1`
    ).run(saveId, JSON.stringify(mob));
  });

  for (const vp of [
    { tag: "390", w: 390, h: 844 },
    { tag: "1440", w: 1440, h: 900 },
  ]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".status");
    await page.waitForFunction(() => !document.querySelector(".pending"));
    // 交战态就位：战斗组五键在场、探索组让位。
    await page.waitForSelector(".actions-main.actions-combat");
    await page.waitForTimeout(250);

    const rows0 = (await snap()).logRows;

    // ── a)+b)+c)+d)：逐键真实 pointer 点击，每次 300ms 内可见回执，
    //    同一键连点两次回执可区分，面板不得展开，零请求零日志污染。 ──
    for (const k of LOCKED_KEYS) {
      const loc = page.locator(k.sel).first();
      assert((await loc.count()) > 0, `[${vp.tag}] 找不到锁定键「${k.name}」(${k.sel})`);
      // 「档案」抽屉键宽屏 display:none（桌面档案栏常驻不需要抽屉入口）
      // ——该键本视口不渲染则跳过，锁定口径仍由系统页签覆盖。
      if (!(await loc.isVisible().catch(() => false))) {
        console.log(`    [${vp.tag}] 「${k.name}」本视口不渲染，跳过`);
        continue;
      }
      // aria-disabled 必须有（不得用原生 disabled 吞点击）；
      // 「档案」顶栏键与页签键同一口径。
      const aria = await loc.getAttribute("aria-disabled");
      assert(
        aria === "true",
        `[${vp.tag}] 「${k.name}」交战态缺 aria-disabled="true"（aria=${aria}）——禁用必须有可见语义`
      );
      // ── 第 1 击：300ms 内可见回执 + 面板不展开 + 零请求 ──
      const hits0 = apiHits.length;
      const bLive1 = await liveSig();
      const { cx, cy } = await clickPoint(loc, `[${vp.tag}]「${k.name}」第1击`);
      await page.mouse.click(cx, cy);
      const ok1 = await receiptWithin300(bLive1);
      const aSnap1 = await snap();
      assert(
        ok1,
        `[${vp.tag}] 「${k.name}」第 1 击 300ms 内零可区分回执` +
          `（toast=「${aSnap1.toastText}」 denied=${aSnap1.deniedCount}）——点击被静默吞掉`
      );
      assert(
        k.cue.test(aSnap1.toastText),
        `[${vp.tag}] 「${k.name}」回执文案不对号（toast=「${aSnap1.toastText}」，cue=${k.cue}）——三键文案须各自指认`
      );
      assert(
        !aSnap1.drawerOpen && !aSnap1.attrPanel,
        `[${vp.tag}] 「${k.name}」回执期间面板展开了——锁定面板不许弹开`
      );
      assert(
        apiHits.length === hits0,
        `[${vp.tag}] 「${k.name}」第 1 击发出了 ${apiHits.length - hits0} 个 /api 请求（拒绝回执应零请求）`
      );
      const sig1 = await liveSig();

      // ── 第 2 击（间隔压过 460ms data-denied 窗）：回执必须逐击可区分
      //    ——seq 递增或文案「· ×N」计数 +1；与第 1 击零变化 = 点击被吞。 ──
      await page.waitForTimeout(500);
      const bLive2 = await liveSig();
      const { cx: cx2, cy: cy2 } = await clickPoint(loc, `[${vp.tag}]「${k.name}」第2击`);
      await page.mouse.click(cx2, cy2);
      const ok2 = await receiptWithin300(bLive2);
      const sig2 = await liveSig();
      const aSnap2 = await snap();
      assert(
        ok2,
        `[${vp.tag}] 「${k.name}」第 2 击 300ms 内零可区分回执（toast=「${aSnap2.toastText}」）`
      );
      assert(
        sig2 !== sig1 && sig2 !== bLive2,
        `[${vp.tag}] 「${k.name}」连点第 2 击回执与第 1 击零区分` +
          `（seq 未递增/文案未变 —— toast=「${aSnap2.toastText}」）`
      );
      assert(
        !aSnap2.drawerOpen && !aSnap2.attrPanel,
        `[${vp.tag}] 「${k.name}」第 2 击后面板展开了`
      );
      assert(
        apiHits.length === hits0,
        `[${vp.tag}] 「${k.name}」第 2 击发出了 /api 请求`
      );
      console.log(
        `    [${vp.tag}] 「${k.name}」×2 回执逐击可区分：「${aSnap2.toastText.slice(0, 44)}」`
      );
    }

    // d) 正文零增长——回执必须走瞬时层，不许往正文塞系统行伪造回执
    const rows1 = (await snap()).logRows;
    assert(
      rows1 === rows0,
      `[${vp.tag}] ${LOCKED_KEYS.length} 个锁定键的拒绝回执改了日志条目 ${rows0} -> ${rows1}（回执不许落正文）`
    );

    // e) 「休息」：交战态行动栏无此键，玩家唯一通道是自由输入——必须有
    //    明确结果反馈（refused 回包 + 正文新增回执行），不允许静默。
    {
      const rowsBefore = (await snap()).logRows;
      const respP = page.waitForResponse(
        (r) => /\/api\/(ai-)?action$/.test(new URL(r.url()).pathname),
        { timeout: 15000 }
      );
      await page.fill(".input-row input", "休息");
      await page.press(".input-row input", "Enter");
      const resp = await respP;
      const json = await resp.json().catch(() => null);
      await page.waitForTimeout(300);
      const rowsAfter = (await snap()).logRows;
      assert(
        json && json.refused === true,
        `[${vp.tag}] 交战中输入「休息」未被判拒（refused=${json && json.refused}）`
      );
      assert(
        rowsAfter > rowsBefore,
        `[${vp.tag}] 交战中输入「休息」正文零新增（${rowsBefore} -> ${rowsAfter}）——静默吞指令`
      );
      const lastRow = await page.evaluate(() => {
        const col = document.querySelector(".stage-col.log");
        return col && col.lastElementChild ? (col.lastElementChild.textContent || "") : "";
      });
      assert(
        /无法休息|此刻无法|逃跑|撤离/.test(lastRow),
        `[${vp.tag}] 交战中「休息」回执未说明原因（末行=「${lastRow.slice(0, 60)}」）`
      );
      console.log(`    [${vp.tag}] 「休息」自由输入 → refused 回执行「${lastRow.slice(0, 40)}」`);
    }

    // f) 390 无横向溢出
    if (vp.tag === "390") {
      const fit = await page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth,
      }));
      assert(fit.sw === fit.cw, `[390] 横向溢出 ${fit.sw} > ${fit.cw}`);
    }
  }

  console.log(
    "    [pass] F309：交战锁定键逐击可区分回执（8 键 ×2 击 / 双视口）+ 面板零展开 + 零日志污染 + 「休息」指令通道有明确拒绝"
  );
});
