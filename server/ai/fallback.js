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
const { INTENT_MATCHERS } = require("./keywords");

const RULES = INTENT_MATCHERS;

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
