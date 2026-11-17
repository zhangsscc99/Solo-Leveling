#!/usr/bin/env node
// F097 遭遇/守关者等级带宽钳制断言（完全自包含：自起隔离实例 + 临时 DB，
// 不打 3020 线上）。旧码必红：旧码敌人等级只随章节（Ch.1 石像 Lv.3 超出
// 期望上界 2、Ch.2 毒牙蛇 Lv.5–6 / HP200 对 Lv.1–2），①/③ 任一即红。
//
//   ① 新档 Lv.1 连续 30 次「前进」采集所有遭遇 + Lv.2 存档置章 Ch.2 再
//      采 30 次：每个敌人 level ∈ [player.level−2, player.level+2]
//      且 ≤ chapter.expected_level+1（数据文件口径 oracle，不调被测引擎）。
//   ② Lv.1 / Lv.2 存档强行置章 Ch.2 守关房前一景，「前进」落地即守关战：
//      固定策略（技能→补魔→回血→攻击），断言 ≤12 回合击杀且 save.hp>0。
//      临时库从零建，存档 id 与遭遇 seq 逐位确定，回合种子
//      combat:<id>:<seq>:<turn> 全链路固定 → 每次跑同一条世界线。
//   ③ chapters.json 8 章 expected_level 齐备且 ch2.expected_level ===
//      ch2.unlock.level。
//
//   变异敏感性：删除 bandFor 钳制或 index.js 不传 playerLevel → ① 红
//   （Ch.1 石像 Lv.3 > 期望上界 2，Ch.2 毒牙蛇 Lv.6 > Lv.2+2）；HP 预算
//   不写回 → ② 的 ≤12 回合/存活断言红；chapters.json 缺 expected_level
//   → ③ 红（加载期校验也会让被测实例起不来）。
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Database = require("better-sqlite3");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));
const CH_LIST = Array.isArray(CHAPTERS) ? CHAPTERS : CHAPTERS.chapters;

const results = [];
function report(name, pass, detail = "") {
  results.push({ name, pass });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}
function failAll(msg) {
  console.error(`[FAIL] ${msg}`);
  cleanup(1);
}

