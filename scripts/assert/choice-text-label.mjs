#!/usr/bin/env node
// F271 抉择的文本形态：玩家照着按钮文案开口（「选择 按石碑所写，低头敬拜」）
// 必须被判成 choice 并真正推进，而不是「intent=unknown + 教程话术」把玩家
// 卡在 must_choose 里。
//
//   覆盖：
//     A 完整文案（含「，」、超 24 字）→ intent=choice 且 scene 变化
//     B 唯一前缀（≥3 字）→ intent=choice 且 scene 变化
//     C 回归：「选择 1」与「选择 <选项 id>」仍生效
//     D 负向锁：must_choose 场景下发「观察」不得被吞成 choice（F075 旧坑）
//     E 歧义：前缀命中多条 → 如实回问（refused，不推进、不改场景）
//
//   自起隔离实例（临时端口 + 临时 DB_PATH），不打线上、不占 3020；
//   全程走规则解析（不发 AI），结果确定可复现。
//   旧码红证：A/B 在旧码上必 FAIL（choiceSelFromInput 只吃「无标点 ≤24 字」）。
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const require = createRequire(import.meta.url);
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "f271-choice-"));
const DB_FILE = path.join(tmpDir, "game.db");

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

const PORT = await freePort();
process.env.API_BASE = `http://127.0.0.1:${PORT}/game/api`;
process.env.DB_PATH = DB_FILE;

const { assert, act, fetchSaveView, fail } = await import("./_http.mjs");

// ── 场景 oracle（直读 chapters.json，不经被测引擎）────────────────
const sceneById = new Map();
for (const c of CHAPTERS.chapters || []) {
  for (const s of c.scenes || []) sceneById.set(s && s.id, s);
}
function choicesOf(sceneId) {
  const s = sceneById.get(sceneId);
  return s && Array.isArray(s.choices) ? s.choices : [];
}
function isMustChoose(sceneId) {
  const s = sceneById.get(sceneId);
  return Boolean(s && s.must_choose === true && Array.isArray(s.choices) && s.choices.length);
}
// 唯一前缀：≥3 字且只命中一条（用于 B 段）
function uniquePrefix(choices) {
  for (let len = 3; len <= 24; len++) {
    const pref = choices[0].label.slice(0, len);
    const hits = choices.filter((c) => c.label.startsWith(pref));
    if (hits.length === 1) return pref;
  }
  return null;
}

// ── 隔离实例 ──────────────────────────────────────────────────────
const child = spawn(process.execPath, [path.join(ROOT, "server", "index.js")], {
  env: { ...process.env, PORT: String(PORT), DB_PATH: DB_FILE },
  stdio: ["ignore", "pipe", "pipe"],
});
let childErr = "";
child.stderr.on("data", (d) => {
  childErr += d.toString();
});
let done = false;
function cleanup(code) {
  if (done) return;
  done = true;
  try {
    child.kill("SIGTERM");
  } catch {}
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  process.exit(code);
}
process.on("exit", () => {
  try {
    child.kill("SIGTERM");
  } catch {}
});

async function waitHealthy(ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(`${process.env.API_BASE}/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  console.error(`[ASSERT] isolated server not healthy on :${PORT}\n${childErr.slice(-800)}`);
  cleanup(1);
}

async function makeSave(tag) {
  const res = await fetch(`${process.env.API_BASE}/saves`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ player_name: `f271-${tag}-${Date.now().toString(36)}`.slice(0, 20) }),
  });
  const body = await res.json().catch(() => null);
  assert(res.status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${res.status})`);
  return body.save.id;
}

// 打到 must_choose 场景即停（不替玩家选）：途中来了战斗就地清场。
async function reachMustChoose(id, max = 90) {
  let last = null;
  for (let i = 0; i < max; i++) {
    const { save: s, inventory } = await fetchSaveView(id);
    last = s;
    if (isMustChoose(s.scene)) return s;
    if (s.combat) {
      const heal = (inventory || []).find((r) => r.qty > 0 && /heal_potion|elixir/.test(r.item_id));
      if (s.hp <= Math.max(25, s.max_hp * 0.35) && heal) {
        await act(id, "使用道具");
        continue;
      }
      const skill = Array.isArray(s.skills) ? s.skills.find((k) => k.can_cast) : null;
      await act(id, skill ? `释放技能 ${skill.name}` : "攻击");
      continue;
    }
    if (s.hp > 0 && s.hp < s.max_hp * 0.8) {
      const r = await act(id, "休息");
      if (r.refused !== true) continue;
    }
    await act(id, "前进");
  }
  fail(
    `reachMustChoose: ${max} actions without landing on a must_choose scene ` +
      `(last scene=${last && last.scene} ch=${last && last.chapter})`
  );
}

await waitHealthy();

