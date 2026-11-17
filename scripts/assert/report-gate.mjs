#!/usr/bin/env node
// F127 断言：report.sh 全表汇总的退出码与 FAIL 行质量。
//
//   node scripts/assert/report-gate.mjs   (0=过)
//
// 不跑全表真 verify：REPORT_VERIFY_BIN 注入一个 0.1s 失败的桩 verify，
// REPORT_SKIP_E2E / REPORT_RUNS_DIR 把 e2e 与输出重定向到临时目录。
// 旧码跑必红：旧 report.sh 有 `| tail -1)` 取 rc、无 REPORT_VERIFY_BIN 注入点。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, ok } from "./_http.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const REPORT = path.join(ROOT, "scripts", "report.sh");
const src = fs.readFileSync(REPORT, "utf8");

function assert(cond, msg) {
  if (!cond) fail(msg);
}

// ── 静态断言 ──────────────────────────────────────────────────────────
const syn = spawnSync("bash", ["-n", REPORT], { encoding: "utf8" });
assert(syn.status === 0, `report.sh 语法错误: ${syn.stderr}`);

assert(/pipefail/.test(src), "report.sh 缺少 set -o pipefail");
assert(
  !/\|\s*tail -1\b/.test(src),
  "report.sh 仍用 `| tail -1` 截取输出取 rc（拿到的是 tail 的状态，且丢原始错误行）"
);
assert(
  /REPORT_VERIFY_BIN/.test(src),
  "report.sh 不支持 REPORT_VERIFY_BIN 注入点（无法用桩验证，旧码红线）"
);
assert(
  /REPORT_SKIP_E2E/.test(src) && /REPORT_RUNS_DIR/.test(src),
  "report.sh 缺 REPORT_SKIP_E2E / REPORT_RUNS_DIR 注入点"
);

// ── 桩 verify：0.1s 失败 + 原始错误行 ─────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc27-report-"));
const runsDir = path.join(dir, "runs");
const stubBin = path.join(dir, "verify.sh");
const callsFile = path.join(dir, "verify-calls");
fs.mkdirSync(runsDir, { recursive: true });
fs.writeFileSync(
  stubBin,
  `#!/usr/bin/env bash
echo "$1" >> "${callsFile}"
sleep 0.1
echo "context line one"
echo "Error: connect ECONNREFUSED 127.0.0.1:3099 — synthetic assert exploded near line 42"
echo "[VERIFY] $1 FAIL (0.1s)"
exit 1
`
);
fs.chmodSync(stubBin, 0o755);

const r = spawnSync("bash", [REPORT], {
  env: {
    PATH: process.env.PATH || "/usr/bin:/bin",
    HOME: process.env.HOME || "/root",
    REPORT_VERIFY_BIN: stubBin,
    REPORT_SKIP_E2E: "1",
    REPORT_RUNS_DIR: runsDir,
    DB_PATH: path.join(dir, "nonexistent.db"), // 不碰真实 game.db
  },
  encoding: "utf8",
  timeout: 300000,
});
assert(
  r.status === 0,
  `report.sh exited ${r.status}: ${(r.stderr || "").slice(0, 500)}`
);

// stub 真的被调用了（REPORT_VERIFY_BIN 生效），不是空表
const calls = fs.existsSync(callsFile)
  ? fs.readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean)
  : [];
assert(calls.length >= 10, `stub verify 只被调了 ${calls.length} 次——REPORT_VERIFY_BIN 未生效？`);

const reports = fs.readdirSync(runsDir).filter((f) => f.endsWith(".md"));
assert(reports.length === 1, `runsDir 里应有 1 份报告，实际 ${reports.length}`);
const md = fs.readFileSync(path.join(runsDir, reports[0]), "utf8");

const failRows = md.split("\n").filter((l) => /\|\s*FAIL\s*\|/.test(l));
assert(failRows.length >= 10, `报告里 FAIL 行过少（${failRows.length}）`);
for (const row of failRows.slice(0, 50)) {
  assert(
    row.length >= 40,
    `FAIL 行太短、没带原始错误行（${row.length} 字符）: ${row}`
  );
  assert(
    /ECONNREFUSED|Error:/.test(row),
    `FAIL 行未附断言原始错误行: ${row.slice(0, 200)}`
  );
}
assert(/FAIL [1-9]/.test(md), "汇总行未统计到 FAIL");

ok("[ASSERT] report-gate OK");
