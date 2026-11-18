#!/usr/bin/env node
// F161 行动经济学透明化断言：
//   a) 新档连按「前进」10 次，HP+MP 净消耗必须 > 0（连点不再免费）；
//   b) 10 次内至少触发 1 次遭遇（回包含「遭遇」）或给出可见的遇敌率上升
//      提示（「被惊动」/「遇敌率」）——疾行涨价必须有真实机制支撑；
//   c) 任何回包不得再出现裸句「（本次没有消耗体力）」；零消耗注脚必须带
//      剧情内解释词（只是 / 未耗 / 下一幕 至少其一，服务端实现为 ≥2）；
//   d) 第 1 次与第 10 次回包不得完全一致——数值账单或风险提示至少一处
//      不同（疾行机制真的在改变每一次按压）。
//   e) 存档持久化佐证：save.advance_streak 落库且随连按单调递增（刷新不丢）。
import { assert, ok, makeSave, act, fetchSaveView, advanceStep } from "./_http.mjs";

const BARE_FREE_RE = /（本次没有消耗体力）/;
const FREE_NOTE_RE = /（[^）]*(?:没耗|未耗|不耗|没有消耗|零消耗)[^）]*）/g;
const EXPLAIN_WORDS = ["只是", "未耗", "下一幕"];
const RISK_HINT_RE = /被惊动|遇敌率|疾行/;

const id = await makeSave("f161-cost");
const s0 = (await fetchSaveView(id)).save;
const startVitals = Number(s0.hp) + Number(s0.mp);

const replies = [];
for (let i = 0; i < 10; i++) {
  // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
  const r = await advanceStep(id);
  replies.push(r);
}
const sEnd = (await fetchSaveView(id)).save;
const endVitals = Number(sEnd.hp) + Number(sEnd.mp);
const texts = replies.map((r) => (r.reply && r.reply.content) || "");

// ── a) 连按 10 次必须有净消耗 ──────────────────────────────────
assert(
  startVitals - endVitals > 0,
  `10 次「前进」HP+MP 净消耗应为正：${startVitals} -> ${endVitals}`
);

// ── b) 遭遇或可见的遇敌率上升提示 ─────────────────────────────
const sawEncounter = texts.some((t) => t.includes("遭遇"));
const sawRiskHint = texts.some((t) => RISK_HINT_RE.test(t));
assert(
  sawEncounter || sawRiskHint,
  `10 次内既无【遭遇】也无遇敌率上升提示：\n${texts.map((t, i) => `#${i + 1} ${t.slice(-120)}`).join("\n")}`
);

// ── c) 裸调试腔绝迹 + 零消耗注脚必须带解释词 ──────────────────
for (let i = 0; i < texts.length; i++) {
  const t = texts[i];
  assert(
    !BARE_FREE_RE.test(t),
    `press#${i + 1} 回包仍出现裸句「（本次没有消耗体力）」：${t.slice(-160)}`
  );
  const notes = t.match(FREE_NOTE_RE) || [];
  for (const note of notes) {
    const hits = EXPLAIN_WORDS.filter((w) => note.includes(w)).length;
    assert(hits >= 1, `press#${i + 1} 零消耗注脚缺少解释词（只是/未耗/下一幕）：${note}`);
  }
}
// 开场铺陈步是零消耗幕——10 次内至少要出现过一条带解释词的零消耗注脚。
assert(
  texts.some((t) => (t.match(FREE_NOTE_RE) || []).length > 0),
  "10 次前进未出现任何零消耗注脚（开场铺陈步应免费且带解释）"
);

// ── d) 第 1 次与第 10 次回包/账单不得完全一致 ──────────────────
const sig = (r) =>
  `${r.reply && r.reply.content}|hp=${r.save.hp}|mp=${r.save.mp}`;
assert(
  sig(replies[0]) !== sig(replies[9]),
  `第 1 次与第 10 次回包完全一致——疾行机制未生效：${sig(replies[0]).slice(-160)}`
);

// ── e) 疾行计数落库且曾随连按递增（持久化，刷新不丢） ──────────
// 只断言「曾达到阈值」与「回包值 = 重取值」：中途阵亡会被回溯合法清零，
// 不得把「死过一次」当成机制失效。
const streaks = replies.map((r) => Number(r.save.advance_streak) || 0);
assert(
  Math.max(...streaks) >= 3,
  `advance_streak 未随连按递增到阈值：${streaks.join(",")}`
);
const streakDb = Number((await fetchSaveView(id)).save.advance_streak) || 0;
assert(
  streakDb === streaks[streaks.length - 1],
  `advance_streak 未持久化：回包 ${streaks[streaks.length - 1]} vs 重取 ${streakDb}`
);

// 代价预告字段随存档下发（服务端口径，前端另一车道渲染）。
assert(
  sEnd.advance_cost && typeof sEnd.advance_cost === "object",
  "save.advance_cost 预告字段缺失"
);

ok("OK");
