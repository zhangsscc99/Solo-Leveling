#!/usr/bin/env node
// P207 观察经济契约（全是行为断言）：
//
//   线上实测（第 38 轮走查）：新档在 ch1_double_gate 连打 6 次「观察」——
//   HP 100/MP 20 全程不变、0 遇敌，第 1/3/4 次各白给一瓶药剂；3/3 之后
//   仍每次产出全新景物描写，尾部却写「这一带已经看熟」。观察成了零成本
//   印钞机：站第一幕就能把背包刷满，战斗难度与资源管理全部失效。
//
//   断言（随机后缀建档，新档天然落 ch1_double_gate，连打 12 次「观察」）：
//     a) 「获得/发现·」类回包 ≤ 3 次——每场景有产出观察封顶 3 次，与
//        既有「探索 N/3」同一口径（含首次免费）；
//     b) 前 3 次正文仍以场景叙述名「「…」——」开头（F092/F178 契约不动）；
//     c) 第 4 次起回包正文不含「获得」「发现·」——不再产出、不再发现，
//        也不得在「已经看熟」的同一条回包里给全新景物；
//     d) 第 4–12 次 encounter_clock（所选代价字段）严格单调上升——每次
//        超盖观察都付一格真实代价，不再是零成本按钮；
//     e) 风险必须真实：若 12 次内真撞上遭遇（encounter 字段/combat），
//        直接记为命中；否则（本实现的口径——观察不自己掷怪，而是把既
//        有保底账推进一格，交由下一次真实行动的 roll 兑现）断言字段增
//        长 + 正文含风险提示，再补发一次「前进」证明保底账不是摆设——
//        clock 已过保底线时落地掷点必中，真实遇敌立刻兑现；
//     f) hp/mp 不作为唯一代价被静默忽略：全程 hp/mp 可以不变，但必须
//        另有一条可量化代价成立（d 的字段单调递增即此代价）。
//
//   旧码红证：旧实现观察 patch 恒 null——encounter_clock 全程为 0，
//   (d) 在第 4 次观察处即 FAIL；「12 次没遇敌 ⇒ 字段增长」同样 0 增长。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView, advanceStep } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

const OBSERVES = 12;
const YIELD_RE = /获得|发现·/;
// 风险提示词族：不钉死某一措辞，任何「动静/循声/找来/惊动/撞上/耗时间」
// 的风险或代价明示都算如实收口；空泛的「看熟」本身不算提示。
const RISK_RE = /动静|循声|找来|惊动|撞上|耗时间|危险|盯上|靠近/;
const scene = CHAPTERS.chapters[0].scenes.find((s) => s.id === "ch1_double_gate");
assert(scene, "oracle: ch1_double_gate missing in chapters.json");
const narrName = scene.narr_name || scene.title;

const id = await makeSave("p207-obs");
const sv0 = await fetchSaveView(id);
assert(
  sv0.save && sv0.save.scene === "ch1_double_gate" && !sv0.save.combat,
  `setup: 新档应落 ch1_double_gate 且无交战: ${JSON.stringify({ scene: sv0.save && sv0.save.scene })}`
);
const s0 = sv0.save;

const replies = [];
for (let i = 1; i <= OBSERVES; i++) {
  const r = await act(id, "观察");
  assert(r.refused !== true, `第${i}次观察被门禁拒绝（非交战态不得拒绝）: ${r.reply.content.slice(0, 80)}`);
  replies.push({ i, text: String(r.reply.content || ""), save: r.save });
  console.log(
    `    OBS${String(i).padStart(2)} clock=${r.save.encounter_clock} hp=${r.save.hp} mp=${r.save.mp} · ` +
      r.reply.content.replace(/\s+/g, "").slice(0, 70)
  );
}

// ── (a) 「获得/发现」类回包 ≤ 3 ──────────────────────────────────
const yields = replies.filter((r) => YIELD_RE.test(r.text));
assert(
  yields.length <= 3,
  `(a) 「获得/发现」类回包 ${yields.length} 次（应 ≤3）: ${replies
    .filter((r) => YIELD_RE.test(r.text))
    .map((r) => `OBS${r.i}`)
    .join(",")}`
);

