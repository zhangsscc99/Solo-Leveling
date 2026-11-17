#!/usr/bin/env node
// F178 验收断言：观察类散文回包去模板化 + 可执行动词 + 计数口径迁移。
//
//   现状缺陷：observe 构建器以「你放慢呼吸，重新审视」开头（F170 明令
//   禁止的通用观察模板），且整段无可执行动词；observeCount 用旧前缀
//   LIKE 计数——改开头不改计数会让每次观察都回词池第一条。
//
//   断言：新档连发 3 句观察类散文（其中含「裂缝」「墙根」）——
//     1) 3 条正文均不匹配 /重新审视/；
//     2) 3 条均匹配 /观察|前进|潜行/（读完知道下一步）；
//     3) 3 条互不相同（observeCount 新口径轮转仍生效：同存档连做两次
//        观察不得回同一条词池文本）。
//   「观察」是免费环顾：scene/hp/mp 三不变顺带钉住（数值口径零改动）。
//
//   旧码红证：旧前缀命中断言 1 FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const id = await makeSave("f178-obs");
const { save: s0 } = await fetchSaveView(id);
assert(s0.combat === null, `setup broken: fresh save must be out of combat`);

const INPUTS = [
  "我抬头看了看头顶的裂缝",
  "我蹲到墙根仔细看了一遍",
  "我又环顾四周检查了一圈",
];

const texts = [];
for (let i = 0; i < INPUTS.length; i++) {
  const r = await act(id, INPUTS[i]);
  const text = r.reply.content;
  assert(
    !/重新审视/.test(text),
    `send#${i + 1}「${INPUTS[i]}」仍含通用观察模板「重新审视」: ${text.slice(-200)}`
  );
  assert(
    /观察|前进|潜行/.test(text),
    `send#${i + 1}「${INPUTS[i]}」缺可执行动词（观察/前进/潜行）: ${text.slice(-200)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `send#${i + 1} 观察不再是免费环顾（${s0.hp}/${s0.mp}/${s0.scene} -> ${r.save.hp}/${r.save.mp}/${r.save.scene}）`
  );
  texts.push(text);
}
console.log("    3 句观察类散文：无「重新审视」、均含可执行动词、零副作用");

assert(
  new Set(texts).size === texts.length,
  `同存档连续 ${texts.length} 次观察必须互不相同（observeCount 轮转口径）: ${JSON.stringify(texts.map((t) => t.slice(0, 40)))}`
);
console.log(`    同场景连续 ${texts.length} 次观察 → ${new Set(texts).size} 种文案（互不相同）`);

ok("observe-prose-concrete OK");
