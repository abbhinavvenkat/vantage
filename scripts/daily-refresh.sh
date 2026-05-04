#!/usr/bin/env bash
# Daily refresh wrapper — invoked by launchd. See scripts/launchd/*.
# - Activates the dedicated `stock-platform` conda env via PATH.
# - Runs `npx tsx scripts/daily-refresh.ts` from the project root.
# - Captures stdout + stderr to data/logs/daily-refresh-YYYY-MM-DD.log.
set -u

# Pin tooling to the conda env (no `conda activate` available in launchd shell).
export PATH="/opt/miniconda3/envs/stock-platform/bin:$PATH"

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$PROJECT_ROOT/data/logs"
TODAY="$(date +%Y-%m-%d)"
LOG_FILE="$LOG_DIR/daily-refresh-$TODAY.log"

mkdir -p "$LOG_DIR"

cd "$PROJECT_ROOT" || {
  echo "[daily-refresh.sh] cd $PROJECT_ROOT failed" >>"$LOG_FILE"
  exit 1
}

{
  echo "──────────────────────────────────────────────────────────────"
  echo "[daily-refresh.sh] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "[daily-refresh.sh] PATH=$PATH"
  echo "[daily-refresh.sh] node=$(node --version 2>&1) npx=$(npx --version 2>&1)"
} >>"$LOG_FILE" 2>&1

npx tsx scripts/daily-refresh.ts >>"$LOG_FILE" 2>&1
EXIT_CODE=$?

echo "[daily-refresh.sh] exit $EXIT_CODE $(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$LOG_FILE"
exit $EXIT_CODE
