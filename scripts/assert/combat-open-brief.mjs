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
//     b) 系统段落总字数 ≤ 200 字——要压的是系统行，不是叙事正文；
//        落点场景 text 必须完整在场（一字不删，F074 契约口径）；
//     c) 必含「攻击」与「逃跑」两个动作词；
//     d) 必含实测敌方 HP 数字（ch1 石像守卫 = 75）。
//     e) 落地残血（HP<60%）属合法展开分支：系统段落可超 200 字，但
//        段落数仍 ≤2、场景正文仍完整、恢复指引（估算/休息/补给路径）
//        必须在场——本断言两种落点都验，只放过「如实展开」一种。
//
//   旧码红证：系统段 3–5 段（遭遇+提示+系统+任务），系统行 300+ 字，
//   (a)(b) 必红。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, ok, makeSave, act, fetchSaveView, advanceTraverse } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHAPTERS = require(path.join(ROOT, "server", "data", "chapters.json"));

const stripWs = (s) => String(s || "").replace(/\s+/g, "");
const sceneTextById = new Map();
for (const c of CHAPTERS.chapters) for (const s of c.scenes) sceneTextById.set(s.id, s.text);

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

// (a) 「【」开头的系统段落 ≤ 2，且落地回包不得出现【任务】段头
//     （任务奖励压成末尾一句，不在段落计数内）。
const sysParas = text.split(/\n/).filter((l) => l.trimStart().startsWith("【"));
assert(
  sysParas.length <= 2,
  `(a) 落地开战系统段落 ${sysParas.length} 段（期望 ≤2）：\n${sysParas.join("\n")}`
);
assert(
  !sysParas.some((l) => l.trimStart().startsWith("【任务】")),
  `(a) 落地开战回包不得出现【任务】段头：\n${sysParas.join("\n")}`
);

// (b) 落点场景 text 必须完整在场（一字不删——F074 契约；要压的是系统
//     行不是叙事正文）。系统段落总字数 ≤ 200；残血落地（<60%）是合法
//     的完整指引分支，放行字数但同样不得回退成「三件事变回五件事」。
const sceneText = sceneTextById.get(landing.save.scene);
assert(
  typeof sceneText === "string" && sceneText.length >= 12,
  `oracle: landing scene ${landing.save.scene} text missing`
);
assert(
  stripWs(text).includes(stripWs(sceneText)),
  `(b) 落地开战回包缺落点场景 ${landing.save.scene} 的完整正文（截断即 F074 回归）`
);
const sysChars = sysParas.reduce((n, l) => n + l.trim().length, 0);
if (pct >= 60) {
  assert(
    sysChars <= 200,
    `(b) 落地开战系统段落总字数 ${sysChars}（期望 ≤200）：\n${sysParas.join("\n")}`
  );
} else {
  assert(
    /估算|休息|补给/.test(text),
    `(e) HP<60% 落地应展开完整恢复指引（估算/休息/补给），实得：\n${text.slice(-220)}`
  );
  console.log(`    (e) 落地残血 ${pct}%：走完整恢复指引分支，跳过 200 字上限`);
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
