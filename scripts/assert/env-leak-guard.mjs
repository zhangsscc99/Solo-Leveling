#!/usr/bin/env node
// P211 断言（纯 node，ESM）：调度 shell 泄漏的 DB_PATH / E2E_BASE_URL /
// API_BASE 不得再渗进 verify.sh / report.sh 的子进程，db.test.js 的
// 「用例看的库」必须与「db.js 打开的库」一致。
//
//   node scripts/assert/env-leak-guard.mjs
//
// 仿 scripts/e2e/ci-deploy-env.test.mjs 的桩式做法，但不起 server、不用
// playwright：静态扫源码 + spawnSync 真实脚本验证 stderr 清理日志。
// 子进程一律用 process.execPath（即本断言自身的 node），避免 PATH 里的旧
// node 加载 better-sqlite3 时触发 ABI 不匹配。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VERIFY = path.join(ROOT, "scripts", "verify.sh");
const REPORT = path.join(ROOT, "scripts", "report.sh");
const DB_TEST = path.join(ROOT, "server", "db.test.js");
const PROBE_DB = "/tmp/envleak-probe.db";

const failures = [];
function check(cond, msg) {
  if (!cond) failures.push(msg);
}

const verifySrc = fs.readFileSync(VERIFY, "utf8");
const reportSrc = fs.readFileSync(REPORT, "utf8");

// ── 1. 静态：两个脚本前 40 行内有 unset 行，点名 E2E_BASE_URL 与 DB_PATH ──
for (const [name, src, file] of [
  ["verify.sh", verifySrc, VERIFY],
  ["report.sh", reportSrc, REPORT],
]) {
  const head = src.split("\n").slice(0, 40);
  check(
    head.some((l) => /\bunset\b/.test(l) && l.includes("E2E_BASE_URL") && l.includes("DB_PATH")),
    `${name}: first 40 lines lack an unset line covering E2E_BASE_URL and DB_PATH`
  );
  const r = spawnSync("bash", ["-n", file], { encoding: "utf8" });
  check(r.status === 0, `${name}: bash -n failed: ${r.stderr}`);
}

// ── 2. 动态：污染环境跑 verify.sh --list，stderr 必须打印 cleared env ──
const pollutedEnv = {
  ...process.env,
  DB_PATH: "/tmp/x.db",
  E2E_BASE_URL: "http://127.0.0.1:3118/game",
  API_BASE: "http://127.0.0.1:3142/zhihucopy/api",
  SL_VERIFY_API_BASE: "",
};
const rList = spawnSync("bash", ["scripts/verify.sh", "--list"], {
  cwd: ROOT,
  env: pollutedEnv,
  encoding: "utf8",
});
check(rList.status === 0, `verify.sh --list under polluted env exited ${rList.status}: ${rList.stderr}`);
check(
  /\[verify\] cleared env:/.test(rList.stderr),
  `verify.sh --list printed no "[verify] cleared env:" line (stderr: ${rList.stderr.slice(0, 400)})`
);
check(
  rList.stderr.includes("DB_PATH=/tmp/x.db"),
  `cleared env log must name DB_PATH=/tmp/x.db (stderr: ${rList.stderr.slice(0, 400)})`
);
check(
  rList.stderr.includes("E2E_BASE_URL=http://127.0.0.1:3118/game"),
  `cleared env log must name E2E_BASE_URL= (stderr: ${rList.stderr.slice(0, 400)})`
);

// 干净 env 再跑一次：不得出现 cleared env。
const cleanEnv = { ...process.env };
delete cleanEnv.DB_PATH;
delete cleanEnv.E2E_BASE_URL;
delete cleanEnv.API_BASE;
delete cleanEnv.SL_GAME_DB;
const rClean = spawnSync("bash", ["scripts/verify.sh", "--list"], {
  cwd: ROOT,
  env: cleanEnv,
  encoding: "utf8",
});
check(rClean.status === 0, `verify.sh --list under clean env exited ${rClean.status}: ${rClean.stderr}`);
check(
  !rClean.stderr.includes("cleared env"),
  `verify.sh --list under clean env still printed cleared env: ${rClean.stderr.slice(0, 400)}`
);

// ── 3. 子进程拿到干净 env：F078 的 verify 是公网 curl（慢/不稳），退化为
// 静态断言——verify.sh 仍以「仅注入 SL_VERIFY_API_BASE 值」的口径执行子
// 命令，且该行不得把 DB_PATH 传回去。
const cmdLine = verifySrc.split("\n").find((l) => l.includes('bash -c "$cmd"'));
check(!!cmdLine, 'verify.sh: cannot find the `( cd "$ROOT" && ... bash -c "$cmd" )` exec line');
if (cmdLine) {
  check(
    cmdLine.includes('API_BASE="${SL_VERIFY_API_BASE:-}"'),
    `verify.sh exec line must inject API_BASE only from SL_VERIFY_API_BASE: ${cmdLine.trim()}`
  );
  check(
    !/DB_PATH|E2E_BASE_URL|SL_GAME_DB/.test(cmdLine),
    `verify.sh exec line must not re-pass leaked vars into the child: ${cmdLine.trim()}`
  );
}

// ── 4. db.test.js 在污染环境下必须全绿（老代码 raw() 硬编码库路径时红）──
const runDbTest = (nodeBin) =>
  spawnSync(nodeBin, ["--test", DB_TEST], {
    cwd: ROOT,
    env: {
      ...process.env,
      DB_PATH: PROBE_DB,
      E2E_BASE_URL: "http://127.0.0.1:3118/game",
    },
    encoding: "utf8",
    timeout: 60000,
  });
let rDb = runDbTest(process.execPath);
if (
  rDb.status !== 0 &&
  /NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|different Node\.js version/.test(rDb.stdout + rDb.stderr)
) {
  const v24 = process.env.SL_NODE_V24 || "/root/.nvm/versions/node/v24.5.0/bin/node";
  console.log(
    `[env-leak-guard] note: ABI mismatch under ${process.version}, retrying with v24 node`
  );
  if (fs.existsSync(v24)) {
    rDb = runDbTest(v24);
  }
}
check(
  rDb.status === 0,
  `node --test server/db.test.js under DB_PATH=${PROBE_DB} exited ${rDb.status}:\n${(rDb.stdout + rDb.stderr).slice(-1500)}`
);
for (const suffix of ["", "-wal", "-shm", "-journal"]) {
  fs.rmSync(PROBE_DB + suffix, { force: true });
}

if (failures.length) {
  for (const f of failures) console.error(`[env-leak-guard] FAIL ${f}`);
  process.exit(1);
}
console.log("[env-leak-guard] PASS");
