#!/usr/bin/env bash
set -euo pipefail

ROOT=/www/Solo-Leveling
HEALTH_URL=http://127.0.0.1:3020/game/api/health
REF="${1:-HEAD}"
STEP="lock"

exec 9>/www/Solo-Leveling/.deploy.lock
flock -n 9 || { echo 'another deploy is running'; exit 3; }

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }
fail() { echo "[$(ts)] ROLLBACK FAILED STEP: $STEP" >&2; exit 1; }

STEP="validate-ref"
git -C "$ROOT" rev-parse --verify --quiet "$REF" >/dev/null \
  || { echo "[$(ts)] invalid git ref: $REF" >&2; fail; }
echo "[$(ts)] OK validate-ref ($REF)"

STEP="restore"
git -C "$ROOT" checkout "$REF" -- client/src client/index.html || fail
echo "[$(ts)] OK restore (client/src, client/index.html from $REF)"

STEP="node-runtime"
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

STEP="build"
cd "$ROOT"
env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE npm --prefix client run build || fail
echo "[$(ts)] OK build"

STEP="restart"
pm2 restart solo-leveling --update-env || fail
echo "[$(ts)] OK restart"

STEP="health-check"
healthy=""
for _ in $(seq 1 30); do
  body=$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)
  if echo "$body" | grep -q '"ok":true'; then healthy="$body"; break; fi
  sleep 1
done
[ -n "$healthy" ] || { echo "[$(ts)] health endpoint did not become ok within 30s" >&2; fail; }
echo "[$(ts)] OK health-check ($healthy)"

echo "[$(ts)] ROLLBACK OK (restored to $REF)"
exit 0
