#!/usr/bin/env node
// F024 contract: AI 失败兜底 —— a rule parser must exist and map keyword
// inputs to whitelisted intents, and /ai-action must answer (never hang)
// even when the AI upstream is unreachable.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assert, makeSave, ok, post } from "./_http.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let fb;
try {
  fb = require(path.join(ROOT, "server", "ai", "fallback.js"));
} catch {
  assert(false, "server/ai/fallback.js does not exist");
}
const parse = fb.parse || fb.resolve || fb.parseInput || fb.match || fb.fallback;
assert(typeof parse === "function", "fallback.js must export a rule-parser function");
const r = parse("前进");
assert(r && (r.intent || r.action || r.content || r.reply), "rule parser produced nothing for 「前进」");

const sid = await makeSave("fb");
const { status, body } = await post("/ai-action", { save_id: sid, input: "前进" }, 25000);
assert(status === 200, `ai-action returned HTTP ${status} (must degrade, not hang)`);
const content = body && (body.reply?.content ?? body.narration ?? body.content);
assert(typeof content === "string" && content.length > 0, "ai-action returned no reply under fallback");
ok();
