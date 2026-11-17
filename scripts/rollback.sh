#!/usr/bin/env bash
set -euo pipefail

# F126: 同 ci-deploy.sh —— 清掉调用 shell 泄漏的端口/库路径变量。
unset E2E_BASE_URL API_BASE E2E_NO_CLEANUP SL_VERIFY_API_BASE DB_PATH

ROOT="${SL_DEPLOY_ROOT:-/www/Solo-Leveling}"
HEALTH_URL="${SL_DEPLOY_HEALTH_URL:-http://127.0.0.1:3020/game/api/health}"
REF="${1:-HEAD}"
BACKUP_DIR="$ROOT/.deploy-backup"
STEP="lock"

exec 9>"$ROOT/.deploy.lock"
flock -n 9 || { echo 'another deploy is running'; exit 3; }

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

manual_hint() {
  cat >&2 <<EOF
[$(ts)] 可人工执行的恢复步骤（在独立 worktree 构建，绝不动 \$ROOT 工作区源码）：
  git -C $ROOT worktree add /tmp/sl-rollback $REF
  npm --prefix /tmp/sl-rollback/client ci
  npm --prefix /tmp/sl-rollback/client run build
  rsync -a --delete /tmp/sl-rollback/client/dist/ $ROOT/client/dist/
  pm2 restart solo-leveling --update-env
  curl -fsS $HEALTH_URL
EOF
}

fail() {
  echo "[$(ts)] ROLLBACK FAILED STEP: $STEP" >&2
  manual_hint
  exit 1
}

STEP="validate-ref"
git -C "$ROOT" rev-parse --verify --quiet "$REF" >/dev/null \
  || { echo "[$(ts)] invalid git ref: $REF" >&2; fail; }
echo "[$(ts)] OK validate-ref ($REF)"

# F126: 不得在有未提交改动时执行——历史上 rollback 直接 checkout 旧 ref 覆盖
# client/src，会留下 staged 反向改动并造出「新后端 + 旧前端」混合态。现在
# 一律拒绝，先把工作区收拾干净再来。
STEP="clean-tree"
if [ "${SL_ROLLBACK_FORCE:-0}" != "1" ]; then
  dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null || echo 'git-status-failed')"
  if [ -n "$dirty" ]; then
    echo "[$(ts)] working tree has uncommitted changes — refusing to rollback:" >&2
    printf '%s\n' "$dirty" >&2
    echo "[$(ts)] commit or 'git stash' first (or SL_ROLLBACK_FORCE=1 to override)" >&2
    fail
  fi
fi
echo "[$(ts)] OK clean-tree"

# 只回滚构建产物：ci-deploy.sh 在每次 build 前把当时的 client/dist（上一次
# 成功部署的 last-known-good 包）备份到 .deploy-backup/dist。恢复 = 把备份
# 原样放回去 + 重启，不触碰 git 工作区。
STEP="restore-artifacts"
if [ ! -d "$BACKUP_DIR/dist" ]; then
  echo "[$(ts)] no backup bundle at $BACKUP_DIR/dist — nothing safe to restore" >&2
  fail
fi
backup_ref="$(cat "$BACKUP_DIR/ref" 2>/dev/null || echo 'unknown')"
rm -rf "$ROOT/client/dist"
cp -a "$BACKUP_DIR/dist" "$ROOT/client/dist" || fail
echo "[$(ts)] OK restore-artifacts (client/dist <= backup of ${backup_ref:0:12})"

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

echo "[$(ts)] ROLLBACK OK (restored build artifacts for ${backup_ref:0:12}; requested ref $REF)"
exit 0
