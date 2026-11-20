#!/usr/bin/env bash
# wt-prep.sh: prepare a fresh git worktree for E2E runs.
#
# New worktrees lack node_modules/, scripts/e2e/node_modules/ and
# client/dist/ (all gitignored), so Playwright E2E fails on first run
# with ENOENT for client/dist/index.html. This script:
#   - symlinks node_modules dirs from the main tree (relative links)
#   - builds client/dist when missing
#   - is idempotent; safe to run repeatedly
#
# Usage:
#   bash scripts/wt-prep.sh [--check] [--force]
#     (default)   prepare: fill in whatever is missing, print WT-PREP OK
#     --check     verify only, change nothing; exit non-zero if anything
#                 is missing and print what + how to fix
#     --force     same as default (accepted for explicitness)
set -euo pipefail

log()  { echo "[wt-prep] $*"; }
fail() { echo "[wt-prep] ERROR: $*" >&2; exit 1; }

MODE=prep
for arg in "$@"; do
  case "$arg" in
    --check) MODE=check ;;
    --force) MODE=prep ;;
    *) fail "unknown argument: $arg (usage: bash scripts/wt-prep.sh [--check] [--force])" ;;
  esac
done

cd "$(git rev-parse --show-toplevel)"
WT_ROOT="$(pwd -P)"

# Main tree root = parent of the shared .git common dir.
COMMON_DIR="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
MAIN_ROOT="$(dirname "$COMMON_DIR")"

if [ "$WT_ROOT" = "$MAIN_ROOT" ]; then
  IS_MAIN=1
  log "current directory is the main tree; symlink steps will be skipped"
else
  IS_MAIN=0
  log "worktree: $WT_ROOT"
  log "main tree: $MAIN_ROOT"
fi

MISSING=()

# Reuse an existing node_modules from the main tree via a relative
# symlink; install with npm ci when the main tree doesn't have one
# either. $1 = path relative to repo root (e.g. "scripts/e2e").
ensure_deps() {
  local rel="$1" label="$2"
  local link="$WT_ROOT/$rel/node_modules"
  local target="$MAIN_ROOT/$rel/node_modules"

  if [ -d "$link" ] && [ ! -L "$link" ]; then
    log "skip: $label deps already installed ($rel/node_modules is a real dir)"
    return 0
  fi

  if [ -L "$link" ] && [ -e "$link" ]; then
    log "skip: $label deps already linked ($rel/node_modules -> $(readlink "$link"))"
    return 0
  fi

  # broken symlink: clean it up before re-linking
  [ -L "$link" ] && rm -f "$link"

  if [ "$MODE" = check ]; then
    MISSING+=("$label deps missing -> run: bash scripts/wt-prep.sh")
    return 0
  fi

  if [ "$IS_MAIN" = 0 ] && [ -d "$target" ]; then
    local reltarget
    reltarget="$(realpath --relative-to="$(dirname "$link")" "$target")"
    ln -s "$reltarget" "$link"
    log "linked $rel/node_modules -> $reltarget"
  elif [ -d "$target" ]; then
    # main tree but somehow missing: shouldn't happen, install anyway
    npm --prefix "$rel" ci
    log "installed $rel/node_modules via npm ci"
  else
    log "main tree lacks $rel/node_modules; running npm ci"
    if [ "$rel" = "." ]; then npm ci; else npm --prefix "$rel" ci; fi
    log "installed $rel/node_modules via npm ci"
  fi
}

ensure_dist() {
  if [ -f "$WT_ROOT/client/dist/index.html" ]; then
    log "skip: client/dist already built"
    return 0
  fi
  if [ "$MODE" = check ]; then
    MISSING+=("client/dist/index.html missing -> run: bash scripts/wt-prep.sh (or: npm --prefix client run build)")
    return 0
  fi
  log "building client/dist (npm --prefix client run build)"
  npm --prefix client run build
}

ensure_deps "." "root"
ensure_deps "scripts/e2e" "e2e"

# client deps are needed to build dist
if [ ! -f "$WT_ROOT/client/dist/index.html" ]; then
  ensure_deps "client" "client"
fi
ensure_dist

if [ "$MODE" = check ]; then
  if [ "${#MISSING[@]}" -gt 0 ]; then
    for m in "${MISSING[@]}"; do log "MISSING: $m"; done
    log "not ready; fix with: bash scripts/wt-prep.sh"
    exit 1
  fi
  log "WT-PREP CHECK OK"
else
  log "WT-PREP OK"
fi
