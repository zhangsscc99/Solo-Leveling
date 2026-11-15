// F021/F024 规则兜底解析器：AI 网关失败、超时、输出非法时，
// 用关键词把自由输入映射到白名单 intent，保证 /ai-action 永远有回应。
// CommonJS，无依赖，纯函数，永不抛异常。
//
// parse(input) -> { intent, args, content? }
//   intent  白名单 id（与 server/index.js 的 INTENTS 一致）
//   args    目前恒为 {}（规则解析不产生参数）
//   content 部分场景附带的固定叙述；缺省时由引擎模板生成
//
// 无法识别的输入一律落到 observe（环顾四周），绝不返回空。

// 与 server/index.js 的 INTENTS 一致：指令词必须出现在句首（允许礼貌前缀），
// 叙述句（如「我想让影子出战后休息」）不匹配任何意图，落到 observe 兜底。
const RULES = [
  { intent: "status", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:状态|面板|属性|status|stats?)/i },
  { intent: "help", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:帮助|指令|help)/i },
  { intent: "observe", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:观察|查看|环顾|四周|环境|看|look|inspect)/i },
  { intent: "advance", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:前进|继续|探索|走|移动|离开|进入|深入|前行|advance|go|move|continue)/i },
  { intent: "sneak", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:潜行|藏匿|隐蔽|躲|sneak|stealth|hide)/i },
  { intent: "rest", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:休息|睡觉|休整|小憩|恢复|rest|sleep)/i },
  { intent: "save", match: /^(?:(?:请|麻烦|帮我)\s*)*(?:存档|保存|save)/i },
];

function parse(input) {
  try {
    const text = typeof input === "string" ? input.trim() : "";
    if (text) {
      for (const rule of RULES) {
        if (rule.match.test(text)) {
          return { intent: rule.intent, args: {} };
        }
      }
    }
  } catch {
    // fall through to the safe default
  }
  return { intent: "observe", args: {} };
}

module.exports = { RULES, parse };
