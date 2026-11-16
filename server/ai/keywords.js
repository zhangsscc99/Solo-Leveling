// 指令词表单一事实源：/action 的 resolveAction 与 /ai-action 的规则兜底
// （fallback.parse）共用这张有序匹配表，两条路径解析结果永远一致，不再漂移。
//
// 匹配语义（对齐 main 上既有行为）：
//   · 影子三条（F051 新增指令）：句首锚定，正则来自 engine/shadow，
//     叙述句不触发；
//   · 其余七条（既有意图）：子串匹配 —— 关键词出现在输入任意位置即命中，
//     不得加 ^ 锚点。「我要休息一下」「先观察四周」都必须识别。
//   · 按表序取首个命中；影子指令排在通用词之前，避免被「查看」抢先。
//
// resolveIntent(input) -> intent id | null
//   null 对应 /action 的 unknown（占位文案）；fallback 会把 null 转成 observe。
const { DEPLOY_COMMAND, UNDEPLOY_COMMAND, FORMATION_COMMAND } = require("../engine/shadow");

const INTENT_MATCHERS = [
  { intent: "shadow_deploy", match: DEPLOY_COMMAND },
  { intent: "shadow_undeploy", match: UNDEPLOY_COMMAND },
  { intent: "shadow_formation", match: FORMATION_COMMAND },
  // F088 战斗意图：无交战时由遭遇表判定能否开战，交战中走 resolveTurn。
  // F137：补口语化攻击表述（挥拳/出手/劈/揍/砸/打它）——「对着石像挥一拳」
  // 此前落未识别，交战中白输一回合。仍不加裸「打」：会吞掉「打开背包」
  // 「打招呼」这类非战斗输入。
  { intent: "attack", match: /攻击|打击|砍|斩|刺|击杀|消灭|猎杀|挥[^，。！？]{0,3}拳|挥刀|劈|打它|打你|揍|出手|砸|attack|strike|fight/i },
  { intent: "skill", match: /释放技能|施放技能|使用技能|施放|咏唱|释放|skill|cast/i },
  { intent: "defend", match: /防御|格挡|招架|防守|defend|block|guard/i },
  { intent: "item", match: /使用道具|道具|喝药|吃药|use item|use potion|item/i },
  // F137：补脱离语义（离开/撤离/回到/走人……）。「离开」此前被 advance
  // 抢走——惩罚副本门口输「离开这里」反而推进撞守关者，方向与语义相反。
  { intent: "flee", match: /逃跑|逃离|撤退|逃走|离开|撤离|回到|回去|返回|脱战|溜走|走人|flee|escape|retreat/i },
  { intent: "status", match: /状态|面板|属性|status|stat/i },
  { intent: "help", match: /帮助|指令|help/i },
  { intent: "observe", match: /观察|查看|环顾|四周|环境|看|look|inspect/i },
  { intent: "advance", match: /前进|继续|探索|走|移动|进入|深入|前行|advance|explore|go|move|continue/i },
  { intent: "sneak", match: /潜行|藏匿|隐蔽|躲|sneak|stealth|hide/i },
  { intent: "rest", match: /休息|睡觉|休整|小憩|恢复|rest|sleep/i },
  { intent: "save", match: /存档|保存|save/i },
];

function resolveIntent(input) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return null;
  for (const rule of INTENT_MATCHERS) {
    try {
      if (rule.match.test(text)) return rule.intent;
    } catch {
      // 某条正则异常不该拖垮整轮解析，跳过继续。
    }
  }
  return null;
}

module.exports = { INTENT_MATCHERS, resolveIntent };
