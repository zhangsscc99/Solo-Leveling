#!/usr/bin/env node
// F146 脱战未识别兜底契约（全是行为断言）：
//
//   脱战态连输 3 条无法解析的输入，回包必须按语境生成：
//   (a) 都不再含固定追问「你是想攻击还是想离开」；
//   (b) 都回显玩家原文（「系统未识别该指令：「X」」——F129 起客户端
//       对这个形态有依赖，不得改写）；
//   (c) 命中面板操作词时给具体指路——「加点力量」须含「属性」、
//       「装备猎刀」须含「背包」或「装备」；
//   (d) 每条都给出 ≥2 条与当前场景相关的可做之事（「说「X」」形态），
//       且 intent 仍为 unknown、无任何副作用。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖；
//   DB_PATH 默认 <repo>/data/game.db，隔离实例记得指向同一库文件。
//
//   变异敏感性：固定问句加回 → (a) FAIL；回显被删 → (b) FAIL（F076/
//   F129 同源契约）；指路被删 → (c) FAIL；可做之事清空 → (d) FAIL。
import { assert, ok, makeSave, act, fetchSaveView } from "./_http.mjs";

const id = await makeSave("f146-fallback");
const { save: s0 } = await fetchSaveView(id);
assert(s0.combat === null, `setup broken: fresh save must be out of combat (${JSON.stringify(s0.combat)})`);

const CASES = [
  { input: "我蹲下检查刻痕", need: null, tag: "free" },
  { input: "加点力量", need: "属性", tag: "stats" },
  { input: "装备猎刀", need: /背包|装备/, tag: "equip" },
];

for (const c of CASES) {
  const r = await act(id, c.input);
  const text = r.reply.content;
  assert(
    r.intent === "unknown",
    `(${c.tag})「${c.input}」expected intent=unknown, got ${JSON.stringify(r.intent)}`
  );
  assert(
    !text.includes("你是想攻击还是想离开"),
    `(${c.tag})「${c.input}」still carries the fixed question: ${text.slice(-160)}`
  );
  assert(
    text.includes(`「${c.input}」`),
    `(${c.tag})「${c.input}」missing input echo: ${text.slice(-160)}`
  );
  if (typeof c.need === "string") {
    assert(text.includes(c.need), `(${c.tag})「${c.input}」missing「${c.need}」guidance: ${text.slice(-160)}`);
  } else if (c.need) {
    assert(c.need.test(text), `(${c.tag})「${c.input}」missing guidance ${c.need}: ${text.slice(-160)}`);
  }
  const verbs = text.match(/说「[^」]+」/g) || [];
  assert(
    verbs.length >= 2,
    `(${c.tag})「${c.input}」must offer >=2 contextual things to do, got ${verbs.length}: ${text.slice(-160)}`
  );
  assert(
    r.save.hp === s0.hp && r.save.mp === s0.mp && r.save.scene === s0.scene,
    `(${c.tag})「${c.input}」mutated state: ${s0.hp}/${s0.mp}/${s0.scene} -> ${r.save.hp}/${r.save.mp}/${r.save.scene}`
  );
}

ok("OK");
