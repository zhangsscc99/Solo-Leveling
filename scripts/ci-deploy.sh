#!/usr/bin/env bash
set -euo pipefail

# F126: 调用 shell 残留的 E2E_BASE_URL / API_BASE / DB_PATH 会让 e2e 打到
# 不存在的端口或让断言写错库 → 全红假失败 → 误回滚。入口一律清干净，
# e2e/assert 脚本各自回落到内置默认目标。
unset E2E_BASE_URL API_BASE E2E_NO_CLEANUP SL_VERIFY_API_BASE DB_PATH

ROOT="${SL_DEPLOY_ROOT:-/www/Solo-Leveling}"
HEALTH_URL="${SL_DEPLOY_HEALTH_URL:-http://127.0.0.1:3020/game/api/health}"
APP_URL="${SL_DEPLOY_APP_URL:-http://127.0.0.1:3020/game/}"
# e2e/run-all.mjs 的目标由 scripts/e2e/lib.mjs 决定（E2E_BASE_URL 已被清掉 →
# 内置默认 https://openfolio.uk/game）。e2e 失败时用它的 health 区分
# 「环境不通」与「业务回归」。
E2E_HEALTH_URL="${SL_E2E_HEALTH_URL:-https://openfolio.uk/game/api/health}"
BACKUP_DIR="$ROOT/.deploy-backup"
STEP="lock"

exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo 'another deploy is running'; exit 3; }

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail() { echo "[$(ts)] FAILED STEP: $STEP" >&2; exit 1; }
step() { STEP="$1"; echo "[$(ts)] STEP $2/8 $STEP"; }

# last-known-good ref: recorded after every successful deploy; used as the
# rollback target if the E2E gate rejects this deploy.
DEPLOYED_REF_FILE="$ROOT/.deployed-ref"
PREV_REF="$(cat "$DEPLOYED_REF_FILE" 2>/dev/null || git -C "$ROOT" rev-parse 'HEAD~1' 2>/dev/null || git -C "$ROOT" rev-parse HEAD)"

step preflight 1
if ! pm2 jlist | grep -q '"name":"solo-leveling"'; then
  echo "[$(ts)] pm2 app 'solo-leveling' not found" >&2; fail
fi
[ -f "$ROOT/client/package.json" ] || { echo "[$(ts)] client/package.json missing" >&2; fail; }
echo "[$(ts)] OK preflight"

# P212 部署闸门：本轮勾选的 FID 若「验收不可执行」（MISSING / NO_ASSERT_FILE）
# 直接中止部署——否则调度器会以为跑过验收、其实一条都没跑。
# 只做解析级检查（--check）：对旧服务真跑断言会假红，那是 full-e2e 的活。
# 逃生阀：SL_SKIP_VERIFY_GATE=1。
step verify-gate 1b
if [ "${SL_SKIP_VERIFY_GATE:-0}" = "1" ]; then
  echo "[$(ts)] WARN verify-gate skipped by SL_SKIP_VERIFY_GATE=1"
else
  prev_ref="$(cat "$DEPLOYED_REF_FILE" 2>/dev/null || echo '')"
  if [ -z "$prev_ref" ] || ! git -C "$ROOT" cat-file -e "${prev_ref}^{commit}" 2>/dev/null; then
    echo "[$(ts)] WARN verify-gate: no usable previous ref, skipped"
  else
    fids="$(git -C "$ROOT" diff "$prev_ref" HEAD -- docs/FEATURES.md 2>/dev/null \
      | sed -n 's/^+[[:space:]]*-[[:space:]]*\[[xX]\][[:space:]]*\([A-Za-z0-9_-]\{2,\}\).*/\1/p' | sort -u)"
    if [ -z "$fids" ]; then
      echo "[$(ts)] WARN verify-gate: no newly checked FID in diff, skipped"
    else
      for fid in $fids; do
        if bash "$ROOT/scripts/verify.sh" --check "$fid"; then :; else
          echo "[$(ts)] verify-gate rejected $fid" >&2; fail
        fi
      done
      echo "[$(ts)] OK verify-gate ($(echo $fids | wc -w) FID)"
    fi
  fi
fi

