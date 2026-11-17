#!/usr/bin/env node
// F193 验收断言：「观察/环顾四周」必须有真实回报——
//
//   背景实测（线上 2026-11-17）：ch1 首幕连按 8 次「环顾四周」拿到 8 条
//   不同描写，但 xp/gold/背包/线索全部零变化——「观察」是个只会说话的
//   按钮。本断言钉死新契约：
//     1) ch1_double_gate 三个一次性可发现物（石像/石门/壁画各一）：
//        首次观察命中实体回 discovery（正文含【发现·名字】且背包件数
//        实增——物品走既有 grantRewards 发奖管线入账）；
//     2) 同一实体第二次观察改口「已经查过」，背包件数不变（奖励幂等，
//        只发一次）；
//     3) 不同实体的观察正文不得逐字重复。
//
//   新档天然落 ch1 主线链首（F124），不需 DB 直改落点。存档名走
//   makeSave 的 assert-<tag>-<b36> 形态（含 Date.now().toString(36)，
//   ≤20 字，避开同名 409）。API_BASE 默认 _http.mjs 的 3020，
//   可用环境变量覆盖：
//     PORT=3111 DB_PATH=/tmp/sl-f193.db node server/index.js &
//     API_BASE=http://127.0.0.1:3111/game/api node scripts/assert/observe-discovery.mjs
//
//   旧码红证：旧码观察回包无【发现】且背包零变化，断言 1 必 FAIL。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const bagCount = (view) =>
  (view.inventory || []).reduce((sum, r) => sum + (Number(r.qty) || 0), 0);

const report = (tag, entity, reply, bag) =>
  console.log(
    `    [${tag}] 实体=${entity} · 背包件数=${bag} · ${String(reply.content).replace(/\s+/g, "").slice(0, 60)}`
  );

const id = await makeSave("f193-obs");
const sv0 = await fetchSaveView(id);
assert(
  sv0.save && sv0.save.scene === "ch1_double_gate",
  `setup: 新档应落 ch1_double_gate，实际 scene=${sv0.save && sv0.save.scene}`
);
assert(!sv0.save.combat, "setup: 新档不应处于交战态");

let bag = bagCount(sv0);
console.log(`    建档 id=${id} scene=${sv0.save.scene} 初始背包件数=${bag}`);

// ── 1) 三个不同实体的首次观察：≥2 次【发现】且每次发现背包实增 ──────
const CASES = [
  { entity: "石像", input: "观察石像" },
  { entity: "石门", input: "观察石门" },
  { entity: "壁画", input: "看壁画" },
];

const bodies = [];
let discoveries = 0;
for (const c of CASES) {
  const r = await act(id, c.input);
  const view = await fetchSaveView(id);
  const now = bagCount(view);
  report("first", c.entity, r.reply, now);
  assert(
    r.save.scene === "ch1_double_gate" && !r.save.combat,
    `「${c.input}」观察改动了世界（scene=${r.save.scene} combat=${!!r.save.combat}）`
  );
  if (/【发现/.test(r.reply.content)) {
    discoveries++;
    assert(
      now > bag,
      `「${c.input}」回了【发现】但背包件数未增加（${bag} -> ${now}）: ${r.reply.content.slice(-160)}`
    );
    bag = now;
  }
  bodies.push(r.reply.content);
}
assert(
  discoveries >= 2,
  `3 个不同实体的首次观察应有 ≥2 次【发现】，实际 ${discoveries} 次`
);
assert(
  new Set(bodies).size === bodies.length,
  `不同实体的观察正文逐字重复: ${JSON.stringify(bodies.map((b) => b.replace(/\s+/g, "").slice(0, 40)))}`
);

// ── 2) 同一实体第二次观察：改口「已经查过」+ 背包件数不变 ────────────
{
  const r = await act(id, CASES[0].input);
  const view = await fetchSaveView(id);
  const now = bagCount(view);
  report("repeat", CASES[0].entity, r.reply, now);
  assert(
    /已经查过|已经看过/.test(r.reply.content),
    `同一实体重复观察未改口「已经查过/看过」: ${r.reply.content.slice(-200)}`
  );
  assert(
    now === bag,
    `同一实体重复观察不应再发奖励（背包件数 ${bag} -> ${now}）`
  );
}

ok("observe-discovery OK");
