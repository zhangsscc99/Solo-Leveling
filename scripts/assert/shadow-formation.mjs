#!/usr/bin/env node
// F051 contract: 影子编队与出战 —— the action endpoint must understand
// formation/deployment commands (not fall through to the unknown-input
// placeholder). Tries both 「影子编队」 and 「影子出战」.
import { assert, makeSave, ok, post } from "./_http.mjs";

const PLACEHOLDER = /指令已接收|尚未接入|占位|无法识别|命运之线/;

const sid = await makeSave("shadow");
let passed = null;
for (const input of ["影子编队", "影子出战"]) {
  const { status, body } = await post("/action", { save_id: sid, input });
  assert(status === 200, `action ${input} returned HTTP ${status}`);
  const content = body?.reply?.content || "";
  if (content && !PLACEHOLDER.test(content)) passed = { input, content };
}
assert(passed, "no shadow-formation command is recognized by /action");
ok();
