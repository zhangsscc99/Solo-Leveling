#!/usr/bin/env node
// F021 contract: POST /game/api/ai-action accepts free input and returns a
// narration reply ({reply:{content}} or {narration}) with HTTP 200.
import { assert, fail, makeSave, ok, post } from "./_http.mjs";

const sid = await makeSave("ai");
const { status, body } = await post("/ai-action", { save_id: sid, input: "环顾四周" });
assert(status === 200, `ai-action returned HTTP ${status}`);
const content = body && (body.reply?.content ?? body.narration ?? body.content);
assert(typeof content === "string" && content.length > 0, "response has no narration reply");
ok();
