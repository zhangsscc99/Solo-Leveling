#!/usr/bin/env node
// F165 章节结算断言：新档打通第 1 章主线链（7/7），链尾回包必须带一张
// 【章节结算】卡——战绩（累计击杀/XP/金币，账本结算后值）+ 本章进度 +
// 下一章去处 + 一个真实可达的动作词（「前进」）。同一章只播一次：
// 再发一次「前进」（链尾之后走的是过门/交战分支），回包不得再刷。
//
// 纯 API 驱动：交战 → 「攻击」（HP<50% 且有药先「喝<药名>」），脱战 →
// 「前进」，直到回包出现「【章节结算】」或 60 步用尽。
if (!process.env.API_BASE && process.env.SL_VERIFY_API_BASE) {
  process.env.API_BASE = process.env.SL_VERIFY_API_BASE;
}
const { assert, ok, fail, post, act, fetchSaveView } = await import("./_http.mjs");

const HEAL_NAMES = {
  low_heal_potion: "低级治疗药水",
  mid_heal_potion: "中级治疗药水",
  elixir_of_life: "生命圣水",
};

// 建档（名字唯一）。
const { status, body } = await post("/saves", {
  player_name: `F165-${Date.now().toString(36)}`,
});
assert(status === 201 && body && body.save && body.save.id, `create save failed (HTTP ${status})`);
const id = body.save.id;

let settled = null;
for (let i = 0; i < 60 && !settled; i++) {
  const { save: s, inventory } = await fetchSaveView(id);
  let input = "前进";
  if (s.combat) {
    const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_NAMES[r.item_id]);
    input =
      s.hp > 0 && s.hp < s.max_hp * 0.5 && heal ? `喝${HEAL_NAMES[heal.item_id]}` : "攻击";
  }
  const r = await act(id, input);
  if (r.reply.content.includes("【章节结算】")) settled = r;
}
assert(settled, "60 步内未出现【章节结算】——章节打完仍无收束");

const text = settled.reply.content;
// 打印命中的结算原文（便于人工复核）。
const cardStart = text.indexOf("【章节结算】");
console.log("── 结算原文 ──");
console.log(text.slice(cardStart).split("\n").slice(0, 3).join("\n"));
console.log("──────────────");

assert(/累计击杀\s*\d+/.test(text), `结算缺累计击杀数字：${text.slice(cardStart, cardStart + 160)}`);
assert(/XP\s*\d+/.test(text), `结算缺 XP 数字：${text.slice(cardStart, cardStart + 160)}`);
assert(/7\/7|7\s*\/\s*7/.test(text), `结算缺本章进度 7/7：${text.slice(cardStart, cardStart + 160)}`);
assert(
  text.includes("第 2 章") || text.includes("每日任务"),
  `结算缺下一章去处（第 2 章/每日任务）：${text.slice(cardStart, cardStart + 200)}`
);
assert(text.includes("前进"), `结算缺可执行动作词「前进」：${text.slice(cardStart, cardStart + 200)}`);

// 账本对账：结算卡上的数字必须与回包 save 的真实字段一致（结算后值）。
const m = text.slice(cardStart).match(/累计击杀\s*(\d+)\s*·\s*累计 XP\s*(\d+)\s*·\s*金币\s*(\d+)/);
assert(m, `结算卡数字行形态异常：${text.slice(cardStart, cardStart + 160)}`);
assert(
  Number(m[1]) === settled.save.kills &&
    Number(m[2]) === settled.save.xp &&
    Number(m[3]) === settled.save.gold,
  `结算卡数字与账本不符：卡(kills=${m[1]},xp=${m[2]},gold=${m[3]}) vs save(kills=${settled.save.kills},xp=${settled.save.xp},gold=${settled.save.gold})`
);
assert(
  settled.save.chapter === 1 && settled.save.chapter_completed === true,
  `结算回包应在第 1 章且 chapter_completed=true：ch=${settled.save.chapter} completed=${settled.save.chapter_completed}`
);

// 同一章只播报一次：链尾之后走的是过门/交战分支，再发「前进」不得再刷。
let again = settled;
for (let i = 0; i < 12 && !again.refused && again.save.combat; i++) {
  const { save: s, inventory } = await fetchSaveView(id);
  const heal = (inventory || []).find((r) => r.qty > 0 && HEAL_NAMES[r.item_id]);
  again = await act(
    id,
    s.hp > 0 && s.hp < s.max_hp * 0.5 && heal ? `喝${HEAL_NAMES[heal.item_id]}` : "攻击"
  );
}
const follow = await act(id, "前进");
assert(
  !follow.reply.content.includes("【章节结算】"),
  `重复「前进」又刷出结算卡：${follow.reply.content.slice(-200)}`
);

ok("OK");