// ── (b) 前 3 次正文仍以「场景名」开头 ────────────────────────────
for (let i = 0; i < 3; i++) {
  assert(
    replies[i].text.startsWith(`「${narrName}」——`),
    `(b) 第${i + 1}次观察未以「${narrName}」——开头: ${replies[i].text.slice(0, 60)}`
  );
}

// ── (b2) 额度内观察依旧免费：前 3 次 encounter_clock 不变 ───────
for (let i = 0; i < 3; i++) {
  assert(
    Math.trunc(Number(replies[i].save.encounter_clock) || 0) ===
      Math.trunc(Number(s0.encounter_clock) || 0),
    `(b2) 第${i + 1}次观察（额度内）改动了 encounter_clock（${s0.encounter_clock} -> ${replies[i].save.encounter_clock}）——免费环顾契约破了`
  );
}

// ── (c) 第 4 次起正文不含「获得」「发现·」 ───────────────────────
for (const r of replies.slice(3)) {
  assert(
    !YIELD_RE.test(r.text),
    `(c) 第${r.i}次观察（3/3 已封顶）仍含产出字样: ${r.text.slice(0, 120)}`
  );
}

// ── (d) 第 4–12 次 encounter_clock 严格单调上升 ──────────────────
{
  let prev = Math.max(0, Math.trunc(Number(replies[2].save.encounter_clock) || 0));
  for (const r of replies.slice(3)) {
    const cur = Math.trunc(Number(r.save.encounter_clock) || 0);
    assert(
      cur > prev,
      `(d) 第${r.i}次观察代价字段未严格上升（${prev} -> ${cur}）——超盖观察仍是零成本`
    );
    prev = cur;
  }
}

// ── (e) 风险真实：遭遇命中 or 字段增长 + 风险提示 + 保底兑现 ─────
const combatHit = replies.slice(3).find((r) => r.save && r.save.combat);
const riskHint = replies.slice(3).some((r) => RISK_RE.test(r.text));
const clockFinal = Math.trunc(Number(replies[replies.length - 1].save.encounter_clock) || 0);
if (combatHit) {
  console.log(`    (e) 第${combatHit.i}次观察撞上真实遇敌：${JSON.stringify(combatHit.save.combat && combatHit.save.combat.enemy && combatHit.save.combat.enemy.name)}`);
} else {
  assert(
    clockFinal > Math.max(0, Math.trunc(Number(s0.encounter_clock) || 0)),
    `(e) 12 次未遇敌且代价字段零增长（${s0.encounter_clock} -> ${clockFinal}）`
  );
  assert(
    riskHint,
    `(e) 12 次未遇敌时第 4 次起正文必须含风险/代价提示，实际均无: ${replies[3].text.slice(-80)}`
  );
  // 兑现证明：保底账不是摆设——clock 已越过保底线时，下一次真实行动
  // 的掷点必中。连发真实推进（advanceStep 自动消化 must_choose 场景的
  // 显式选择）直至落地掷点，封顶 4 步仍不中才红——真实遇敌 = 代价真实
  // 可观测的最强证据。
  let engaged = null;
  for (let step = 0; step < 4 && !engaged; step++) {
    const r = await advanceStep(id);
    if (r.save && r.save.combat) engaged = r;
  }
  assert(
    engaged && engaged.save.combat,
    `(e) 代价字段已涨至 ${clockFinal}（过保底线），随后 4 步真实推进仍未掷出真实遇敌——` +
      `保底账不兑现即是假代价`
  );
  console.log(
    `    (e) 保底兑现：连蹲观察把 encounter_clock 推到 ${clockFinal} 后，「前进」撞上 ` +
      `${engaged.save.combat.enemy.name} Lv.${engaged.save.combat.enemy.level}——代价真实`
  );
}

// ── (f) hp/mp 不作为唯一代价被静默忽略 ───────────────────────────
{
  const hpChanged = replies.some((r) => r.save.hp !== s0.hp || r.save.mp !== s0.mp);
  const quantified = clockFinal > Math.max(0, Math.trunc(Number(s0.encounter_clock) || 0));
  assert(
    hpChanged || quantified,
    `(f) 12 次观察 hp/mp 未变且无任何可量化代价（encounter_clock ${s0.encounter_clock} -> ${clockFinal}）`
  );
}

ok("observe-economy OK");
