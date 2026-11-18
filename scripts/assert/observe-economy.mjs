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
//     d) 第 4–6 次 encounter_clock（所选代价字段）严格单调上升——每次
//        超盖观察都付一格真实代价，不再是零成本按钮。F257 起第 7 次
//        （clockNext>=PITY_LIMIT）保底账当场兑现成真实遭遇、clock 归
//        零——严格递增断言只管到兑现前夜，归零是兑现不是赖账；
//     e) 风险必须真实且必兑现：第 7 次观察回包 save.combat 非空（撞上
//        真实遭遇），第 8 次起「观察」被交战门禁 refused 拦回——
//        「一直观察」从此不是零成本选项；
//     f) hp/mp 不作为唯一代价被静默忽略：全程 hp/mp 可以不变，但必须
//        另有一条可量化代价成立（d 的字段递增 + e 的遭遇兑现即此代价）。
//
//   F257 口径变更说明：旧版（P207/F225 时代）观察不自己掷怪，只把保底
//   账推进一格交由下一次真实行动的 roll 兑现——本断言当时的 (e) 因此
//   写了「未遇敌则补发前进证明保底必中」的兜底分支。第 52–54 轮走查实
//   测连点 8 次零遭遇（威胁停在纸面），F257 把 clockNext>=4 的那次观察
//   改为直接经 tryEncounter 开战——兑现点从「下一次行动」提前到「攒过
//   线的这一下」，本断言相应把 (e) 收紧成「第 7 次必撞、第 8 次起必拒」
//   （断言强度上调而非放宽：旧口径允许 12 次全程不撞）。
//
//   旧码红证：旧实现观察 patch 恒 null——encounter_clock 全程为 0，
//   (d) 在第 4 次观察处即 FAIL；F257 前夜码（观察永不掷怪）在 (e) 处
//   FAIL——第 7 次没有 save.combat。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

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
  // F257：第 7 次保底账兑现开战，第 8 次起交战门禁必须把「观察」拦回
  // （refused）——兑现前不得拒绝、兑现后必须拒绝。
  if (i <= 7) {
    assert(r.refused !== true, `第${i}次观察被门禁拒绝（兑现前不得拒绝）: ${r.reply.content.slice(0, 80)}`);
  } else {
    assert(r.refused === true, `第${i}次观察未被交战门禁拦回——「一直观察」仍是零成本`);
  }
  replies.push({ i, text: String(r.reply.content || ""), save: r.save });
  console.log(
    `    OBS${String(i).padStart(2)} refused=${r.refused === true} clock=${r.save.encounter_clock} hp=${r.save.hp} mp=${r.save.mp} · ` +
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

// ── (d) 第 4–6 次 encounter_clock 严格单调上升；第 7 次兑现归零 ──
{
  let prev = Math.max(0, Math.trunc(Number(replies[2].save.encounter_clock) || 0));
  for (const r of replies.slice(3, 6)) {
    const cur = Math.trunc(Number(r.save.encounter_clock) || 0);
    assert(
      cur > prev,
      `(d) 第${r.i}次观察代价字段未严格上升（${prev} -> ${cur}）——超盖观察仍是零成本`
    );
    prev = cur;
  }
  // 兑现不是赖账：保底账攒过线的那次观察直接开战，clock 归 0 重新计。
  assert(
    Math.trunc(Number(replies[6].save.encounter_clock) || 0) === 0,
    `(d) 第7次观察（保底兑现）encounter_clock 未归零: ${replies[6].save.encounter_clock}`
  );
}

// ── (e) 风险必兑现：第 7 次撞上真实遭遇，第 4–6 次正文含风险提示 ──
const combatHit = replies.slice(3).find((r) => r.save && r.save.combat);
const riskHint = replies.slice(3, 6).every((r) => RISK_RE.test(r.text));
const clockFinal = Math.trunc(Number(replies[replies.length - 1].save.encounter_clock) || 0);
assert(
  combatHit && combatHit.i === 7,
  `(e) 第7次观察未撞上真实遭遇（首个带交战回包在第 ${combatHit ? combatHit.i : "—"} 次）——` +
    `保底账攒过线仍是纸面威胁`
);
console.log(
  `    (e) 第${combatHit.i}次观察撞上真实遇敌：${JSON.stringify(combatHit.save.combat && combatHit.save.combat.enemy && combatHit.save.combat.enemy.name)}`
);
assert(
  riskHint,
  `(e) 第 4–6 次正文必须各含风险/代价提示: ${replies[3].text.slice(-80)}`
);
// 兑现后再观察：交战门禁拦回且正文不含景物复述（「<name>」—— 开头即
// 景物行口径，拒绝文案是【战斗】/【系统】行）。
for (const r of replies.slice(7)) {
  assert(
    !r.text.startsWith(`「${narrName}」——`),
    `(e) 第${r.i}次观察（交战态）仍产出景物正文: ${r.text.slice(0, 80)}`
  );
}

// ── (f) hp/mp 不作为唯一代价被静默忽略 ───────────────────────────
{
  const hpChanged = replies.some((r) => r.save.hp !== s0.hp || r.save.mp !== s0.mp);
  const quantified =
    clockFinal > Math.max(0, Math.trunc(Number(s0.encounter_clock) || 0)) ||
    Boolean(combatHit);
  assert(
    hpChanged || quantified,
    `(f) 12 次观察 hp/mp 未变且无任何可量化代价（encounter_clock ${s0.encounter_clock} -> ${clockFinal}）`
  );
}

ok("observe-economy OK");
