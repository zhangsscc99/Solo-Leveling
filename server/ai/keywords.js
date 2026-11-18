// 指令词表单一事实源：/action 的 resolveAction 与 /ai-action 的规则兜底
// （fallback.parse）共用这张有序匹配表，两条路径解析结果永远一致，不再漂移。
//
// F235：词表本体迁至仓库根 shared/intents.json——前端（App.tsx 的 F231
// 点击当帧预判）与本模块同引一份定义，不再各自写字面量。匹配语义
// （影子三条句首锚定、其余子串匹配、按表序取首个命中）写在该文件顶层
// _doc；各条意图的 F 系列沿革写在条目 note。
//
// 本模块只负责把 JSON 编译成匹配表：pattern 非空的条目 new RegExp 就地
// 编译；影子三条 pattern=null，按 source 指路仍取 engine/shadow 的已编译
// 正则（句首锚定语义在引擎里，不在两处复制）。
const { DEPLOY_COMMAND, UNDEPLOY_COMMAND, FORMATION_COMMAND } = require("../engine/shadow");
const VOCAB = require("../../shared/intents.json");

const ENGINE_MATCHERS = {
  "server/engine/shadow.js:DEPLOY_COMMAND": DEPLOY_COMMAND,
  "server/engine/shadow.js:UNDEPLOY_COMMAND": UNDEPLOY_COMMAND,
  "server/engine/shadow.js:FORMATION_COMMAND": FORMATION_COMMAND,
};

const INTENT_MATCHERS = VOCAB.intents.map((rule) => ({
  intent: rule.intent,
  match: rule.pattern != null ? new RegExp(rule.pattern, rule.flags) : ENGINE_MATCHERS[rule.source],
}));

// F151 疑问句守卫：以「？」「?」结尾，或含「还是」「吗」「要不要」「是不是」
// 的输入是在提问/复述系统兜底句，不是在下战斗指令——这些形态一律不命中
// 战斗意图（/action 落 unknown 提示、/ai-action 兜底落 observe），防止把
// 系统自己的「你是想攻击还是想离开？」吃成一次白挨反击的攻击。
// 只罩战斗意图（攻击/技能/防御/道具/逃跑/前进）：「要不要休息？」这类
// 非战斗问句仍按原语义解析，不误伤。
const QUESTION_FORM = new RegExp(VOCAB.question_form.pattern, VOCAB.question_form.flags);
const QUESTION_SKIP = new Set(VOCAB.question_skip);

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
//   null 对应 /action 的 unknown（占位文案）；fallback 会把 null 转成 observe。
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
