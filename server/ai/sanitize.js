// F025 AI 输出清洗：模型经常在 JSON 外面裹 ```json 围栏或前后说明文字。
// 这里把第一个可用的 {...} 片段抽出来交给 JSON.parse；抽不到就返回 null，
// 由调用方走规则兜底，绝不抛异常。CommonJS，无依赖，纯函数。
//
// extractJson(text) -> string | null
//   返回可尝试 JSON.parse 的子串；输入不是字符串或找不到对象边界时返回 null。

function extractJson(raw) {
  try {
    if (typeof raw !== "string") return null;
    const text = raw.trim();
    if (!text) return null;

    // 优先取 ```json ... ``` / ``` ... ``` 围栏内部；没有围栏就用整段文本。
    const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
    const candidate = fenced ? fenced[1] : text;

    // 再剥掉围栏内外残留的前后叙述，只保留第一个 { 到最后一个 }。
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    return candidate.slice(start, end + 1);
  } catch {
    return null;
  }
}

module.exports = { extractJson };
