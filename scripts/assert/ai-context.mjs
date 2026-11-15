#!/usr/bin/env node
// F023 contract: 上下文压缩 —— server/ai/context.js must only ship a state
// summary + at most N recent log entries under a char budget.
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const ctx = require(path.join(ROOT, "server", "ai", "context.js"));

assert.equal(typeof ctx.buildContext, "function", "context.js must export buildContext");

const save = {
  id: 1, player_name: "测试", level: 5, rank: "D", xp: 120,
  hp: 80, max_hp: 100, mp: 10, max_mp: 30, gold: 55, chapter: 2, scene: "x",
  stats: { strength: 11, agility: 12, vitality: 9, intelligence: 8, perception: 14 },
  secret_field_should_not_leak: "token-xyz",
};
const logs = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 ? "narrator" : "user",
  content: `第${i}条日志 ` + "很".repeat(300),
}));

const c = ctx.buildContext({ save, logs, playerInput: "继续前进", limit: 6, maxChars: 2400, maxEntryChars: 240 });

assert.ok(typeof c.summary === "string" && c.summary.length > 0, "summary must be non-empty");
assert.ok(!c.summary.includes("token-xyz"), "summary leaked a non-whitelisted save field");
assert.ok(Array.isArray(c.history) && c.history.length <= 6, `history must keep <=6 entries (got ${c.history.length})`);
assert.equal(c.input, "继续前进");
for (const h of c.history) {
  assert.ok(h.content.length <= 240 + 16, `entry over char cap: ${h.content.length}`);
}
assert.ok(c.usedChars <= 2400 + c.summary.length + c.input.length, "budget accounting broken");
console.log("OK");
process.exit(0);
