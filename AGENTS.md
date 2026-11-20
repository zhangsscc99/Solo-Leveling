# AGENTS

## Fresh git worktree? Run `bash scripts/wt-prep.sh` first

`node_modules/`, `client/node_modules/`, `scripts/e2e/node_modules/`, and
`client/dist/` are gitignored, so a new worktree has none of them. Any
Playwright E2E will fail on first run with `ENOENT … client/dist/index.html`.

`scripts/wt-prep.sh` fixes that in one shot:

- locates the main tree via `git rev-parse --git-common-dir`, then creates
  **relative symlinks** for `node_modules`, `scripts/e2e/node_modules`, and
  `client/node_modules` pointing at the main tree (runs `npm ci` instead when
  the main tree doesn't have them either; skipped entirely inside the main
  tree)
- runs `npm --prefix client run build` when `client/dist/index.html` is
  missing (dist is always built, never symlinked — the main tree's build may
  not match this branch's sources)
- is idempotent — re-running prints `skip` for everything and still exits 0

```bash
bash scripts/wt-prep.sh          # prepare; prints WT-PREP OK
bash scripts/wt-prep.sh --check  # verify only, change nothing; exits non-zero
                                 # and lists exactly what's missing + the fix
```

Use `--check` to assert a worktree is ready before running E2E, e.g. in CI
or at the start of an agent session.
