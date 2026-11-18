#!/usr/bin/env node
// F194 验收断言：升级播报必须如实写出 HP/MP 前后值。
//
//   现状缺陷：Lv.1 打赢守关者时 save.hp=54/max_hp=100，回包只有
//   「【升级】Lv.1 → Lv.2 · 自由属性点 +3 · HP/MP 上限提升」，而顶栏
//   立刻变成 HP 168/168 · MP 64/64——升级回满了，日志一字未提。
//
//   驱动：新档 → 「前进」推进（撞上战斗就打，门前被拒就「攻击」叫阵
//   真打），逐回包盯 save.level；首次升级的那一包即被检对象。
//   断言该回包正文：
//     a) 含「HP」；
//     b) 含升级后真实的 save.hp 与 save.max_hp 数字（取自回包存档，
//        不是模板常量）；
//     c) 含「回满」或「上限」说明。
//   旧码红证：旧文案只有「HP/MP 上限提升」不含任何数字 → b) FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, makeSave, act, fetchSaveView, post, advanceStep } from "./_http.mjs";

const id = await makeSave("f194-levelup");
// 新手装备先穿上，降低驱动中途阵亡的概率（与 _http 驱动同口径）。
for (const itemId of ["rusty_hunting_knife", "worn_leather_vest"]) {
  await post(`/saves/${id}/item`, { item_id: itemId, op: "equip" });
}

let attacks = 0;
let levelReply = null;
let levelSave = null;
for (let i = 0; i < 300 && !levelReply; i++) {
  const { save: s } = await fetchSaveView(id);
  let r;
  if (s.combat) {
    assert(
      ++attacks <= 40 || s.combat.enemy.boss !== true || s.level > 1,
      `守关战已打 ${attacks} 回合仍未升级/未分胜负：${JSON.stringify(s.combat)}`
    );
    assert(attacks <= 200, `累计 ${attacks} 次攻击仍未升级，驱动异常`);
    r = await act(id, "攻击");
  } else {
    // P204：must_choose 场景裸「前进」被拒——advanceStep 自动补发主线
    // 选项；其余门拒（守关者/叫阵/现形）照旧升级处理。
    r = await advanceStep(id);
    if (r.refused === true) {
      // 守关房门拒：「攻击」= 叫阵真开战（boss-refusal-affordance 同口径）。
      r = await act(id, "攻击");
      attacks++;
    }
  }
  if (r.save.level > s.level) {
    levelReply = r.reply.content;
    levelSave = r.save;
  }
}
assert(levelReply, "300 个动作内未发生任何升级，驱动空转");
console.log(`[setup] 升级回包: ${levelReply.replace(/\n/g, " | ").slice(0, 300)}`);
console.log(`[setup] 升级后存档: hp=${levelSave.hp}/${levelSave.max_hp} mp=${levelSave.mp}/${levelSave.max_mp} lv=${levelSave.level}`);

assert(levelReply.includes("HP"), `(a) 升级回包应含「HP」: ${levelReply.slice(-200)}`);
assert(
  levelReply.includes(String(levelSave.hp)) && levelReply.includes(String(levelSave.max_hp)),
  `(b) 升级回包应含真实升级后数值 hp=${levelSave.hp} max_hp=${levelSave.max_hp}: ${levelReply.slice(-240)}`
);
assert(
  /回满|上限/.test(levelReply),
  `(c) 升级回包应解释数值变化（「回满」或「上限」）: ${levelReply.slice(-200)}`
);

ok("OK");
