#!/usr/bin/env node
// F157 未识别指令的场景化兜底契约（全是行为断言）——F166 起拆双契约：
//   自然语言长句（去空白 ≥8 字、无指令信号词）免「系统未识别该指令」
//   前缀，改走世界口吻叙述；指令形态（短词/信号词/数字键位）保留
//   「系统未识别该指令：「X」」回显（F129/F076 客户端靠它开合面板）。
//
//   (a) 新档输「我蹲下检查石阶上的刻痕」（10 字、无信号词 → 自然语言）：
//       回包不得含「未识别该指令」（旧腔调回归即红），仍给可执行动作
//       （观察/前进），且追加一句与输入关键词相关的具象回应（命中
//       刻痕/石/碑词族）；不得含「你是想攻击还是想离开」及任何变体。
//       另发指令形态输入「遭遇哥布林」——回包必须仍含
//       「系统未识别该指令」与原文回显「遭遇哥布林」，锁住
//       「指令形态保留回显、自然语言改口吻」双契约。
//   (b) 同一句连发 3 次——文案不得逐字复读，≥2 条互不相同
//       （族内 ≥3 变体轮换）。
//   (c) 未命中词族的自由输入「我把兜帽拉低」——回包含当前场景名
//       （通用回应兜底），且仍给出 2 个可执行动作词（观察 + 前进）。
//   (d) 全程 intent==="unknown"、HP/MP/scene 零变化（兜底无副作用）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：删掉场景化回应句 → (a) 关键词断言与 (c) 场景名断言
//   FAIL；删掉轮换（同一变体反复返回）→ (b) FAIL；自然语言回包重新
//   挂上「未识别该指令」前缀 → (a) 负向断言 FAIL；指令形态回显被去掉
//   → (a) 末尾「遭遇哥布林」断言 FAIL。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const id = await makeSave("f157-ack");
const { save: s0 } = await fetchSaveView(id);
assert(s0.combat === null, `setup broken: fresh save must be out of combat (${JSON.stringify(s0.combat)})`);
const sceneTitle = s0.scene_title;
assert(typeof sceneTitle === "string" && sceneTitle.length > 0, "setup broken: save must carry a scene_title");

const NO_QUESTION = /你是想攻击还是想离开|你是想攻击还是离开/;

// ── (a) 关键词命中：免前缀（负向）+ 动作 + 具象回应 ────────────────────
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
    !text.includes("未识别该指令"),
    `(a) send#${i + 1} natural-language input must NOT carry「未识别该指令」prefix (F166): ${text.slice(-200)}`
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
console.log("    (a) 刻痕输入：免前缀+动作词+场景化回应全部命中");

// ── (a2) 指令形态保留回显：「遭遇哥布林」必须仍带前缀+原文 ────────────
{
  const r = await act(id, "遭遇哥布林");
  const text = r.reply.content;
  assert(
    text.includes("系统未识别该指令"),
    `(a2) command-form input must keep「系统未识别该指令」prefix: ${text.slice(-200)}`
  );
  assert(
    text.includes("遭遇哥布林"),
    `(a2) command-form input must echo the raw input「遭遇哥布林」: ${text.slice(-200)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `(d)「遭遇哥布林」mutated state: ${JSON.stringify({ hp: r.save.hp, mp: r.save.mp, scene: r.save.scene })}`
  );
  console.log("    (a2) 指令形态「遭遇哥布林」：前缀+原文回显保留");
}

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