// ── 空闲端口 + 隔离实例（ai-prose-fastpath.mjs 同款） ──────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const gamePort = await freePort();
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f097-"));
const dbFile = path.join(tmpDir, "game.db");
const env = {
  ...process.env,
  PORT: String(gamePort),
  DB_PATH: dbFile,
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

const API = `http://127.0.0.1:${gamePort}/game/api`;
let finished = false;
function cleanup(code) {
  if (finished) return;
  finished = true;
  try {
    child.kill("SIGKILL");
  } catch {}
  const bad = results.filter((r) => !r.pass).length;
  if (bad) console.log(`[RESULT] ${results.length - bad}/${results.length} 断言通过`);
  process.exit(code || (bad ? 1 : 0));
}
process.on("SIGINT", () => cleanup(2));
process.on("SIGTERM", () => cleanup(2));
process.on("exit", () => {
  try {
    child.kill("SIGKILL");
  } catch {}
});

async function apiPost(pathname, body, ms = 15000) {
  const res = await fetch(`${API}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ms),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
async function apiGet(pathname, ms = 10000) {
  const res = await fetch(`${API}${pathname}`, { signal: AbortSignal.timeout(ms) });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}
async function act(id, input) {
  const { status, body } = await apiPost("/action", { save_id: id, input });
  if (status !== 200 || !body || !body.save) {
    failAll(`action「${input}」HTTP ${status}`);
  }
  return body;
}
async function fetchSave(id) {
  const { status, body } = await apiGet(`/saves/${id}`);
  if (status !== 200 || !body || !body.save) failAll(`GET /saves/${id} HTTP ${status}`);
  return body;
}
async function makeSave(tag) {
  const { status, body } = await apiPost("/saves", { player_name: `f097-${tag}` });
  if (status !== 201 || !body || !body.save || !body.save.id) {
    failAll(`create save HTTP ${status}`);
  }
  return body.save.id;
}

// 等实例就绪
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
    console.error(`[F097] 隔离实例 15s 未就绪，子进程输出：\n${childLog.slice(-2000)}`);
    cleanup(1);
  }
}

// ── oracle：期望上界只读数据文件 ───────────────────────────────────────
const EXPECTED = new Map(CH_LIST.map((c) => [c.index, c.expected_level]));
function bandCap(chapterIndex) {
  const e = EXPECTED.get(chapterIndex);
  return Number.isInteger(e) ? e + 1 : null;
}

const HEAL_ITEMS = new Set(["low_heal_potion", "mid_heal_potion", "elixir_of_life"]);
function combatInput(s, inventory) {
  const castable = (s.skills || []).find((k) => k.can_cast);
  if (castable) return `释放技能 ${castable.name}`;
  const hasMana = (inventory || []).some((r) => r.item_id === "mana_potion" && r.qty > 0);
  const hasHeal = (inventory || []).some((r) => r.qty > 0 && HEAL_ITEMS.has(r.item_id));
  if (hasMana && s.mp < 12) return "使用道具";
  if (hasHeal && s.hp <= Math.max(30, s.max_hp * 0.4)) return "使用道具";
  return "攻击";
}
async function tryHeal(id, s, inventory) {
  if (s.rest && s.rest.available === true) {
    await act(id, "休息");
    return true;
  }
  const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_ITEMS.has(r.item_id));
  if (heal) {
    const { status } = await apiPost(`/saves/${id}/item`, { item_id: heal.item_id, op: "use" });
    if (status === 200) return true;
  }
  return false;
}

// 采集驱动：连续 done 次「前进」，沿途每进一场战斗记一条遭遇样本。
// 守关门拒绝「前进」时用「攻击」叫阵（F096 口径：门后守关者必须真打）。
// 死亡回溯不算失败——样本等级是进战瞬间的存档等级，断言不变。
async function collectEncounters(id, moves) {
  const samples = [];
  const seenSeq = new Set();
  let done = 0;
  for (let guard = 0; done < moves && guard < 800; guard++) {
    const { save: s, inventory } = await fetchSave(id);
    if (s.combat) {
      const seq = s.combat.seq ?? s.combat.started_at;
      if (!seenSeq.has(seq)) {
        seenSeq.add(seq);
        const e = s.combat.enemy || {};
        samples.push({
          chapter: s.chapter,
          scene: s.scene,
          playerLevel: s.level,
          name: e.name,
          level: e.level,
          boss: Boolean(e.boss),
          hp: e.max_hp,
        });
      }
      await act(id, combatInput(s, inventory));
      continue;
    }
    if (s.hp > 0 && s.hp < s.max_hp * 0.4 && (await tryHeal(id, s, inventory))) continue;
    const r = await act(id, "前进");
    done++;
    if (r.refused && /守关者|叫阵|现形/.test((r.reply && r.reply.content) || "")) {
      await act(id, "攻击"); // 叫阵 → 守关战当面成形
    }
  }
  if (done < moves) failAll(`collectEncounters: ${moves} 次「前进」未完成（仅 ${done}）`);
  return samples;
}

// 把存档按 DB 直写摆到指定章指定景（chapter-boss-gate.mjs 同款手法）。
// 只动存档字段：等级/位置/HP·MP/遭遇计数/守关标记/击杀冷却，战斗表清空。
// freePoints 对齐 levels.json 的升级赠点（每级 3 点）——置章 Lv.N 的存档
// 应当揣着一路升级攒下的自由点，否则是「从不加点的 Lv.N」，低估真实玩家。
function placeSave(id, { chapter, scene, level, freePoints = 0 }) {
  const db = new Database(dbFile);
  try {
    db.prepare(
      `UPDATE saves SET chapter = ?, scene = ?, level = ?, free_points = ?,
         hp = max_hp, mp = max_mp, encounter_clock = 0, encounter_cd = 0,
         advance_streak = 0, rest_used = 0, boss_cleared_json = '[]', boss_hp_json = '{}'
       WHERE id = ?`
    ).run(chapter, scene, level, freePoints, id);
    db.prepare("DELETE FROM combat WHERE save_id = ?").run(id);
  } finally {
    db.close();
  }
}
// 走完服务端的 /spend 把自由点加到力量——真实玩家会做的属性分配，
// 不是绕过结算直接改 stats_json。
async function spendFreePoints(id, stat) {
  for (;;) {
    const { save: s } = await fetchSave(id);
    if (!(s.free_points > 0)) break;
    const { status } = await apiPost(`/saves/${id}/spend`, { stat });
    if (status !== 200) failAll(`spend ${stat} HTTP ${status}`);
  }
}

// 固定策略打完当前交战：技能→（缺魔回蓝/残血回血）→攻击。
// 返回 { actions, won, save }：won = 交战解除且未死亡（deaths 未涨）。
async function fightCurrentBoss(id, deathsBefore, maxActions = 25) {
  for (let n = 1; n <= maxActions; n++) {
    const { save: s, inventory } = await fetchSave(id);
    if (!s.combat) return { actions: n - 1, won: s.deaths === deathsBefore && s.hp > 0, save: s };
    const r = await act(id, combatInput(s, inventory));
    if (!r.save.combat) {
      return { actions: n, won: r.save.deaths === deathsBefore && r.save.hp > 0, save: r.save };
    }
  }
  const { save } = await fetchSave(id);
  return { actions: maxActions, won: false, save };
}

try {
  // ── ①a 新档 Lv.1 起步，30 次「前进」采集遭遇 ──────────────────────────
  const s1 = await makeSave("a");
  const legA = await collectEncounters(s1, 30);
  report("①a 遭遇样本非空（新档 30 步）", legA.length >= 3, `样本 ${legA.length} 条`);

  // ── ①b Lv.2 存档置章 Ch.2，再采 30 次「前进」 ────────────────────────
  const s2 = await makeSave("b");
  placeSave(s2, { chapter: 2, scene: "ch2_penalty_gate", level: 2 });
  const legB = await collectEncounters(s2, 30);
  report("①b 遭遇样本非空（Ch.2 置档 30 步）", legB.length >= 3, `样本 ${legB.length} 条`);

  // ── ① 汇总带宽断言 ─────────────────────────────────────────────────
  const samples = [...legA, ...legB];
  const violations = [];
  for (const x of samples) {
    const lo = Math.max(1, x.playerLevel - 2);
    const hi = x.playerLevel + 2;
    const cap = bandCap(x.chapter);
    if (!(x.level >= lo && x.level <= hi) || (cap !== null && x.level > cap)) {
      violations.push(
        `Ch.${x.chapter} ${x.name} Lv.${x.level}${x.boss ? "(boss)" : ""} vs ` +
          `玩家 Lv.${x.playerLevel}（允许 ${lo}–${hi} 且 ≤${cap}）`
      );
    }
  }
  const bossSeen = samples.filter((x) => x.boss).length;
  for (const x of samples.slice(0, 8)) {
    console.log(
      `   · Ch.${x.chapter} ${x.name} Lv.${x.level}${x.boss ? " [守关]" : ""}` +
        ` HP${x.hp} ← 玩家 Lv.${x.playerLevel}`
    );
  }
  report(
    "① 所有遭遇等级落在 [player±2] 且 ≤ expected_level+1",
    violations.length === 0 && samples.length >= 6,
    violations.length
      ? `${violations.length} 条越界：${violations.slice(0, 3).join("；")}`
      : `${samples.length} 条遭遇（含守关 ${bossSeen} 条）全部在带宽内`
  );

  // ── ② Lv.1 / Lv.2 强行进 Ch.2 守关战，≤12 回合击杀且存活 ──────────────
  // 两个存档按序建 → id/遭遇 seq 固定 → 每次运行同一条战斗世界线。
  for (const [tag, level] of [
    ["c-lv1", 1],
    ["d-lv2", 2],
  ]) {
    const id = await makeSave(tag);
    // Lv.N 置档：补升级赠点（每级 3，levels.json）并走 /spend 全投力量——
    // 对齐「真实打到 Lv.N 且正常加点」的玩家强度，不是裸身白板。
    placeSave(id, { chapter: 2, scene: "ch2_penalty_gate", level, freePoints: 3 * (level - 1) });
    await spendFreePoints(id, "strength");
    const { save: pre } = await fetchSave(id);
    const step = await act(id, "前进"); // 落在 ch2_poison_fang → 守关战成形
    const cbt = step.save.combat;
    const e = cbt && cbt.enemy;
    const lo = Math.max(1, level - 2);
    const hi = level + 2;
    const cap = bandCap(2); // chapters.json 缺 expected_level 时为 null（③ 会单独红）
    const bossOk =
      cbt && e && e.boss === true && e.level >= lo && e.level <= hi && (cap === null || e.level <= cap);
    report(
      `②${tag} Lv.${level} 进 Ch.2 守关房落地即战，守关者等级在带宽内`,
      Boolean(bossOk),
      e ? `${e.name} Lv.${e.level} HP${e.max_hp}（允许 ${lo}–${hi}${cap === null ? "" : ` 且 ≤${cap}`}）` : "未进交战"
    );
    if (!bossOk) continue;
    const { actions, won, save } = await fightCurrentBoss(id, pre.deaths);
    report(
      `②${tag} Lv.${level} 守关战 ≤12 回合击杀且存活`,
      won && actions <= 12,
      `${actions} 回合${won ? `，战后 HP ${save.hp}/${save.max_hp}` : `，${save.deaths > pre.deaths ? "阵亡" : "未能击杀"}`}`
    );
  }

  // ── ③ chapters.json expected_level 齐备且 ch2 与 unlock.level 对齐 ────
  const missing = CH_LIST.filter((c) => !Number.isInteger(c.expected_level)).map((c) => c.index);
  const ch2 = CH_LIST.find((c) => c.index === 2);
  report(
    "③ chapters.json 8 章 expected_level 齐备、ch2 与 unlock.level 对齐",
    CH_LIST.length === 8 && missing.length === 0 && ch2 && ch2.expected_level === ch2.unlock.level,
    missing.length ? `缺字段章: ${missing.join(",")}` : `ch2 expected=${ch2 && ch2.expected_level} unlock=${ch2 && ch2.unlock.level}`
  );
} catch (err) {
  console.error(`[FAIL] 异常终止: ${err && err.stack ? err.stack : err}`);
  console.error(`子进程日志尾部:\n${childLog.slice(-1500)}`);
  cleanup(1);
}

cleanup(0);
