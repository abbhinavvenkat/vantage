#!/usr/bin/env bash
# Install the daily-refresh launchd agent into the user's LaunchAgents dir.
# Usage: bash scripts/launchd/install.sh
set -eu

LABEL="com.stockplatform.daily-refresh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_PLIST="$SCRIPT_DIR/${LABEL}.plist"
TARGET_DIR="$HOME/Library/LaunchAgents"
TARGET_PLIST="$TARGET_DIR/${LABEL}.plist"
LOG_DIR="$PROJECT_ROOT/data/logs"

if [ ! -f "$SOURCE_PLIST" ]; then
  echo "[install] source plist not found: $SOURCE_PLIST" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR" "$LOG_DIR"

# Substitute the real project root into the plist before installing.
sed "s|VANTAGE_PROJECT_ROOT|$PROJECT_ROOT|g" "$SOURCE_PLIST" > "$TARGET_PLIST"
echo "[install] installed $TARGET_PLIST (project root: $PROJECT_ROOT)"

if launchctl list | grep -q "${LABEL}\$"; then
  echo "[install] ${LABEL} already loaded — reloading"
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
fi

launchctl load "$TARGET_PLIST"
echo "[install] launchctl load OK"

echo ""
echo "  Label:        $LABEL"
echo "  Schedule:     daily at 18:30 local time (Asia/Kolkata)"
echo "  Wrapper:      $PROJECT_ROOT/scripts/daily-refresh.sh"
echo "  Log dir:      $LOG_DIR"
echo "  Daily log:    $LOG_DIR/daily-refresh-\$(date +%Y-%m-%d).log"
echo "  launchd out:  $LOG_DIR/launchd.out.log"
echo "  launchd err:  $LOG_DIR/launchd.err.log"
echo ""
echo "  Verify:       launchctl list | grep $LABEL"
echo "  Uninstall:    bash scripts/launchd/uninstall.sh"
