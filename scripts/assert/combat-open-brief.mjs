#!/usr/bin/env node
// F187 验收断言：守关战落地那一刻一屏只留三件事——敌方 HP、我方 HP、
// 下一步该按什么（一行）。
//
//   现状缺陷：落地开战回包同屏塞 5–6 段——整段场景正文 +【遭遇】+
//   【提示：撤离】+【任务：每日任务完成】+【系统】约 150 字状态块，
//   玩家要读完最后一行才敢按「攻击」，而这一屏真正要他做的只有一个
//   动作。
//
//   断言（新档推进到守关战落地的那一次回包）：
//     a) 以「【」开头的系统段落 ≤ 2 段（遭遇/提示/任务合并为一到两条，
//        任务奖励压成末尾一句、不再单开【任务】段）；
//     b) 正文总长 ≤ 320 字；
//     c) 必含「攻击」与「逃跑」两个动作词；
//     d) 必含实测敌方 HP 数字（ch1 石像守卫 = 75）。
//     e) 落地残血（HP<60%）属合法展开分支：正文可超 320 字，但系统段
//        仍 ≤2、恢复指引（估算/休息/补给路径）必须在场——本断言两种
//        落点都验，只放过「如实展开」一种。
//
//   旧码红证：系统段 3–5 段（遭遇+提示+系统+任务），正文 480+ 字，
//   (a)(b) 必红。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, makeSave, act, fetchSaveView, advanceTraverse } from "./_http.mjs";

const id = await makeSave("f187-brief");
console.log(`[setup] 新档 save_id=${id}，推进到守关战落地`);

// advanceTraverse 每次真实位移即回（小怪真打攒级、残血先补给/休息），
// boss 场景落地必开战——返回里 save.combat.enemy.boss=true 的那次回包
// 就是落地开战回包。
let landing = null;
for (let i = 0; i < 25 && !landing; i++) {
  const r = await advanceTraverse(id);
  const e = r && r.save && r.save.combat && r.save.combat.enemy;
  if (e && e.boss === true) landing = r;
}
assert(landing, "25 轮推进内仍未落地守关战");

const text = landing.reply.content;
const e = landing.save.combat.enemy;
const hp = Math.trunc(Number(landing.save.hp) || 0);
const maxHp = Math.max(1, Math.trunc(Number(landing.save.max_hp) || 1));
const pct = Math.round((hp / maxHp) * 100);
console.log(`[land] enemy=${e.name} ${e.hp}/${e.max_hp} 你 hp=${hp}/${maxHp} (${pct}%)`);
console.log(`[land] 回包总长=${text.length} 字:\n${text}`);

// (a) 「【」开头的系统段落 ≤ 2
const sysParas = text.split(/\n/).filter((l) => l.trimStart().startsWith("【"));
assert(
  sysParas.length <= 2,
  `(a) 落地开战系统段落 ${sysParas.length} 段（期望 ≤2）：\n${sysParas.join("\n")}`
);

// (b) 正文总长 ≤ 320——残血落地（<60%）是合法的完整指引分支，放行长度
//     但同样不得回退成「三件事变回五件事」。
if (pct >= 60) {
  assert(
    text.length <= 320,
    `(b) 落地开战正文 ${text.length} 字（期望 ≤320）：\n${text}`
  );
} else {
  assert(
    /估算|休息|补给/.test(text),
    `(e) HP<60% 落地应展开完整恢复指引（估算/休息/补给），实得：\n${text.slice(-220)}`
  );
  console.log(`    (e) 落地残血 ${pct}%：走完整恢复指引分支，跳过 320 字上限`);
}

// (c) 动作词在场
assert(text.includes("攻击"), `(c) 回包缺「攻击」动词：\n${text.slice(-200)}`);
assert(text.includes("逃跑"), `(c) 回包缺「逃跑」动词：\n${text.slice(-200)}`);

// (d) 实测敌方 HP 数字在场（ch1 石像守卫 = 75/75 满血开战）
assert(e.hp === 75, `(d) ch1 守关者 HP 应为 75，实得 ${e.hp}（非残血续打口径）`);
assert(
  text.includes(String(e.hp)),
  `(d) 回包缺实测敌方 HP 数字 ${e.hp}：\n${text.slice(-200)}`
);

ok("combat-open-brief OK");
