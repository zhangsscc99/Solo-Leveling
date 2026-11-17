#!/usr/bin/env node
// F126 断言（node --test）：ci-deploy.sh / rollback.sh 的环境隔离与误回滚防护。
//
//   node --test scripts/e2e/ci-deploy-env.test.mjs
//
// 不跑真部署：SL_DEPLOY_ROOT 指向临时目录，PATH 前插桩 bin（pm2/curl/git/npm），
// SL_NODE_PREFERRED 指向只含 node 符号链接的目录，全程不碰 /www/Solo-Leveling、
// 不碰真实 pm2/git/curl。旧码跑必红（无 unset、无 SL_DEPLOY_ROOT、含
// checkout -- client/src、node 调用未过 env -u）。
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const CI = path.join(ROOT, "scripts", "ci-deploy.sh");
const RB = path.join(ROOT, "scripts", "rollback.sh");
const ciSrc = fs.readFileSync(CI, "utf8");
const rbSrc = fs.readFileSync(RB, "utf8");

const UNSET_RE = /^unset E2E_BASE_URL API_BASE E2E_NO_CLEANUP SL_VERIFY_API_BASE DB_PATH$/m;

test("bash -n: both scripts parse", () => {
  for (const f of [CI, RB]) {
    const r = spawnSync("bash", ["-n", f], { encoding: "utf8" });
    assert.equal(r.status, 0, `${path.basename(f)}: ${r.stderr}`);
  }
});

test("both scripts unset leaked env vars near the top", () => {
  for (const [name, src] of [
    ["ci-deploy.sh", ciSrc],
    ["rollback.sh", rbSrc],
  ]) {
    const head = src.split("\n").slice(0, 30).join("\n");
    assert.match(head, UNSET_RE, `${name} missing unset line in first 30 lines`);
  }
});

test("rollback.sh never checks out client/src from a ref", () => {
  assert.ok(
    !/checkout[^\n]*--[^\n]*client\/src/.test(rbSrc),
    "rollback.sh still rewrites working-tree sources (checkout -- client/src)"
  );
});

// 找出「裸 node 调用」：node 出现在命令位置（前面不是路径/变量字符）且同行前面
// 没有 env -u NODE_CHANNEL_FD 包裹。先剥掉引号字符串与注释再扫。
function bareNodeLines(src) {
  const bad = [];
  src.split("\n").forEach((raw, i) => {
    let line = raw.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
    const hash = line.indexOf("#");
    if (hash >= 0) line = line.slice(0, hash);
    const re = /(?:^|[^A-Za-z0-9_\/.])node\s+/g;
    let m;
    while ((m = re.exec(line))) {
      if (!line.slice(0, m.index).includes("env -u NODE_CHANNEL_FD")) {
        bad.push(`L${i + 1}: ${raw.trim()}`);
      }
    }
  });
  return bad;
}

test("every node invocation is wrapped with env -u NODE_CHANNEL_FD", () => {
  for (const [name, src] of [
    ["ci-deploy.sh", ciSrc],
    ["rollback.sh", rbSrc],
  ]) {
    assert.deepEqual(bareNodeLines(src), [], `${name} has bare node calls`);
  }
});

