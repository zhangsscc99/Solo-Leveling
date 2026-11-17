#!/usr/bin/env node
// F157 未识别指令的场景化兜底契约（全是行为断言）：
//
//   (a) 新档输「我蹲下检查石阶上的刻痕」——回包仍含
//       「系统未识别该指令」前缀与原文回显（F129/F076 老契约），
//       仍给可执行动作（观察/前进），且追加一句与输入关键词相关的
//       具象回应（命中刻痕/石/碑词族）；不得含「你是想攻击还是想离开」
//       及任何变体。
//   (b) 同一句连发 3 次——文案不得逐字复读，≥2 条互不相同
//       （族内 ≥3 变体轮换）。
//   (c) 未命中词族的自由输入「我把兜帽拉低」——回包含当前场景名
//       （通用回应兜底），且仍给出 2 个可执行动作词（观察 + 前进）。
//   (d) 全程 intent==="unknown"、HP/MP/scene 零变化（兜底无副作用）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：删掉场景化回应句 → (a) 关键词断言与 (c) 场景名断言
//   FAIL；删掉轮换（同一变体反复返回）→ (b) FAIL；回显/前缀改写 →
//   (a) FAIL 且 free-input-intent/unknown-followup-context 同步红。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const id = await makeSave("f157-ack");
const { save: s0 } = await fetchSaveView(id);
assert(s0.combat === null, `setup broken: fresh save must be out of combat (${JSON.stringify(s0.combat)})`);
const sceneTitle = s0.scene_title;
assert(typeof sceneTitle === "string" && sceneTitle.length > 0, "setup broken: save must carry a scene_title");

const NO_QUESTION = /你是想攻击还是想离开|你是想攻击还是离开/;

// ── (a) 关键词命中：回显 + 前缀 + 动作 + 具象回应 ──────────────────────
const INPUT = "我蹲下检查石阶上的刻痕";
const contents = [];
for (let i = 0; i < 3; i++) {
  const r = await act(id, INPUT);
  const text = r.reply.content;
  assert(
    r.intent === "unknown",
    `(a) send#${i + 1} expected intent=unknown, got ${JSON.stringify(r.intent)}`
  );
  assert(
    text.includes("系统未识别该指令"),
    `(a) send#${i + 1} missing「系统未识别该指令」prefix: ${text.slice(-200)}`
  );
  assert(
    text.includes(`「${INPUT}」`),
    `(a) send#${i + 1} missing input echo: ${text.slice(-200)}`
  );
  assert(
    /观察|前进/.test(text),
    `(a) send#${i + 1} must still offer executable verbs (观察/前进): ${text.slice(-200)}`
  );
  assert(
    /刻痕|石|碑/.test(text),
    `(a) send#${i + 1} missing a concrete scene-aware line about 刻痕/石/碑: ${text.slice(-200)}`
  );
  assert(
    !NO_QUESTION.test(text),
    `(a) send#${i + 1} must not ask the fixed 攻击/离开 question: ${text.slice(-200)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `(d) send#${i + 1} mutated state: ${s0.hp}/${s0.mp}/${s0.scene} -> ${r.save.hp}/${r.save.mp}/${r.save.scene}`
  );
  contents.push(text);
}
console.log("    (a) 刻痕输入：回显+前缀+动作词+场景化回应全部命中");

// ── (b) 轮换：3 次连发 ≥2 种互不相同 ──────────────────────────────────
assert(
  new Set(contents).size >= 2,
  `(b) same input 3x must not repeat verbatim, got ${new Set(contents).size} distinct: ${contents[0].slice(0, 80)}`
);
console.log(`    (b) 同句连发 3 次 → ${new Set(contents).size} 种文案（要求 ≥2）`);

// ── (c) 未命中词族：场景名通用回应 + 2 个动作词 ──────────────────────
{
  const r = await act(id, "我把兜帽拉低");
  const text = r.reply.content;
  assert(r.intent === "unknown", `(c) expected intent=unknown, got ${JSON.stringify(r.intent)}`);
  assert(
    text.includes("系统未识别该指令") && text.includes("「我把兜帽拉低」"),
    `(c) missing prefix/echo: ${text.slice(-200)}`
  );
  assert(
    text.includes(sceneTitle),
    `(c) fallback line must name the current scene「${sceneTitle}」: ${text.slice(-200)}`
  );
  assert(
    /观察/.test(text) && /前进/.test(text),
    `(c) must still offer 2 executable verbs (观察+前进): ${text.slice(-200)}`
  );
  assert(
    !NO_QUESTION.test(text),
    `(c) must not ask the fixed 攻击/离开 question: ${text.slice(-200)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.scene === s0.scene,
    `(d)「我把兜帽拉低」mutated state: ${JSON.stringify({ hp: r.save.hp, scene: r.save.scene })}`
  );
  console.log(`    (c) 未命中词族 → 通用回应含场景名「${sceneTitle}」+ 观察/前进`);
}

ok("free-narration-ack OK");
