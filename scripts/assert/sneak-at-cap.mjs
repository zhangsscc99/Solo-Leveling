#!/usr/bin/env node
// F188 验收断言：潜行额度已满（2/2）时再潜不得「白扣 5 MP」。
//
//   现状缺陷：stealth_charges 上限 2，连潜第 3 次正文仍是
//   「（魔力消耗 MP 10→5）【潜行】…（潜行 2/2）」——额度没涨、世界
//   没有任何变化，玩家却继续付 5 MP，属「花钱买同一句话」。
//
//   断言（新档连潜 3 次）：
//     a) 前两次正常成交：refused!==true、MP 逐次 -5、额度 1→2；
//     b) 第 3 次两种合法口径取其一——
//        ① refused===true 且 MP/额度不变（推荐：拒绝并如实说明）；
//        ② 未拒则正文必须明说「不叠加/已满」（等价收益口径）；
//        两种情况都不得出现「额度未变但 MP 照扣」的静默浪费；
//     c) 第 3 次后 stealth_charges 仍 =2（上限不被写穿）。
//
//   旧码红证：b) 第 3 次 refused!==true、MP 5、正文既无「不叠加」也
//   无「已满」——静默浪费口径必红。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, post, act, fetchSaveView } from "./_http.mjs";

const name = `f188-${Date.now().toString(36)}`;
const { status, body } = await post("/saves", { player_name: name });
assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
const id = body.save.id;
console.log(`[setup] 建档 ${name} → save_id=${id}`);

let s = (await fetchSaveView(id)).save;
const mp0 = Number(s.mp) || 0;
assert(mp0 >= 15, `[setup] 建档 MP ${mp0} 不够连潜 3 次（需 ≥15）——前置环境异常`);

// a) 前两次潜行正常成交：MP 逐次 -5、额度 1→2。
const r1 = await act(id, "潜行");
assert(r1.refused !== true, `(a) 第 1 次潜行不应被拒: ${r1.reply.content.slice(-120)}`);
assert(
  r1.save.mp === mp0 - 5 && Number(r1.save.stealth_charges) === 1,
  `(a) 第 1 次潜行应 MP-5 且额度=1：mp ${r1.save.mp} charges ${r1.save.stealth_charges}`
);
const r2 = await act(id, "潜行");
assert(r2.refused !== true, `(a) 第 2 次潜行不应被拒: ${r2.reply.content.slice(-120)}`);
assert(
  r2.save.mp === mp0 - 10 && Number(r2.save.stealth_charges) === 2,
  `(a) 第 2 次潜行应 MP-5 且额度=2：mp ${r2.save.mp} charges ${r2.save.stealth_charges}`
);
console.log(`(a) 两次成交：mp ${mp0}->${r2.save.mp} · stealth_charges=2/2（已满）`);

// b) 第 3 次：要么 refused 且 MP 不变，要么正文明说「不叠加/已满」；
//    两种情况都不得「额度未变但 MP 照扣」。
const mpBefore = r2.save.mp;
const r3 = await act(id, "潜行");
const t = r3.reply.content;
console.log(`(b) 第 3 次潜行回包：refused=${r3.refused} mp ${mpBefore}->${r3.save.mp} charges=${r3.save.stealth_charges}\n    ${t.slice(-160)}`);
assert(
  Number(r3.save.stealth_charges) === 2,
  `(c) 第 3 次后 stealth_charges 应仍 =2（上限不被写穿），实得 ${r3.save.stealth_charges}`
);
if (r3.refused === true) {
  assert(
    r3.save.mp === mpBefore,
    `(b) 满额拒绝却照扣 MP：${mpBefore} -> ${r3.save.mp}`
  );
  console.log(`    (b) 口径①：refused + MP 不变 ✓`);
} else {
  assert(
    /不叠加|已满/.test(t),
    `(b) 第 3 次潜行未拒但正文未明说「不叠加/已满」：${t.slice(-160)}`
  );
  console.log(`    (b) 口径②：未拒但正文明说满额 ✓`);
}
const silentWaste =
  r3.refused !== true &&
  r3.save.mp === mpBefore - 5 &&
  !/不叠加|已满/.test(t);
assert(
  !silentWaste,
  `(b) 额度未变但 MP 照扣——花钱买同一句话：${t.slice(-160)}`
);

ok("sneak-at-cap OK");
