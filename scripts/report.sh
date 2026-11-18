#!/usr/bin/env bash
# report.sh — 生成本轮运行报告 docs/runs/<YYYY-MM-DD_HHMM>.md
# 纯 bash + node，无第三方依赖。
set -u
set -o pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

RUNS_DIR="${REPORT_RUNS_DIR:-$ROOT/docs/runs}"
mkdir -p "$RUNS_DIR"
TS="$(date +%Y-%m-%d_%H%M)"
OUT="$RUNS_DIR/$TS.md"

HEALTH_URL="http://127.0.0.1:3020/game/api/health"
PUBLIC_URL="https://openfolio.uk/game"

# 环境隔离（与 verify.sh 同口径）：调度 shell 常驻泄漏的变量会让断言/单测
# 打到死端口或错库。SL_VERIFY_API_BASE 作为唯一显式覆盖口保留不清。
ENV_CLEARED=""
for _k in E2E_BASE_URL DB_PATH SL_GAME_DB API_BASE; do
  if [ -n "${!_k+x}" ]; then
    ENV_CLEARED="${ENV_CLEARED:+${ENV_CLEARED}, }${_k}=${!_k}"
  fi
done
unset _k E2E_BASE_URL DB_PATH SL_GAME_DB API_BASE

# F127: verify 执行器可用环境变量替换（断言/测试用桩注入，不改对外契约）。
VERIFY_BIN="${REPORT_VERIFY_BIN:-./scripts/verify.sh}"

NODE_CLEAN="env -u NODE_CHANNEL_FD -u NODE_CHANNEL_SERIALIZATION_MODE"

# F127: 每条断言跑前清掉 e2e-*/verify-* 前缀的存档及其子表残留——上一条
# 断言留下的浏览器会话/存档数据是「逐条单跑全 PASS、全表跑成片 FAIL」的
# 主要污染源。库路径口径与 scripts/assert/*.mjs 一致
# （DB_PATH || SL_GAME_DB || <repo>/data/game.db）。
clean_test_saves() {
  $NODE_CLEAN node <<'EOF' || echo "[report] warn: test-save cleanup failed" >&2
const path = require("path");
const fs = require("fs");
const dbFile =
  process.env.DB_PATH ||
  process.env.SL_GAME_DB ||
  path.join(process.cwd(), "data", "game.db");
if (!fs.existsSync(dbFile)) process.exit(0);
const Database = require(path.join(process.cwd(), "node_modules", "better-sqlite3"));
const db = new Database(dbFile, { timeout: 5000 });
try {
  const ids = db
    .prepare(
      "SELECT id FROM saves WHERE player_name LIKE 'e2e-%' OR player_name LIKE 'verify-%'"
    )
    .all()
    .map((r) => r.id);
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    for (const t of ["combat", "quest_daily", "shadows", "log", "inventory"]) {
      db.prepare(`DELETE FROM ${t} WHERE save_id IN (${ph})`).run(...ids);
    }
    db.prepare(`DELETE FROM saves WHERE id IN (${ph})`).run(...ids);
  }
} finally {
  db.close();
}
EOF
}

# 正确取 verify 的退出码：if ! out=$(...) 直接拿命令状态，不走管道、
# 不经过 tail——旧写法 rc 取到的是 tail 的状态，且只剩最后一行输出。
VERIFY_OUT=""
VERIFY_RC=0
run_verify() {
  local fid="$1" out rc
  if out="$("$VERIFY_BIN" "$fid" 2>&1)"; then rc=0; else rc=$?; fi
  # 超时型失败（环境抖动/浏览器启动偶发）清一遍残留重跑一次再判。
  if [ "$rc" -ne 0 ] && printf '%s' "$out" | grep -qE 'Timeout|ECONNREFUSED|ERR_DLOPEN'; then
    clean_test_saves
    local out2 rc2
    if out2="$("$VERIFY_BIN" "$fid" 2>&1)"; then rc2=0; else rc2=$?; fi
    out="$out
[retry] $out2"
    rc="$rc2"
  fi
  VERIFY_OUT="$out"
  VERIFY_RC="$rc"
}

# ── 1. 本轮合并的 commit（以上一份报告文件名为区间起点） ─────────────
prev="$(ls -1 "$RUNS_DIR" 2>/dev/null | grep -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{4}\.md$' | sort | tail -n 1)"
if [ -n "$prev" ]; then
  since="$(printf '%s' "${prev%.md}" | sed 's/_/ /; s/\([0-9][0-9]\)\([0-9][0-9]\)$/\1:\2/')"
  range_desc="since previous report $prev"
  commits="$(git -C "$ROOT" log --since="$since" --pretty='- `%h` %s' 2>/dev/null)"
else
  range_desc="last 15 commits (no previous report)"
  commits="$(git -C "$ROOT" log -15 --pretty='- `%h` %s' 2>/dev/null)"
fi
[ -n "$commits" ] || commits="- (none)"

