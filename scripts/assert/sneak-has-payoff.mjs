#!/usr/bin/env node
// F184 验收断言：「潜行」烧 MP 必须换来可观测的世界变化。
//
//   现状缺陷：潜行只扣 5 MP + 从章池取一句轮换文案，世界状态零变化
//   ——连潜 4 次 MP 20→0，场景、遇敌、任何字段都不动。
//
//   断言：
//     a) 新档连潜 2 次（额度上限即 2——F188 起第 3 次是被如实拒绝的
//        另一车道口径，由 sneak-at-cap.mjs 覆盖）：MP 逐次 -5、两次
//        正文互不相同、每次正文都带增益承诺词（更难被发现/不易被发现/
//        潜行增益/未被察觉）；
//     b) 存档回包带 stealth_charges 字段且潜行后 ≥1（额度真实入账）；
//     c) 随后连发 3 次「前进」：至少一次回包出现「没有被察觉」或
//        stealth_charges 下降——潜行确实抑制了遭遇；且 3 次前进中
//        至少 1 次真的进入遭遇或推进了场景——抑制不得把主线卡死。
//
//   旧码红证：a) 第二条正文与第一条逐字相同（池子只有 2 句轮换旧文
//   案无增益承诺词）；b) 无 stealth_charges 字段；c) 无「没有被察觉」。
//   口径变更：F188 起潜行额度满（2/2）再潜一律 refused——本断言的
//   「每次 MP-5 都有收益」契约由 2 次成交完整覆盖，不再连潜第 3 次。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, post, act, fetchSaveView, advanceStep } from "./_http.mjs";

const PAYOFF_WORD = /更难被发现|不易被发现|潜行增益|未被察觉/;

const name = `f184-${Date.now().toString(36)}`;
const { status, body } = await post("/saves", { player_name: name });
assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
const id = body.save.id;
console.log(`[setup] 建档 ${name} → save_id=${id}`);

let s = (await fetchSaveView(id)).save;
assert(
  typeof s.stealth_charges === "number",
  `(b) /saves/:id 回包必须带 stealth_charges 字段: ${JSON.stringify(Object.keys(s))}`
);
const mp0 = s.mp;
assert(mp0 >= 10, `(a) 建档 MP ${mp0} 不够连潜 2 次（需 ≥10）——前置环境异常`);

// a) 连潜 2 次（即满额）：MP 逐次 -5、正文互不相同、每次带增益承诺词。
//    F188 起第 3 次是满额拒绝（sneak-at-cap.mjs 口径），不在本断言范围。
const texts = [];
for (let i = 0; i < 2; i++) {
  const r = await act(id, "潜行");
  assert(
    r.refused !== true,
    `(a) sneak#${i + 1} 不应被拒（MP ${mp0 - 5 * i}→?）: ${r.reply.content.slice(-120)}`
  );
  assert(
    r.save.mp === mp0 - 5 * (i + 1),
    `(a) sneak#${i + 1} MP 应 -5: ${mp0 - 5 * i} -> ${r.save.mp}`
  );
  const c = r.reply.content;
  texts.push(c);
  console.log(`(a) sneak#${i + 1} 正文前120字: ${c.slice(0, 120)}`);
  assert(
    PAYOFF_WORD.test(c),
    `(a) sneak#${i + 1} 正文须带增益承诺词（更难被发现|不易被发现|潜行增益|未被察觉）: ${c.slice(-160)}`
  );
}
assert(
  new Set(texts).size === 2,
  `(a) 2 次潜行正文互不相同（实得 ${new Set(texts).size} 种）`
);

// b) 额度真实入账。
s = (await fetchSaveView(id)).save;
console.log(`(b) stealth_charges=${s.stealth_charges} mp=${s.mp}`);
assert(
  Math.trunc(Number(s.stealth_charges)) >= 1,
  `(b) 潜行后 stealth_charges 应 ≥1（实得 ${s.stealth_charges}）`
);
assert(
  Math.trunc(Number(s.stealth_charges)) <= 2,
  `(b) stealth_charges 上限 2（实得 ${s.stealth_charges}）`
);

// c) 连发 3 次「前进」：潜行必须真的抑制遭遇，且主线不被卡死。
let prev = s;
let unnoticed = 0;
let progressed = 0;
let chargesDropped = false;
for (let i = 0; i < 3; i++) {
  // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线选项。
  const r = await advanceStep(id);
  const c = r.reply.content;
  console.log(`(c) advance#${i + 1} 正文前120字: ${c.slice(0, 120)}`);
  if (c.includes("没有被察觉")) unnoticed++;
  if (
    Math.trunc(Number(r.save.stealth_charges)) < Math.trunc(Number(prev.stealth_charges))
  ) {
    chargesDropped = true;
  }
  if (
    r.save.combat ||
    r.save.scene !== prev.scene ||
    r.save.chapter !== prev.chapter
  ) {
    progressed++;
  }
  prev = r.save;
}
assert(
  unnoticed >= 1 || chargesDropped,
  `(c) 潜行未抑制任何遭遇（「没有被察觉」×${unnoticed}，charges 降=${chargesDropped}）`
);
assert(
  progressed >= 1,
  `(c) 3 次前进中至少 1 次须真进遭遇或推进场景（progressed=${progressed}）——抑制不得卡死主线`
);
console.log(`    (c) 未被察觉×${unnoticed} · 真实推进×${progressed} · charges 终值=${prev.stealth_charges}`);

ok("OK");
