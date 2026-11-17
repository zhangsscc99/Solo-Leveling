#!/usr/bin/env node
// F170 叙事降级与 /action 同行为契约（全是行为断言）：
//
//   AI 网关不可用（无 OPENCODE_GO_API_KEY / 网关失败）时 /ai-action
//   degraded=true，此时结算必须与 /action 走同一规则入口
//   resolveAction()——自由输入长句拿到的是 free-action 的具象否认，
//   而不是 observe 通用观察模板。
//
//   断言：两个全新存档，同一句「我蹲下身，捡起地上一枚发烫的碎片」：
//     A → POST /ai-action：degraded === true；reply.content 含「碎片」
//         且含「没有」或「不存在」；不得含「重新审视」（observe 模板
//         标志词）；intent 与 B 相同。
//     B → POST /action：同上口径的具象否认。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：degraded 分支退回 aiFallback.parse → observe → FAIL
//   （无「碎片」否认且命中「重新审视」）；两条入口 intent 口径分叉 → FAIL。
import { assert, ok, act, post } from "./_http.mjs";

const INPUT = "我蹲下身，捡起地上一枚发烫的碎片";

async function newSave(tag) {
  const { status, body } = await post("/saves", { player_name: tag });
  assert(status === 201 && body && body.save && body.save.id,
    `create save failed (HTTP ${status})`);
  return body.save.id;
}

const rand = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const idA = await newSave(`F170a-${rand}`.slice(0, 20));
const idB = await newSave(`F170b-${rand}`.slice(0, 20));

const { status, body: a } = await post("/ai-action", { save_id: idA, input: INPUT });
assert(status === 200 && a && a.reply && typeof a.reply.content === "string",
  `/ai-action failed (HTTP ${status})`);
const b = await act(idB, INPUT);

const textA = a.reply.content;
const textB = b.reply.content;

assert(a.degraded === true, `/ai-action 未标记 degraded：${JSON.stringify(a).slice(0, 160)}`);
assert(textA.includes("碎片"), `ai-action 回包不含「碎片」：${textA.slice(-160)}`);
assert(textB.includes("碎片"), `action 回包不含「碎片」：${textB.slice(-160)}`);
assert(/没有|不存在/.test(textA), `ai-action 回包缺否认词（没有/不存在）：${textA.slice(-160)}`);
assert(/没有|不存在/.test(textB), `action 回包缺否认词（没有/不存在）：${textB.slice(-160)}`);
assert(!textA.includes("重新审视"), `ai-action 仍回 observe 通用模板：${textA.slice(-160)}`);
assert(a.intent === b.intent,
  `两入口 intent 不一致：ai-action=${a.intent} action=${b.intent}`);

console.log(`    ai-action(degraded): ${textA.split("\n")[0].slice(0, 90)}`);
console.log(`    action           : ${textB.split("\n")[0].slice(0, 90)}`);
ok("ai-degraded-parity: degraded /ai-action 与 /action 行为一致");
