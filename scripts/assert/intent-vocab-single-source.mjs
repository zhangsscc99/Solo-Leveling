#!/usr/bin/env node
// intent-vocab-single-source.mjs (F235)：意图词表前后端单一事实源——
// 词表只许写在 shared/intents.json 一处，server/ai/keywords.js 与
// client/src/App.tsx 同引它，不得再各自落字面量。
//
//   a) shared/intents.json 可被 require 解析；意图顺序与现网语义一致：
//      shadow_* 三条在前，然后 attack/skill/defend/item/flee/status/
//      help/observe/advance/sneak/rest/save——advance 在 observe 之后、
//      sneak 之前（被早位意图抢走的输入在服务端轮不到 must_choose 门，
//      顺序漂移就是判定漂移）。
//   b) 在 server/ai/**、client/src/**、scripts/** 里 grep advance 正则
//      字面量（/…/ 体内含「前进词族」≥4 个 token——形如服务端 advance
//      条目的整串词表），命中数必须 ≤1 且命中文件须引用
//      shared/intents.json（命中即「指路注释」，不是第二份定义）。
//   c) 子进程跑 deny-feedback.mjs（scripts/e2e 下，自起隔离实例）
//      与 choice-refusal-dedupe.mjs（assert，打本地 :3020 实例），
//      两者必须 exit 0——词表同源不得改变任何判定行为。
//
//   旧码红证：旧码 advance 词表写在 keywords.js 与 App.tsx 两处字面量，
//   (b) 直接命中 2 处 >1 → FAIL。
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const failures = [];
const fail = (msg) => failures.push(msg);

// ── (a) shared/intents.json 可 require、顺序与现网一致 ───────────
let vocab = null;
try {
  vocab = require(path.join(ROOT, "shared", "intents.json"));
} catch (e) {
  fail(`(a) shared/intents.json 无法被 require 解析: ${e.message}`);
}
const EXPECTED_ORDER = [
  "shadow_deploy",
  "shadow_undeploy",
  "shadow_formation",
  "attack",
  "skill",
  "defend",
  "item",
  "flee",
  "status",
  "help",
  "observe",
  "advance",
  "sneak",
  "rest",
  "save",
];
if (vocab) {
  const order = Array.isArray(vocab.intents) ? vocab.intents.map((r) => r.intent) : [];
  if (JSON.stringify(order) !== JSON.stringify(EXPECTED_ORDER)) {
    fail(`(a) 意图顺序漂移：got [${order.join(",")}]，want [${EXPECTED_ORDER.join(",")}]`);
  }
  const idx = (id) => order.indexOf(id);
  if (!(idx("advance") > idx("observe") && idx("observe") >= 0 && idx("sneak") > idx("advance"))) {
    fail("(a) advance 未落在 observe 之后 / sneak 之前的既有位次");
  }
  for (const [i, rule] of (vocab.intents || []).entries()) {
    if (!rule || typeof rule.intent !== "string" || !("pattern" in rule) || !("flags" in rule)) {
      fail(`(a) intents[${i}] 缺 intent/pattern/flags 字段: ${JSON.stringify(rule)}`);
    }
  }
  if (!vocab.question_form || typeof vocab.question_form.pattern !== "string") {
    fail("(a) question_form 缺 pattern");
  }
  if (!Array.isArray(vocab.question_skip)) {
    fail("(a) question_skip 不是数组");
  }
}

// ── (b) advance 正则字面量全仓唯一 ────────────────────────────────
// 「advance 词表」字面量签名：一个 /…/ 正则体内同时出现 ≥4 个 advance
// token——零散单 token（如 F118 指令信号词、各处只含「前进」的断言
// 正则）不算词表复刻。
const ADVANCE_TOKENS = [
  "前进",
  "继续",
  "探索",
  "走",
  "移动",
  "进入",
  "深入",
  "前行",
  "advance",
  "explore",
  "go",
  "move",
  "continue",
];
const REGEX_LITERAL = /\/((?:\\.|[^/\\\n])+)\/[a-z]{0,6}/g;
const SCAN_DIRS = ["server/ai", "client/src", "scripts"];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(?:js|jsx|ts|tsx|mjs|cjs)$/.test(e.name)) yield p;
  }
}

const hits = [];
for (const d of SCAN_DIRS) {
  for (const file of walk(path.join(ROOT, d))) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(REGEX_LITERAL)) {
      const found = ADVANCE_TOKENS.filter((t) => m[1].includes(t));
      if (found.length >= 4) {
        hits.push({ file: path.relative(ROOT, file), refsShared: text.includes("shared/intents.json") });
        break;
      }
    }
  }
}
if (hits.length > 1) {
  fail(`(b) advance 词表字面量命中 ${hits.length} 处（须 ≤1）: ${hits.map((h) => h.file).join(", ")}`);
} else if (hits.length === 1 && !hits[0].refsShared) {
  fail(`(b) ${hits[0].file} 藏了一份 advance 词表字面量且不指向 shared/intents.json——第二份定义`);
}

// ── (c) 既有断言仍 PASS ──────────────────────────────────────────
const CHILD_ENV = { ...process.env };
for (const k of [
  "NODE_CHANNEL_FD",
  "NODE_CHANNEL_SERIALIZATION_MODE",
  "E2E_BASE",
  "E2E_BASE_URL",
  "E2E_API",
  "API_BASE",
  "DB_PATH",
]) {
  delete CHILD_ENV[k];
}
// 任务书写的是 scripts/assert/deny-feedback.mjs；该断言实体在 scripts/e2e
// 下（自起隔离实例的 playwright 用例），两处都试，命中哪个跑哪个。
const DENY = ["scripts/assert/deny-feedback.mjs", "scripts/e2e/deny-feedback.mjs"].find((p) =>
  fs.existsSync(path.join(ROOT, p))
);
const DEDUPE = "scripts/assert/choice-refusal-dedupe.mjs";
for (const rel of [DENY, DEDUPE]) {
  if (!rel) {
    fail("(c) deny-feedback.mjs 在 scripts/assert 与 scripts/e2e 下都不存在");
    continue;
  }
  console.log(`[ASSERT] running node ${rel} ...`);
  const r = spawnSync(process.execPath, [rel], {
    cwd: ROOT,
    env: CHILD_ENV,
    stdio: "inherit",
    timeout: 300000,
  });
  if (r.status !== 0) {
    fail(`(c) ${rel} exit=${r.status ?? "null"} signal=${r.signal ?? "-"} ${r.error?.message ?? ""}`.trim());
  } else {
    console.log(`[ASSERT] ${rel} PASS`);
  }
}

if (failures.length) {
  for (const f of failures) console.error(`[ASSERT] ${f}`);
  process.exit(1);
}
console.log("[ASSERT] intent-vocab-single-source PASS");
process.exit(0);
