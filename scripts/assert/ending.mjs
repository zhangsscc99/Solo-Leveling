#!/usr/bin/env node
// F071 contract: 结局文本与通关统计 —— either a dedicated
// server/data/ending.json {epilogue, stats} exists, or the ch8 data carries
// explicit 结局/通关 text plus a 统计/结算 element.
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Path A: dedicated ending data file.
const endingFile = path.join(ROOT, "server", "data", "ending.json");
if (fs.existsSync(endingFile)) {
  const e = JSON.parse(fs.readFileSync(endingFile, "utf8"));
  assert.ok(typeof e.epilogue === "string" && e.epilogue.length >= 50, "ending.json epilogue missing/too short");
  assert.ok(e.stats && typeof e.stats === "object", "ending.json stats block missing");
  console.log("OK");
  process.exit(0);
}

// Path B: embedded in ch8 data.
const c = require(path.join(ROOT, "server", "data", "chapters.json"));
const ch8 = c.chapters.find((x) => x.index === 8 || x.id === "ch8");
assert.ok(ch8, "ch8 missing from chapters.json");
const s = JSON.stringify(ch8);
assert.ok(/结局|通关|谢幕|epilogue|ending/i.test(s), "ch8 has no explicit ending text");
assert.ok(/统计|结算|战绩|战报|score|stat/i.test(s), "ch8 has no playthrough stats");
console.log("OK");
process.exit(0);
