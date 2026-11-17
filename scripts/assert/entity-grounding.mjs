#!/usr/bin/env node
// F181 验收断言：自由输入命中的场景实体必须落地。
//
//   现状缺陷：「我抬头看了看头顶的裂缝」回包不提「裂缝」，只给通用池
//   句子；换一种措辞问同一实体得到的还是同一条轮转模板。
//
//   断言：新档对「裂缝」「石像」各发 2 句不同措辞（共 4 句）——
//     1) 4 条回包均含对应实体名；
//     2) 同实体两次正文逐字不同（按 save×entity 轮换实体细节）；
//     3) 4 条均不含 /重新审视/（不得退回旧通用观察模板）。
//
//   旧码红证：旧码四条回包均不含「裂缝」细节（断言 1 FAIL），且同实体
//   第二次措辞回到同一条模板（断言 2 FAIL）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, makeSave, act } from "./_http.mjs";

const id = await makeSave("f181-ent");

const CASES = [
  { entity: "裂缝", inputs: ["我抬头看了看头顶的裂缝", "我贴近石壁端详那道裂缝"] },
  { entity: "石像", inputs: ["我屏息盯着那排石像看", "我伸手摸了摸石像的底座"] },
];

for (const { entity, inputs } of CASES) {
  const texts = [];
  for (let i = 0; i < inputs.length; i++) {
    const r = await act(id, inputs[i]);
    const text = r.reply.content;
    assert(
      text.includes(entity),
      `「${inputs[i]}」回包不含点名的实体「${entity}」: ${text.slice(-200)}`
    );
    assert(
      !/重新审视/.test(text),
      `「${inputs[i]}」回包仍含通用观察模板「重新审视」: ${text.slice(-200)}`
    );
    texts.push(text);
  }
  assert(
    texts[0] !== texts[1],
    `同一实体「${entity}」两次不同措辞得到逐字相同的正文——细节未轮换: ${texts[0].slice(0, 80)}`
  );
  console.log(`    实体「${entity}」2 种措辞：均落地实体名、正文互不相同`);
}

ok("entity-grounding OK");