# ── 2. 每条 FEATURES 的 verify 执行结果 ──────────────────────────────
verify_rows=""
pass_n=0; fail_n=0; miss_n=0
while IFS= read -r fid; do
  clean_test_saves
  run_verify "$fid"
  vout="$VERIFY_OUT"
  rc="$VERIFY_RC"
  last="$(printf '%s\n' "$vout" | awk 'NF{l=$0} END{print l}')"
  if printf '%s' "$vout" | grep -q '缺验收断言\|未知条目'; then
    status="NO ASSERT"; miss_n=$((miss_n + 1))
  elif [ "$rc" -eq 0 ]; then
    status="PASS"; pass_n=$((pass_n + 1))
  else
    status="FAIL"; fail_n=$((fail_n + 1))
  fi
  dur="$(printf '%s' "$last" | grep -oE '\([0-9.]+s\)' | tr -d '()')"
  cell="$(printf '%s' "$last" | tr '\n' ' ' | sed 's/|/\\|/g')"
  if [ "$status" = "FAIL" ]; then
    # F127: FAIL 行必须附断言原始错误行（截断 300 字符），否则无从定位。
    errline="$(printf '%s\n' "$vout" \
      | grep -iE 'error|assert|fail|timeout|econnrefused|err_dlopen|exception|cannot|denied' \
      | head -3 | tr '\n' ' ' | sed 's/|/\\|/g' | cut -c1-300)"
    [ -n "$errline" ] || errline="$(printf '%s' "$vout" | tr '\n' ' ' | sed 's/|/\\|/g' | cut -c1-300)"
    cell="$cell — err: $errline"
  fi
  verify_rows="${verify_rows}| ${fid} | ${status} | ${dur:--} | ${cell} |\n"
done < <(awk '/^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]*F[0-9]/ {
  line=$0; sub(/^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]*/,"",line);
  split(line,a,/[[:space:]]+/); print a[1]
}' docs/FEATURES.md)

# ── 3. E2E 结果 ─────────────────────────────────────────────────────
if [ "${REPORT_SKIP_E2E:-0}" = "1" ]; then
  e2e_log="(skipped: REPORT_SKIP_E2E=1)"
  e2e_rc=0
else
  e2e_log="$($NODE_CLEAN node scripts/e2e/run-all.mjs 2>&1)"
  e2e_rc=$?
fi
# screenshots produced by THIS suite: from the run log, else recent files
# matching our e2e-<script>-<ts>.png names
screens="$(printf '%s\n' "$e2e_log" | grep -oE '/root/logs/e2e-[a-z0-9._-]+\.png' | sort -u)"
[ -n "$screens" ] || screens="$(ls -1t /root/logs/e2e-boot-*.png /root/logs/e2e-action-*.png /root/logs/e2e-panels-*.png /root/logs/e2e-mobile-*.png /root/logs/e2e-quests-*.png 2>/dev/null | head -10)"

# ── 4. 部署状态 ─────────────────────────────────────────────────────
health="$(curl -fsS --max-time 10 "$HEALTH_URL" 2>&1 || echo 'unreachable')"
pub_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PUBLIC_URL" 2>/dev/null || echo '000')"
pm2_state="$(pm2 jlist 2>/dev/null | $NODE_CLEAN node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d).find(x=>x.name==="solo-leveling");console.log(a?`${a.pm2_env.status} (restarts:${a.pm2_env.restart_time}, uptime:${Math.round((Date.now()-a.pm2_env.pm_uptime)/1000)}s)`:"not found")}catch(e){console.log("unknown")}})')"

# ── 5. 风险等级统计 ─────────────────────────────────────────────────
risk_stats="$(awk '
  /^[[:space:]]*-[[:space:]]*\[[ xX]\]/ { inflag=1; next }
  inflag && /^[[:space:]]*risk:[[:space:]]*/ {
    r=$0; sub(/^[[:space:]]*risk:[[:space:]]*/,"",r); gsub(/[[:space:]]/,"",r); c[r]++; inflag=0; next
  }
  /^[[:space:]]/ { next }
  { inflag=0 }
  END {
    for (k in c) printf "%s=%d ", k, c[k]
    if (!("low" in c) && !("med" in c) && !("high" in c)) printf "low=0 med=0 high=0 (无 risk 标注)"
  }
' docs/FEATURES.md)"

# ── 写报告 ──────────────────────────────────────────────────────────
{
  echo "# 运行报告 $TS"
  echo
  echo "## 合并提交（$range_desc）"
  echo
  echo "$commits"
  echo
  echo "## FEATURES 验收（PASS $pass_n / FAIL $fail_n / 缺断言 $miss_n）"
  echo
  echo "| FID | 结果 | 耗时 | 输出 |"
  echo "|---|---|---|---|"
  printf '%b' "$verify_rows"
  echo
  echo "## E2E（exit=$e2e_rc）"
  echo
  echo '```'
  echo "$e2e_log"
  echo '```'
  echo
  echo "最近截图："
  if [ -n "$screens" ]; then printf '%s\n' "$screens" | sed 's/^/- `/; s/$/`/'; else echo "- (none)"; fi
  echo
  echo "## 部署状态"
  echo
  echo "- 环境清理: ${ENV_CLEARED:-无}"
  echo "- pm2 solo-leveling: $pm2_state"
  echo "- health: \`$health\`"
  echo "- 公网 $PUBLIC_URL → HTTP $pub_code"
  echo
  echo "## 风险等级统计"
  echo
  echo "$risk_stats"
  echo
  echo "_generated by scripts/report.sh_"
} > "$OUT"

echo "report written: $OUT"