// ── 桩世界：临时 root + 桩 bin，模拟整条部署流水线 ─────────────────────
function makeWorld(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc22-deploy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, "root");
  const bin = path.join(dir, "bin");
  const nodeDir = path.join(dir, "nodebin");
  fs.mkdirSync(path.join(root, "client", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "scripts", "e2e"), { recursive: true });
  fs.mkdirSync(bin, { recursive: true });
  fs.mkdirSync(nodeDir, { recursive: true });

  fs.writeFileSync(
    path.join(root, "client", "package.json"),
    JSON.stringify({ name: "stub", scripts: { build: "true" } })
  );
  fs.writeFileSync(path.join(root, "client", "dist", "index.html"), '<div id="root"></div>');

  // e2e 桩：固定失败；顺带探测泄漏变量是否真被脚本 unset 掉。
  fs.writeFileSync(
    path.join(root, "scripts", "e2e", "run-all.mjs"),
    `if (process.env.E2E_BASE_URL || process.env.API_BASE || process.env.DB_PATH ||
    process.env.E2E_NO_CLEANUP || process.env.SL_VERIFY_API_BASE) {
  console.error("ENV_LEAK_DETECTED");
}
process.exit(1);
`
  );

  // rollback 桩：一旦被调用就写标记文件——ENV_ERROR 路径下绝不能出现。
  fs.writeFileSync(
    path.join(root, "scripts", "rollback.sh"),
    `#!/usr/bin/env bash\necho called >> "${dir}/rollback-called"\nexit 0\n`
  );
  fs.chmodSync(path.join(root, "scripts", "rollback.sh"), 0o755);

  // node 桩目录：SL_NODE_PREFERRED 指过来，目录里只有真 node 的符号链接，
  // 没有 pm2/npm —— PATH 前缀后桩 bin 里的 pm2/npm/git/curl 仍然生效。
  fs.symlinkSync(process.execPath, path.join(nodeDir, "node"));

  const stub = (name, body) => {
    const p = path.join(bin, name);
    fs.writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(p, 0o755);
  };
  stub("pm2", `case "$1" in jlist) echo '[{"name":"solo-leveling"}]';; *) exit 0;; esac`);
  stub("npm", `exit 0`);
  stub("git", `case "$*" in *rev-parse*) echo 0123456789abcdef0123456789abcdef01234567;; esac; exit 0`);
  stub(
    "curl",
    `url=""; out=""; prev=""
for a in "$@"; do
  case "$a" in http://*|https://*) url="$a";; esac
  if [ "$prev" = "-o" ]; then out="$a"; fi
  prev="$a"
done
case "$url" in
  *api/health*)
    case "$url" in *127.0.0.1:3020*) echo '{"ok":true}'; exit 0;; *) exit 7;; esac
    ;;
  *)
    [ -n "$out" ] && printf '<div id="root"></div>' > "$out"
    printf '200'; exit 0;;
esac`
  );

  const env = {
    PATH: `${bin}:/usr/bin:/bin`,
    SL_DEPLOY_ROOT: root,
    SL_NODE_PREFERRED: nodeDir,
    // 模拟调用 shell 残留的泄漏变量（F126 事故场景）
    E2E_BASE_URL: "http://127.0.0.1:3082/game",
    API_BASE: "http://127.0.0.1:3082/game/api",
    E2E_NO_CLEANUP: "1",
    SL_VERIFY_API_BASE: "http://127.0.0.1:3082/game/api",
    DB_PATH: "/tmp/fc22-leaked-should-be-unset.db",
    NODE_CHANNEL_FD: "99",
    NODE_CHANNEL_SERIALIZATION_MODE: "advanced",
  };
  return { dir, root, env };
}

test("e2e red + target unreachable → ENV_ERROR, exit 2, no rollback", (t) => {
  // 只有支持 SL_DEPLOY_ROOT/SL_NODE_PREFERRED 注入点的新码才可安全地跑桩；
  // 旧码不支持 → 本断言直接红（也绝不能拿旧码对着 /www/Solo-Leveling 真跑）。
  assert.match(ciSrc, /SL_DEPLOY_ROOT/, "ci-deploy.sh lacks SL_DEPLOY_ROOT injection point");
  assert.match(ciSrc, /SL_NODE_PREFERRED/, "ci-deploy.sh lacks SL_NODE_PREFERRED injection point");
  const { dir, env } = makeWorld(t);
  const r = spawnSync("bash", [CI], { env, encoding: "utf8", timeout: 120000 });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 2, `expected exit 2, got ${r.status}:\n${out}`);
  assert.match(out, /ENV_ERROR/, "expected ENV_ERROR in output");
  assert.ok(
    !fs.existsSync(path.join(dir, "rollback-called")),
    "rollback.sh must NOT be invoked on environment failure"
  );
  assert.ok(!out.includes("ENV_LEAK_DETECTED"), "leaked env vars reached the e2e runner");
});

test("e2e red + target healthy → business regression, rollback invoked, exit 1", (t) => {
  assert.match(ciSrc, /SL_DEPLOY_ROOT/);
  const { dir, env } = makeWorld(t);
  // e2e 目标 health 走 3020 桩 → 通 → 判业务回归 → 触发 rollback
  const r = spawnSync("bash", [CI], {
    env: { ...env, SL_E2E_HEALTH_URL: "http://127.0.0.1:3020/game/api/health" },
    encoding: "utf8",
    timeout: 120000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  assert.equal(r.status, 1, `expected exit 1, got ${r.status}:\n${out}`);
  assert.ok(
    fs.existsSync(path.join(dir, "rollback-called")),
    "business regression should trigger rollback.sh"
  );
});
