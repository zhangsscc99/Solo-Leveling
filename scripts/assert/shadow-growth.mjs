#!/usr/bin/env node
// F052 contract: 影子成长（等级、技能继承）—— engine must expose growth
// mechanics, tuning data must carry growth config, and the engine's own
// test file must pass.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const shadow = require(path.join(ROOT, "server", "engine", "shadow.js"));
const names = Object.keys(shadow);
assert.ok(
  names.some((k) => /grow|level|xp|train|promote|inherit/i.test(k)),
  `engine/shadow.js exposes no growth function (exports: ${names.join(",")})`
);

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "server", "data", "shadow.json"), "utf8"));
assert.ok(
  /growth|inherit|xp|exp/i.test(JSON.stringify(cfg)),
  "server/data/shadow.json has no growth/inherit tuning block"
);

const t = spawnSync(process.execPath, [path.join(ROOT, "server", "engine", "shadow.test.js")], {
  stdio: "pipe",
});
assert.equal(t.status, 0, `shadow.test.js failed:\n${t.stderr || t.stdout}`);
console.log("OK");
process.exit(0);
