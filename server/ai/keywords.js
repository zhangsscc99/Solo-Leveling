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
  // F150：「叫阵」「挑战」「叫阵守关者」纳入 attack——守关者门前的文字
  // 叫阵与主按钮「叫阵守关者」是同一个真实入口（peacefulCombatIntent 的
  // bossChallenge 分支 forceBoss 压过再入冷却）；此前裸输「叫阵」落
  // unknown，拒绝文案指的可输入动词根本不存在。
  { intent: "attack", match: /攻击|打击|砍|斩|刺|击杀|消灭|猎杀|叫阵|挑战|挥[^，。！？]{0,3}拳|挥刀|劈|打它|打你|揍|出手|砸|attack|strike|fight/i },
  { intent: "skill", match: /释放技能|施放技能|使用技能|施放|咏唱|释放|skill|cast/i },
  { intent: "defend", match: /防御|格挡|招架|防守|defend|block|guard/i },
  // F144/F145：「使用/服用/喝/吃 + 药名」也算道具意图（交战/脱战同生效）。
  // F154 收窄：「使用 X」只在 X 带补给词尾（圣水/药/剂/水/丸）时判 item——
  // 「使用钥匙开门」「使用 力量加点」回落 unknown，不再被吞成「名为钥匙
  // 开门的补给」；「喝/吃 X」同样要词尾，且「喝」的合法词尾不含裸「水」
  // ——「喝水」「喝彩」不烧药（背包有真补给且输入点名时，由 resolveIntent
  // 的 supplyNames 兜底接住，词表本身不猜库存）。
  { intent: "item", match: /使用道具|道具|使用\s*[^\s，。！？]{0,8}(?:圣水|药|剂|水|丸)|服用|喝药|吃药|喝\s*[^\s，。！？]{0,8}(?:圣水|药|剂|丸)|吃\s*[^\s，。！？]{0,8}(?:药|剂|丸)|use\s+\w+|drink|item/i },
  // F137：补脱离语义（离开/撤离/回到/走人……）。「离开」此前被 advance
  // 抢走——惩罚副本门口输「离开这里」反而推进撞守关者，方向与语义相反。
  // F140：再补往回|回头|退回去|原路返回——「往回走」的裸「走」被 advance
  // 抢走（实测 ch3 倒退输入真推进一幕）；只补完整词组，不写裸「退」，
  // 避免把「撤退/退回……」之外的说法误吞（「退回去」本就含「回去」）。
  { intent: "flee", match: /逃跑|逃离|撤退|逃走|离开|撤离|回到|回去|返回|往回|回头|退回去|原路返回|脱战|溜走|走人|flee|escape|retreat/i },
  { intent: "status", match: /状态|面板|属性|status|stat/i },
  { intent: "help", match: /帮助|指令|help/i },
  { intent: "observe", match: /观察|查看|环顾|四周|环境|看|look|inspect/i },
  { intent: "advance", match: /前进|继续|探索|走|移动|进入|深入|前行|advance|explore|go|move|continue/i },
  { intent: "sneak", match: /潜行|藏匿|隐蔽|躲|sneak|stealth|hide/i },
  { intent: "rest", match: /休息|睡觉|休整|小憩|恢复|rest|sleep/i },
  { intent: "save", match: /存档|保存|save/i },
];

// F151 疑问句守卫：以「？」「?」结尾，或含「还是」「吗」「要不要」「是不是」
// 的输入是在提问/复述系统兜底句，不是在下战斗指令——这些形态一律不命中
// 战斗意图（/action 落 unknown 提示、/ai-action 兜底落 observe），防止把
// 系统自己的「你是想攻击还是想离开？」吃成一次白挨反击的攻击。
// 只罩战斗意图（攻击/技能/防御/道具/逃跑/前进）：「要不要休息？」这类
// 非战斗问句仍按原语义解析，不误伤。
const QUESTION_FORM = /[？?]\s*$|还是|吗|要不要|是不是/;
const QUESTION_SKIP = new Set(["attack", "skill", "defend", "item", "flee", "advance"]);

// F154 点名兜底用的使用动词：词尾表之外的补给叫法，只有搭了使用动词
// （使用/服用/喝/吃/use/drink）才算「点名用药」——光提名字不算。
const ITEM_VERB_RE = /使用|服用|喝|吃|use\b|drink/i;

// F154 点名补给判定：输入搭了使用动词且点名背包真实补给才算——
// /action 的 resolveIntent 与 /ai-action 的 fallback.parse 共用。
function namesASupply(text, supplyNames) {
  if (!ITEM_VERB_RE.test(text) || !Array.isArray(supplyNames)) return false;
  return supplyNames.some((name) => name && text.includes(name));
}

// resolveIntent(input, supplyNames) -> intent id | null
//   supplyNames：该档背包里真实存在的补给名清单（可选，index.js 注入）。
//   词尾表之外的点名叫法（如「喝能量饮」且背包真有「能量饮」）由此兜底
//   判 item——没点名（「喝水」对「生命圣水」）或没搭使用动词都不算。
function resolveIntent(input, supplyNames) {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return null;
  const question = QUESTION_FORM.test(text);
  for (const rule of INTENT_MATCHERS) {
    try {
      if (question && QUESTION_SKIP.has(rule.intent)) continue;
      if (rule.match.test(text)) return rule.intent;
    } catch {
      // 某条正则异常不该拖垮整轮解析，跳过继续。
    }
  }
  if (!question && namesASupply(text, supplyNames)) return "item";
  return null;
}

module.exports = { INTENT_MATCHERS, resolveIntent, QUESTION_FORM, QUESTION_SKIP, namesASupply };
