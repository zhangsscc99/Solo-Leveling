#!/usr/bin/env node
// F180 验收断言：自由输入具象回显不再叠词。
//
//   现状缺陷：回显模板把玩家名词短语插入已含同一名词的句式——
//   「我蹲下检查石阶上的刻痕」回「指尖划过刻痕上的刻痕」。
//
//   断言：新档连发 6 句含重复名词短语的输入（刻痕/石像/裂缝/石碑/
//   长明灯/壁画），每条回包——
//     1) 不匹配 /([一-鿿]{2,4})上的\1/（「X上的X」叠词）；
//     2) 按标点/空白切词后不存在紧邻重复的 2 字词（即任何中文段内
//        不得出现 /([一-鿿]{2})\1/ 式紧邻重复）。
//   回显整体不得为空、不得丢输入回显（F076/F129 契约所在文件另有断言，
//   本文件只管叠词）。
//
//   旧码红证：「我蹲下检查石阶上的刻痕」旧模板回「刻痕上的刻痕」，
//   断言 1 FAIL。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
import { assert, ok, makeSave, act } from "./_http.mjs";

const id = await makeSave("f180-dup");

const DUP_ON_RE = /([一-鿿]{2,4})上的\1/;
const ADJ_DUP_RE = /([一-鿿]{2})\1/;

const INPUTS = [
  "我蹲下检查石阶上的刻痕",
  "我摸了摸那尊石像的底座",
  "我抬头打量头顶的裂缝",
  "我贴近石碑读上面的碑文",
  "我盯着长明灯看火苗动没动",
  "我凑近壁画辨认画上的人脸",
];

for (let i = 0; i < INPUTS.length; i++) {
  const r = await act(id, INPUTS[i]);
  const text = r.reply.content;
  assert(text && text.trim() !== "", `send#${i + 1}「${INPUTS[i]}」回包为空`);
  assert(
    !DUP_ON_RE.test(text),
    `send#${i + 1}「${INPUTS[i]}」回包含「X上的X」叠词: ${text.slice(-200)}`
  );
  // 按标点/空白切词：非中文字符即断点，逐段查紧邻重复的 2 字词。
  const segs = text.split(/[^一-鿿]+/).filter(Boolean);
  for (const seg of segs) {
    assert(
      !ADJ_DUP_RE.test(seg),
      `send#${i + 1}「${INPUTS[i]}」段「${seg}」含紧邻重复的 2 字词，全句: ${text.slice(-200)}`
    );
  }
}
console.log("    6 句含重复名词短语的输入：回包无「X上的X」、无紧邻重复 2 字词");

ok("echo-no-duplicate OK");
