#!/usr/bin/env bash
# Run the Playwright e2e suite in a loop until something fails, or until
# we hit a configurable streak of clean passes. Each iteration runs with
# `--retries=0 --max-failures=1` so a flake stops the loop immediately
# and the failing iteration's log is preserved for inspection.
#
# Usage:
#   scripts/e2e-loop.sh                # loop until first failure or TARGET passes
#   TARGET=0 scripts/e2e-loop.sh       # loop forever until first failure
#   TARGET=50 scripts/e2e-loop.sh      # stop after 50 clean passes
#
# Env:
#   TARGET                  number of consecutive passes to declare success; 0 = unlimited (default 30)
#   PLAYWRIGHT_BASE_URL     base URL to hit /healthz against (default http://localhost:3000)
#   LOG_DIR                 where per-iteration logs go (default report/e2e-loop/<timestamp>)
#
# Exit codes:
#   0  reached TARGET passes
#   1+ playwright failed on some iteration; that iteration's exit code is propagated
#   2  pre-flight failed (stack not up)

set -euo pipefail

TARGET="${TARGET:-30}"
BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3000}"
LOG_DIR="${LOG_DIR:-report/e2e-loop/$(date +%Y%m%d-%H%M%S)}"

mkdir -p "$LOG_DIR"

echo "[e2e-loop] log dir : $LOG_DIR"
echo "[e2e-loop] target  : $TARGET (0 = unlimited)"
echo "[e2e-loop] base URL: $BASE_URL"

if ! curl -sf -o /dev/null "$BASE_URL/healthz"; then
  echo "[e2e-loop] /healthz not 2xx at $BASE_URL — bring the stack up first (e.g. 'make up')" >&2
  exit 2
fi

iter=0
start_ts=$(date +%s)
while :; do
  iter=$((iter + 1))
  log="$LOG_DIR/iter-$(printf '%03d' "$iter").log"
  echo "[e2e-loop] === iteration $iter — log: $log ==="
  iter_start=$(date +%s)
  if pnpm exec playwright test --config=playwright.config.ts --retries=0 --max-failures=1 >"$log" 2>&1; then
    iter_end=$(date +%s)
    echo "[e2e-loop] iter $iter PASSED in $((iter_end - iter_start))s"
  else
    rc=$?
    iter_end=$(date +%s)
    echo "[e2e-loop] iter $iter FAILED (exit $rc) in $((iter_end - iter_start))s"
    echo "[e2e-loop] --- last 80 lines of $log ---"
    tail -n 80 "$log" || true
    echo "[e2e-loop] --- end tail ---"
    exit "$rc"
  fi

  if [ "$TARGET" -gt 0 ] && [ "$iter" -ge "$TARGET" ]; then
    elapsed=$(($(date +%s) - start_ts))
    echo "[e2e-loop] reached target $TARGET consecutive passes in ${elapsed}s — success"
    exit 0
  fi
done