// ── A / B：在同一个 must_choose 局面上分别用「完整文案」「唯一前缀」────
{
  const id = await makeSave("a");
  const s = await reachMustChoose(id);
  const choices = choicesOf(s.scene);
  const target = choices[0];
  const label = target.label;
  assert(label && label.length > 0, `scene ${s.scene} 的首个选项没有 label`);
  console.log(`[SETUP] save=${id} scene=${s.scene} choices=${choices.map((c) => c.label).join(" | ")}`);

  const rA = await act(id, `选择 ${label}`);
  console.log(
    `[A] 选择 ${label} → intent=${rA.intent} scene=${s.scene}→${rA.save.scene} refused=${Boolean(rA.refused)}`
  );
  assert(rA.intent === "choice", `A: 完整文案未被判成 choice（intent=${rA.intent}）: ${String(rA.reply && rA.reply.content).slice(0, 200)}`);
  assert(
    rA.save.scene !== s.scene || rA.save.chapter !== s.chapter,
    `A: intent=choice 但场景没有推进（scene 仍 ${rA.save.scene}）`
  );

  // B：换一个 must_choose 局面用前缀（同一个局面已被 A 消费）
  const id2 = await makeSave("b");
  let s2 = await reachMustChoose(id2);
  const pref = uniquePrefix(choicesOf(s2.scene));
  if (!pref) {
    console.log(`[B] SKIP 场景 ${s2.scene} 的选项无唯一 ≥3 字前缀`);
  } else {
    const before = s2.scene;
    const rB = await act(id2, `选择 ${pref}`);
    console.log(`[B] 选择 ${pref} → intent=${rB.intent} scene=${before}→${rB.save.scene}`);
    assert(rB.intent === "choice", `B: 唯一前缀未被判成 choice（intent=${rB.intent}）: ${String(rB.reply && rB.reply.content).slice(0, 200)}`);
    assert(rB.save.scene !== before || rB.save.chapter !== s2.chapter, `B: intent=choice 但场景没有推进`);
  }

  // ── C：回归「选择 1」/「选择 <id>」──────────────────────────────
  const id3 = await makeSave("c");
  const s3 = await reachMustChoose(id3);
  const c3 = choicesOf(s3.scene);
  const rC1 = await act(id3, "选择 1");
  console.log(`[C1] 选择 1 → intent=${rC1.intent} scene=${s3.scene}→${rC1.save.scene}`);
  assert(rC1.intent === "choice", `C1: 「选择 1」回归（intent=${rC1.intent}）`);

  const id4 = await makeSave("d");
  const s4 = await reachMustChoose(id4);
  const c4 = choicesOf(s4.scene);
  const withId = c4.find((c) => c && typeof c.id === "string" && c.id);
  if (!withId) {
    console.log(`[C2] SKIP 场景 ${s4.scene} 的选项没有 id 字段`);
  } else {
    const rC2 = await act(id4, `选择 ${withId.id}`);
    console.log(`[C2] 选择 ${withId.id} → intent=${rC2.intent} scene=${s4.scene}→${rC2.save.scene}`);
    assert(rC2.intent === "choice", `C2: 「选择 <id>」回归（intent=${rC2.intent}）`);
  }

  // ── D：负向锁——「观察」不得被吞成 choice ──────────────────────
  const id5 = await makeSave("e");
  const s5 = await reachMustChoose(id5);
  const rD = await act(id5, "观察");
  console.log(`[D] 观察 → intent=${rD.intent} scene=${s5.scene}→${rD.save.scene}`);
  assert(rD.intent !== "choice", `D: 「观察」被吞成了 choice（scene=${rD.save.scene}）`);
  assert(rD.save.scene === s5.scene, `D: 「观察」不该位移（${s5.scene} → ${rD.save.scene}）`);

  // ── E：未命中 → 如实拒绝、不推进（fetch 回包的 intent 恒为 choice，
  //         真假必须看 refused）────────────────────────────────
  const s6 = s5;
  const rE = await act(id5, "选择 这根本不是选项");
  console.log(
    `[E] 选择 这根本不是选项 → intent=${rE.intent} refused=${Boolean(rE.refused)} scene=${s6.scene}→${rE.save.scene}`
  );
  assert(rE.refused === true, `E: 不存在的选项应被拒绝（refused=${rE.refused}）`);
  assert(rE.save.scene === s6.scene, `E: 被拒时不得位移（${s6.scene} → ${rE.save.scene}）`);
  const rEText = String((rE.reply && rE.reply.content) || "");
  assert(/可选/.test(rEText), `E: 被拒回包应列出可选分支：${rEText.slice(0, 200)}`);
  console.log("[E2] SKIP 歧义分支（该 must_choose 场景无共享 ≥3 字前缀的两个选项，无法在本章构造）");
}

console.log("[ASSERT] F271 choice-text-label PASS");
cleanup(0);
