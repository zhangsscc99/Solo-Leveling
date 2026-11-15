#!/usr/bin/env node
// Chapter contract (F042/F043/F060-F063/F070):
//   node scripts/assert/chapter.mjs <index> <keyword-regex>
// The chapter must load through the engine loader (structure-validated),
// have >=3 scene nodes, and contain the required story keywords.
import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const [idx, kw] = process.argv.slice(2);
assert.ok(idx && kw, "usage: chapter.mjs <index> <keyword-regex>");

const chapters = require(path.join(ROOT, "server", "engine", "chapters.js"));
const ch = chapters.getChapter(Number(idx));
assert.ok(ch, `chapter ${idx} not found via engine loader`);
assert.ok(Array.isArray(ch.scenes) && ch.scenes.length >= 3, `chapter ${idx} has <3 scenes (${ch.scenes?.length})`);
const re = new RegExp(kw);
assert.ok(re.test(JSON.stringify(ch)), `chapter ${idx} missing required content /${kw}/`);
console.log("OK");
process.exit(0);