step node-runtime 2
node_bin=""
node_abi() { env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE "$1" -e 'process.stdout.write(process.versions.modules)' 2>/dev/null; }
preferred="${SL_NODE_PREFERRED:-/root/.nvm/versions/node/v24.5.0/bin}"
if [ -x "$preferred/node" ] && [ "$(node_abi "$preferred/node")" = "137" ]; then
  node_bin="$preferred"
else
  for cand in /root/.nvm/versions/node/*/bin/node; do
    [ -x "$cand" ] || continue
    if [ "$(node_abi "$cand")" = "137" ]; then node_bin="$(dirname "$cand")"; break; fi
  done
fi
[ -n "$node_bin" ] || { echo "[$(ts)] no node runtime with ABI 137 found" >&2; fail; }
PATH="$node_bin:$PATH"
export PATH
echo "[$(ts)] OK node-runtime ($node_bin/node $(env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE "$node_bin/node" -v) ABI 137)"

step build 3
cd "$ROOT"
# 先把「当前线上正在跑的构建产物」备份到 .deploy-backup/dist —— 它是上一次
# 成功部署产出的 last-known-good 包，rollback.sh 只回滚这个产物，绝不动
# 工作区源码。
mkdir -p "$BACKUP_DIR"
if [ -d client/dist ]; then
  rm -rf "$BACKUP_DIR/dist"
  cp -a client/dist "$BACKUP_DIR/dist"
  cat "$DEPLOYED_REF_FILE" > "$BACKUP_DIR/ref" 2>/dev/null || true
fi
env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE npm --prefix client run build || fail
echo "[$(ts)] OK build"

step health-baseline 4
baseline=$(curl -fsS "$HEALTH_URL") || { echo "[$(ts)] baseline health check failed: $HEALTH_URL" >&2; fail; }
echo "$baseline" | grep -q '"ok":true' || { echo "[$(ts)] baseline not ok: $baseline" >&2; fail; }
echo "[$(ts)] OK health-baseline ($baseline)"

step restart 5
pm2 restart solo-leveling --update-env || fail
echo "[$(ts)] OK restart"

step health-check 6
healthy=""
for _ in $(seq 1 30); do
  body=$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)
  if echo "$body" | grep -q '"ok":true'; then healthy="$body"; break; fi
  sleep 1
done
[ -n "$healthy" ] || { echo "[$(ts)] health endpoint did not become ok within 30s" >&2; fail; }
echo "[$(ts)] OK health-check ($healthy)"

step app-page 7
code=$(curl -fsS -o /tmp/ci-deploy-index.html -w '%{http_code}' "$APP_URL") || fail
[ "$code" = "200" ] || { echo "[$(ts)] app page returned HTTP $code" >&2; fail; }
grep -q 'id="root"' /tmp/ci-deploy-index.html || { echo "[$(ts)] app page missing id=\"root\"" >&2; fail; }
echo "[$(ts)] OK app-page (HTTP $code, root element present)"

step e2e 8
if env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE node "$ROOT/scripts/e2e/run-all.mjs"; then
  echo "[$(ts)] OK e2e"
else
  # F126: e2e 红先区分「环境错」与「业务回归」——目标 health 都打不通时
  # 全红只能说明网络/端口环境有问题，回滚只会把线上搞成新旧混合态。
  if ! curl -fsS --max-time 10 "$E2E_HEALTH_URL" >/dev/null 2>&1; then
    echo "[$(ts)] ENV_ERROR: e2e target unreachable ($E2E_HEALTH_URL) — treating red e2e as environment failure, NOT rolling back" >&2
    echo "[$(ts)] check network/proxy/DNS to the e2e target, then re-run scripts/ci-deploy.sh" >&2
    exit 2
  fi
  echo "[$(ts)] E2E gate failed — rolling back to ${PREV_REF:0:12}" >&2
  # release the deploy lock so rollback.sh can take it
  exec 9>&-
  if ! "$ROOT/scripts/rollback.sh" "$PREV_REF"; then
    echo "[$(ts)] rollback to $PREV_REF also failed" >&2
  fi
  fail
fi

git -C "$ROOT" rev-parse HEAD > "$DEPLOYED_REF_FILE" 2>/dev/null || true
echo "[$(ts)] DEPLOY OK"
exit 0
