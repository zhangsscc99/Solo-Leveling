#!/usr/bin/env node
// F166 自由输入口吻契约（全是行为断言）：
//
//   (a) 新档发自然语言长句「我蹲下身，捡起地上一枚发烫的碎片」——
//       回包不得再以「未识别该指令」开场（玩家写的是行动描写，按解析
//       报错打包退回会把「世界在回应我」打回「关键词表没匹配上」）；
//       必须保留 F162 的世界口吻叙述：含否认词（没有/不存在/不在）
//       且含玩家点名的「碎片」。
//   (b) 指令形态「遭遇哥布林」——回包必须仍含原文回显（F076/F129
//       客户端靠回显里的「遭遇X」开合战斗面板，不得破坏）。
//   (c) 指令形态「第 3 回合」——同上，回显必须保留（数字键位也按
//       指令形态处理）。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：echoRequired 判定翻转/前缀没摘 → (a) FAIL；
//   前缀整段删除（指令形态也丢回显）→ (b)(c) FAIL；
//   F162 叙述句被换回模板 → (a) 的否认词/点名物断言 FAIL。
import { assert, ok, makeSave, act } from "./_http.mjs";

const id = await makeSave("f166-voice");

// ── (a) 自然语言长句：无「未识别该指令」，世界口吻叙述保留 ────────────
{
  const input = "我蹲下身，捡起地上一枚发烫的碎片";
  const r = await act(id, input);
  const text = r.reply.content;
  assert(
    r.intent === "unknown",
    `(a) expected intent=unknown, got ${JSON.stringify(r.intent)}`
  );
  assert(
    !text.includes("未识别该指令"),
    `(a) 回包仍以「未识别该指令」开场：${text.slice(-200)}`
  );
  assert(
    /没有|不存在|不在/.test(text),
    `(a) 回包缺否认词（没有/不存在/不在）：${text.slice(-200)}`
  );
  assert(
    text.includes("碎片"),
    `(a) 回包丢了玩家点名的「碎片」：${text.slice(-200)}`
  );
  console.log(`    (a) 长句免前缀，世界口吻叙述保留：${text.split("\n")[0]}`);
}

// ── (b) 指令形态「遭遇哥布林」：回显必须保留 ──────────────────────────
{
  const input = "遭遇哥布林";
  const r = await act(id, input);
  const text = r.reply.content;
  assert(
    text.includes(input),
    `(b) 指令形态输入丢了原文回显「${input}」：${text.slice(-200)}`
  );
  console.log(`    (b) 遭遇信号回显保留：${text.split("\n")[0]}`);
}

// ── (c) 指令形态「第 3 回合」：回显必须保留 ──────────────────────────
{
  const input = "第 3 回合";
  const r = await act(id, input);
  const text = r.reply.content;
  assert(
    text.includes(input),
    `(c) 数字键位输入丢了原文回显「${input}」：${text.slice(-200)}`
  );
  console.log(`    (c) 回合信号回显保留：${text.split("\n")[0]}`);
}

ok("free-input-voice OK");
