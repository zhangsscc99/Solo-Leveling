#!/usr/bin/env bash
# verify.sh — FEATURES.md 验收执行器
#
#   scripts/verify.sh <FID>    抽出该条目下一行的 verify: 命令并执行
#   scripts/verify.sh --list   列出所有条目与其 verify / risk
#
# 输出: [VERIFY] <FID> PASS|FAIL (<耗时>)
# 无 verify 行 → 提示「缺验收断言」并退出 2
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FEATURES="$ROOT/docs/FEATURES.md"
[ -f "$FEATURES" ] || { echo "FEATURES.md not found: $FEATURES" >&2; exit 2; }

# Emit rows: FID RS checked(0/1) RS risk RS verify RS desc   (RS = \x1f)
parse() {
  awk '
    function emit() {
      if (fid != "") printf "%s\x1f%d\x1f%s\x1f%s\x1f%s\n", fid, checked, risk, verify, desc
    }
    /^[[:space:]]*-[[:space:]]*\[[ xX]\]/ {
      emit()
      line = $0
      sub(/^[[:space:]]*-[[:space:]]*\[[ xX]\][[:space:]]*/, "", line)
      split(line, a, /[[:space:]]+/)
      fid = a[1]
      checked = ($0 ~ /\[[xX]\]/) ? 1 : 0
      desc = substr(line, length(fid) + 2)
      sub(/[[:space:]]*✅.*$/, "", desc)
      inflag = 1; verify = ""; risk = ""
      next
    }
    inflag && /^[[:space:]]*verify:[[:space:]]*/ {
      v = $0; sub(/^[[:space:]]*verify:[[:space:]]*/, "", v); verify = v; next
    }
    inflag && /^[[:space:]]*risk:[[:space:]]*/ {
      r = $0; sub(/^[[:space:]]*risk:[[:space:]]*/, "", r); risk = r; next
    }
    inflag && /^[[:space:]]/ { next }
    { inflag = 0 }
    END { emit() }
  ' "$FEATURES"
}

fmt_ms() { awk -v m="$1" 'BEGIN { printf "%.2fs", m / 1000 }'; }

case "${1:-}" in
  --list|-l)
    parse | while IFS=$'\x1f' read -r fid checked risk verify desc; do
      box=" "; [ "$checked" = "1" ] && box="x"
      printf '[%s] %-6s risk=%-4s verify=%s\n      %s\n' \
        "$box" "$fid" "${risk:-MISSING}" "${verify:-MISSING}" "$desc"
    done
    exit 0
    ;;
  ""|--help|-h)
    echo "usage: $0 <FID> | --list" >&2
    exit 2
    ;;
esac

FID="$(printf '%s' "$1" | tr 'a-z' 'A-Z')"
row="$(parse | awk -F'\x1f' -v f="$FID" 'toupper($1) == toupper(f)')"
[ -n "$row" ] || { echo "[VERIFY] $FID 未知条目 (not found in FEATURES.md)" >&2; exit 2; }

cmd="$(printf '%s' "$row" | awk -F'\x1f' '{print $4}')"
if [ -z "$cmd" ]; then
  echo "[VERIFY] $FID 缺验收断言 (no verify: line in FEATURES.md)" >&2
  exit 2
fi

t0="$(date +%s%3N)"
# 环境隔离：API_BASE 常被其它项目的 shell 环境泄漏进来，导致断言打到错误端口。
# 只有显式传入 SL_VERIFY_API_BASE 才覆盖，否则清空让 _http.mjs 回落到本机 3020。
( cd "$ROOT" && API_BASE="${SL_VERIFY_API_BASE:-}" bash -c "$cmd" )
rc=$?
t1="$(date +%s%3N)"

if [ "$rc" -eq 0 ]; then
  echo "[VERIFY] $FID PASS ($(fmt_ms $((t1 - t0))))"
else
  echo "[VERIFY] $FID FAIL ($(fmt_ms $((t1 - t0))))"
fi
exit "$rc"
