#!/usr/bin/env bash
# verify.sh — FEATURES.md 验收执行器
#
#   scripts/verify.sh <FID>    抽出该条目的 verify: 命令并执行
#   scripts/verify.sh --list   列出所有条目与其 verify / risk
#
# verify 两种写法（互不破块）：
#   续行（block） ：条目下一行缩进的 `verify: …`          —— --list 标 [block]
#   行内（inline）：条目行内「｜verify: …」或「|verify: …」—— --list 标 [inline]
#                  取「verify:」之后到下一个 ｜/| 或行尾的内容，去反引号包裹与首尾空白
#
# FEATURES 路径：SL_FEATURES_FILE 环境变量优先，其次第二个位置参数，
# 默认 $ROOT/docs/FEATURES.md。
#
# 输出: [VERIFY] <FID> PASS|FAIL (<耗时>)
# 退出码: 2 = 无 verify / 条目不存在
#         3 = NO_ASSERT_FILE（verify 含「新增/扩写 `scripts/….mjs`」但该文件不在仓库）
#         其它 = 断言命令自身退出码
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# FEATURES 路径：SL_FEATURES_FILE 环境变量优先，默认 $ROOT/docs/FEATURES.md
# （自检脚本用临时副本时传该变量）。
FEATURES="${SL_FEATURES_FILE:-$ROOT/docs/FEATURES.md}"
[ -f "$FEATURES" ] || { echo "FEATURES.md not found: $FEATURES" >&2; exit 2; }

# 环境隔离：调度 shell 常驻泄漏的变量（DB_PATH/E2E_BASE_URL/API_BASE 打到
# 死端口或错库）会让断言假红，入口统一清掉——必须在 case 之前，--list 也清。
# SL_VERIFY_API_BASE 是唯一显式覆盖口，保留不清。
for _k in E2E_BASE_URL DB_PATH SL_GAME_DB API_BASE; do
  if [ -n "${!_k+x}" ]; then
    printf '[verify] cleared env: %s=%s\n' "$_k" "${!_k}" >&2
  fi
done
unset _k E2E_BASE_URL DB_PATH SL_GAME_DB API_BASE

# Emit rows: FID RS checked(0/1) RS risk RS verify RS src(inline/block) RS desc   (RS = \x1f)
parse() {
  awk '
    function emit() {
      if (fid != "") printf "%s\x1f%d\x1f%s\x1f%s\x1f%s\x1f%s\n", fid, checked, risk, verify, vsrc, desc
    }
    # 行内「｜key:」或「|key:」→ 取到下一个 ｜/| 或行尾，去首尾空白
    function inline_field(txt, key,   tail) {
      if (match(txt, "[｜|][[:space:]]*" key ":[[:space:]]*")) {
        tail = substr(txt, RSTART + RLENGTH)
        if (match(tail, /[｜|]/)) tail = substr(tail, 1, RSTART - 1)
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", tail)
        return tail
      }
      return ""
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
      inflag = 1; verify = ""; vsrc = ""; risk = ""
      v = inline_field(line, "verify")
      if (v != "") {
        if (v ~ /^`[^`]*`$/) v = substr(v, 2, length(v) - 2)
        verify = v; vsrc = "inline"
      }
      r = inline_field(line, "risk")
      if (r != "") risk = r
      next
    }
    inflag && /^[[:space:]]*verify:[[:space:]]*/ {
      v = $0; sub(/^[[:space:]]*verify:[[:space:]]*/, "", v); verify = v; vsrc = "block"; next
    }
    inflag && /^[[:space:]]*risk:[[:space:]]*/ {
      r = $0; sub(/^[[:space:]]*risk:[[:space:]]*/, "", r); risk = r; next
    }
    inflag && /^[[:space:]]/ { next }
    { inflag = 0 }
    END { emit() }
  ' "$FEATURES"
}

# verify 文本含「新增/扩写/待实现」时，取第一个 scripts/ 开头的 .mjs 路径
# （可有反引号包裹）；无匹配输出空串。
assert_file() {
  case "$1" in *新增*|*扩写*|*待实现*) ;; *) return 0;; esac
  printf '%s' "$1" | grep -oE 'scripts/[A-Za-z0-9_./-]+\.mjs' | head -n1
}

fmt_ms() { awk -v m="$1" 'BEGIN { printf "%.2fs", m / 1000 }'; }

# 只解析不执行：供部署闸门用（对旧服务跑断言会假红，故只在部署前检查
# 「验收是否真的可执行」——MISSING / NO_ASSERT_FILE 一律非 0）。
resolve_row() {
  local fid row
  fid="$(printf '%s' "$1" | tr 'a-z' 'A-Z')"
  row="$(parse | awk -F'\x1f' -v f="$fid" 'toupper($1) == toupper(f)')"
  printf '%s' "$row"
}

case "${1:-}" in
  --check)
    [ -n "${2:-}" ] || { echo "usage: $0 --check <FID>" >&2; exit 2; }
    FID="$(printf '%s' "$2" | tr 'a-z' 'A-Z')"
    row="$(resolve_row "$FID")"
    [ -n "$row" ] || { echo "[GATE] $FID 未知条目" >&2; exit 2; }
    vtxt="$(printf '%s' "$row" | awk -F'\x1f' '{print $4}')"
    if [ -z "$vtxt" ]; then
      echo "[GATE] $FID MISSING (no verify)" >&2; exit 2
    fi
    af="$(assert_file "$vtxt")"
    if [ -n "$af" ] && [ ! -f "$ROOT/$af" ]; then
      echo "[GATE] $FID NO_ASSERT_FILE ($af)" >&2; exit 3
    fi
    echo "[GATE] $FID OK"
    exit 0
    ;;
  --list|-l)
    parse | while IFS=$'\x1f' read -r fid checked risk verify vsrc desc; do
      box=" "; [ "$checked" = "1" ] && box="x"
      vdisp="${verify:-MISSING}"
      if [ -n "$verify" ]; then
        af="$(assert_file "$verify")"
        if [ -n "$af" ] && [ ! -f "$ROOT/$af" ]; then
          vdisp="NO_ASSERT_FILE($af) $verify"
        fi
        vdisp="[${vsrc:-block}] $vdisp"
      fi
      printf '[%s] %-6s risk=%-4s verify=%s\n      %s\n' \
        "$box" "$fid" "${risk:-MISSING}" "$vdisp" "$desc"
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

verify_txt="$(printf '%s' "$row" | awk -F'\x1f' '{print $4}')"
if [ -z "$verify_txt" ]; then
  echo "[VERIFY] $FID 缺验收断言 (no verify: line in FEATURES.md)" >&2
  exit 2
fi

# 断言文件闸门：verify 含「新增/扩写 `scripts/….mjs`」而文件不在仓库 →
# NO_ASSERT_FILE 退出 3，绝不放行 PASS；文件在则以 `node <file>` 照常执行。
cmd="$verify_txt"
af="$(assert_file "$verify_txt")"
if [ -n "$af" ]; then
  if [ ! -f "$ROOT/$af" ]; then
    echo "[VERIFY] $FID NO_ASSERT_FILE ($af 不存在于仓库，verify 不可执行)" >&2
    exit 3
  fi
  cmd="node $af"
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
