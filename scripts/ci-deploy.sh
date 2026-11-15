#!/usr/bin/env bash
set -euo pipefail

ROOT=/www/Solo-Leveling
HEALTH_URL=http://127.0.0.1:3020/game/api/health
APP_URL=http://127.0.0.1:3020/game/
STEP="lock"

exec 9>/www/Solo-Leveling/.deploy.lock
flock -n 9 || { echo 'another deploy is running'; exit 3; }

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail() { echo "[$(ts)] FAILED STEP: $STEP" >&2; exit 1; }
step() { STEP="$1"; echo "[$(ts)] STEP $2/7 $STEP"; }

step preflight 1
if ! pm2 jlist | grep -q '"name":"solo-leveling"'; then
  echo "[$(ts)] pm2 app 'solo-leveling' not found" >&2; fail
fi
[ -f "$ROOT/client/package.json" ] || { echo "[$(ts)] client/package.json missing" >&2; fail; }
echo "[$(ts)] OK preflight"

step node-runtime 2
node_bin=""
node_abi() { env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE "$1" -e 'process.stdout.write(process.versions.modules)' 2>/dev/null; }
preferred=/root/.nvm/versions/node/v24.5.0/bin
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

echo "[$(ts)] DEPLOY OK"
exit 0
