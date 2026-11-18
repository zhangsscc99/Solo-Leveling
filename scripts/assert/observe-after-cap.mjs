#!/usr/bin/env node
// F216 「观察」封顶后的空转收口（全是行为断言）：
//
//   背景：P207 把同场景「有产出」观察封顶到 3 次，第 4 次起走复核区——
//   但复核区三句正文高度同义（「看熟了/看遍了/翻过了」），代价虽推进
//     encounter_clock 玩家却看不到计数。实测连点 6 次：HP/MP 不变、三句
//   复读，玩家以为按键空转。
//
//   断言（新档天然落 ch1_double_gate，同场景连打 7 次「观察」）：
//     a) 第 4–7 次 hp/mp 与第 3 次结束时完全相等——复核区不产出、不
//        扣血扣蓝；
//     b) 第 4–7 次正文不含「获得」「【发现·」——P207 不产出口径不动；
//     c) 第 4–7 次正文含「动静 N/M」可见计数：M = encounterEngine.PITY_LIMIT，
//        N 单调不减且 ≤ M（与 encounter_clock 同一本账）；
//     d) 第 5/6/7 次与上一次的收束句（剥掉「场景」——前缀与括号尾注）
//        字符二元组 Jaccard 重合率 < 0.6——去同义，不再三句复读；
//     e) 第 4–7 次每条正文含 /前进|休息|潜行/ 之一——收束句给可执行
//        指引，不再只是「看熟了」的复述。
//
//   旧码红证：旧实现尾注无「动静 N/M」（c 在第 4 次即 FAIL），且三句
//   高度同义（d 在第 5 次亦 FAIL）、正文无任何动作词（e 同 FAIL）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { PITY_LIMIT } = require(path.join(ROOT, "server", "engine", "encounter.js"));

const OBSERVES = 7;
const METER_RE = /动静\s*(\d+)\s*\/\s*(\d+)/;
const YIELD_RE = /获得|【发现·/;
const ACTION_RE = /前进|休息|潜行/;

function closingSentence(text) {
  let s = String(text);
  s = s.replace(/^「[^」]*」——/, "");
  s = s.replace(/（[^（）]*）/g, "");
  return s;
}
function bigrams(s) {
  const set = new Set();
  const t = String(s).replace(/\s+/g, "");
  for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
  return set;
}
function jaccard(a, b) {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

const id = await makeSave("f216");
const sv0 = await fetchSaveView(id);
assert(
  sv0.save && sv0.save.scene === "ch1_double_gate" && !sv0.save.combat,
  `setup: 新档应落 ch1_double_gate 且无交战: ${JSON.stringify({ scene: sv0.save && sv0.save.scene })}`
);

const replies = [];
for (let i = 1; i <= OBSERVES; i++) {
  const r = await act(id, "观察");
  assert(r.refused !== true, `第${i}次观察被门禁拒绝（非交战态不得拒绝）: ${r.reply.content.slice(0, 80)}`);
  replies.push({ i, text: String(r.reply.content || ""), save: r.save });
  console.log(
    `    OBS${i} clock=${r.save.encounter_clock} hp=${r.save.hp} mp=${r.save.mp} · ` +
      r.reply.content.replace(/\s+/g, "").slice(0, 90)
  );
}

const s3 = replies[2].save;
const over = replies.slice(3); // 第 4–7 次

// ── (a) hp/mp 与第 3 次结束时完全相等 ──────────────────────────
for (const r of over) {
  assert(
    r.save.hp === s3.hp && r.save.mp === s3.mp,
    `(a) 第${r.i}次 hp/mp 变动：${r.save.hp}/${r.save.mp} ≠ 第3次末 ${s3.hp}/${s3.mp}`
  );
}

// ── (b) 不含「获得」「【发现·」 ────────────────────────────────
for (const r of over) {
  assert(!YIELD_RE.test(r.text), `(b) 第${r.i}次正文含产出字样: ${r.text.slice(0, 80)}`);
}

// ── (c) 可见「动静 N/M」计数：N 单调不减且 ≤ M ─────────────────
let prevN = -1;
for (const r of over) {
  const m = r.text.match(METER_RE);
  assert(m, `(c) 第${r.i}次正文缺「动静 N/M」计数: ${r.text.slice(0, 80)}`);
  const n = Number(m[1]);
  const cap = Number(m[2]);
  assert(cap === PITY_LIMIT, `(c) 第${r.i}次 M=${cap} ≠ PITY_LIMIT ${PITY_LIMIT}`);
  assert(n >= prevN, `(c) 第${r.i}次 N=${n} 比上一次 ${prevN} 回落`);
  assert(n <= PITY_LIMIT, `(c) 第${r.i}次 N=${n} 超过 M=${PITY_LIMIT}`);
  prevN = n;
}
assert(prevN > 0, `(c) 7 次观察后计数 N 应 >0，实测 ${prevN}`);

// ── (d) 相邻收束句字符二元组 Jaccard < 0.6 ──────────────────────
for (const r of over.slice(1)) {
  const prev = replies[r.i - 2];
  const j = jaccard(closingSentence(prev.text), closingSentence(r.text));
  console.log(`    J(OBS${prev.i}, OBS${r.i}) = ${j.toFixed(3)}`);
  assert(
    j < 0.6,
    `(d) 第${prev.i}/${r.i}次收束句重合率 ${j.toFixed(3)} ≥ 0.6: ` +
      `「${closingSentence(prev.text).slice(0, 40)}」 vs 「${closingSentence(r.text).slice(0, 40)}」`
  );
}

// ── (e) 每条含可执行指引 /前进|休息|潜行/ ───────────────────────
for (const r of over) {
  assert(ACTION_RE.test(r.text), `(e) 第${r.i}次正文无可执行指引（前进/休息/潜行）: ${r.text.slice(0, 80)}`);
}

ok(`PASS F216 observe-after-cap: 动静 ${over.map((r) => r.text.match(METER_RE)[1]).join("→")}/${PITY_LIMIT}，收束句去同义 + 可执行指引`);
