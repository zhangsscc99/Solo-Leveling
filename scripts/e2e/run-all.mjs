#!/usr/bin/env node
// run-all.mjs: serially run every e2e script in this directory (except
// lib.mjs and itself), stream output, print a summary, exit non-zero on any
// failure.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = new Set(["lib.mjs", "run-all.mjs"]);

const scripts = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith(".mjs") && !SELF.has(f))
  .sort();

if (!scripts.length) {
  console.log("[E2E-ALL] no e2e scripts found");
  process.exit(0);
}

const results = [];
for (const s of scripts) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(HERE, s)], {
    stdio: "inherit",
    env: process.env,
  });
  results.push({ s, ok: r.status === 0, ms: Date.now() - t0 });
}

console.log("[E2E-ALL] ────────────────────────────");
let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`[E2E-ALL] ${r.s.padEnd(14)} ${r.ok ? "PASS" : "FAIL"} (${(r.ms / 1000).toFixed(1)}s)`);
}
console.log(`[E2E-ALL] ${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
