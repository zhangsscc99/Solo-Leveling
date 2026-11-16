// F021/F024 规则兜底解析器：AI 网关失败、超时、输出非法时，
// 用关键词把自由输入映射到白名单 intent，保证 /ai-action 永远有回应。
// CommonJS，纯函数，永不抛异常。
//
// parse(input) -> { intent, args, content? }
//   intent  白名单 id（与 server/index.js 的 INTENTS 一致）
//   args    目前恒为 {}（规则解析不产生参数）
//   content 部分场景附带的固定叙述；缺省时由引擎模板生成
//
// 无法识别的输入一律落到 observe（环顾四周），绝不返回空。

// 词表与匹配顺序统一来自 ./keywords —— /action 的 resolveAction 用的也是
// 同一张 INTENT_MATCHERS（单一事实源）。影子三条句首锚定，其余七条沿用
// main 的子串语义；两条路径不会再出现一边锚定一边不锚定的漂移。
const { INTENT_MATCHERS, QUESTION_FORM, QUESTION_SKIP, namesASupply } = require("./keywords");

const RULES = INTENT_MATCHERS;

// parse(input, supplyNames)——supplyNames 为可选的背包补给名清单，
// 与 /action 的 resolveIntent 同一 F154 点名兜底：词尾表之外、但点名
// 了背包真实补给的叫法也判 item（没点名或没搭使用动词都不算）。
function parse(input, supplyNames) {
  try {
    const text = typeof input === "string" ? input.trim() : "";
    if (text) {
      // F151 疑问句守卫与 /action 同一事实源：提问/复述兜底句不命中
      // 战斗意图——AI 降级路径同样不能把「你是想攻击还是想离开？」
      // 解析成一次白挨打的攻击。
      const question = QUESTION_FORM.test(text);
      for (const rule of RULES) {
        if (question && QUESTION_SKIP.has(rule.intent)) continue;
        if (rule.match.test(text)) {
          return { intent: rule.intent, args: {} };
        }
      }
      if (!question && namesASupply(text, supplyNames)) {
        return { intent: "item", args: {} };
      }
    }
  } catch {
    // fall through to the safe default
  }
  return { intent: "observe", args: {} };
}

module.exports = { RULES, parse };
