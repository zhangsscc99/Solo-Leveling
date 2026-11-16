#!/usr/bin/env node
// F143 面板直开补动词前缀（全是行为断言）：
//
//   (a) 「动词 + 面板名」整句 → 回包 panel 指向对应面板，且
//       hp/mp/scene/xp 与发之前完全一致（开面板零副作用硬约束）；
//       裸名回归顺带覆盖（F129 既有口径不许丢）。
//   (b) 长句叙述「我打开背包发现里面空了」「他打开地图看了一眼就合上」
//       → 回包不得带 panel 字段——整句锚定原则不变，不许被吞成开面板，
//       仍走正常意图解析（observe/unknown 均可）。
//   (c) /ai-action 同口径（F129 已做双路直开）：POST /ai-action 输
//       「打开背包」→ panel === "inventory"。
//
//   API_BASE 默认 http://127.0.0.1:3020/game/api，可用环境变量覆盖。
//
//   变异敏感性：把 PANEL_VERB 前缀删掉 → (a) 动词句与 (c) 全 FAIL；
//   把 ^$ 锚点摘了改子串匹配 → (b) FAIL；面板路由移到关键词表之后 →
//   「看看背包」被裸「看」抢成 observe → (a) FAIL。
import { assert, ok, makeSave, act, fetchSaveView, post } from "./_http.mjs";

const id = await makeSave("f143");

// ── (a) 动词 + 面板名 → panel，零副作用；含裸名回归 ──
const CASES = [
  ["打开背包", "inventory"],
  ["看看背包", "inventory"],
  ["背包", "inventory"],
  ["查看技能", "skills"],
  ["技能面板", "skills"],
  ["打开我的属性", "stats"],
  ["看一下状态", "stats"],
  ["显示地图", "map"],
  ["地图", "map"],
  ["调出任务", "quests"],
  ["瞧一瞧任务列表", "quests"],
  ["打开影子面板", "shadows"],
  ["影子编队", "shadows"],
  ["给我看编队", "shadows"],
];
for (const [input, panel] of CASES) {
  const before = (await fetchSaveView(id)).save;
  const r = await act(id, input);
  assert(
    r.panel === panel,
    `(a)「${input}」期望 panel=${panel}，实际 ${JSON.stringify(r.panel)}` +
      `（intent=${JSON.stringify(r.intent)}）`
  );
  assert(
    r.save.hp === before.hp &&
      r.save.mp === before.mp &&
      r.save.scene === before.scene &&
      r.save.xp === before.xp,
    `(a)「${input}」产生了副作用：hp ${before.hp}->${r.save.hp} mp ${before.mp}->${r.save.mp}` +
      ` scene ${before.scene}->${r.save.scene} xp ${before.xp}->${r.save.xp}`
  );
}
console.log("[OK] (a) 动词+面板名/裸名 → 对应 panel，hp/mp/scene/xp 零副作用");

// ── (b) 长句叙述不得被吞：回包无 panel 字段 ──
for (const input of ["我打开背包发现里面空了", "他打开地图看了一眼就合上"]) {
  const before = (await fetchSaveView(id)).save;
  const r = await act(id, input);
  assert(
    !("panel" in r) && !(r.reply && "panel" in r.reply),
    `(b)「${input}」被吞成开面板：panel=${JSON.stringify(r.panel)}`
  );
  assert(
    r.save.scene === before.scene && r.save.hp === before.hp,
    `(b)「${input}」挪了位置/扣了体力：${before.scene}->${r.save.scene} hp ${before.hp}->${r.save.hp}`
  );
}
console.log("[OK] (b) 长句叙述不落 panel，照走正常意图解析");

// ── (c) /ai-action 同口径 ──
{
  const before = (await fetchSaveView(id)).save;
  const { status, body } = await post("/ai-action", { save_id: id, input: "打开背包" });
  assert(
    status === 200 && body && body.panel === "inventory",
    `(c) /ai-action「打开背包」期望 panel=inventory，实际 HTTP ${status} panel=${JSON.stringify(body && body.panel)}`
  );
  assert(
    body.save.hp === before.hp && body.save.scene === before.scene,
    `(c) /ai-action「打开背包」产生了副作用：hp ${before.hp}->${body.save.hp} scene ${before.scene}->${body.save.scene}`
  );
  console.log("[OK] (c) /ai-action「打开背包」→ panel=inventory，零副作用");
}

ok("F143 panel-open-verbs contract: all assertions passed");
