#!/usr/bin/env bash
# Uninstall the daily-refresh launchd agent.
set -u

LABEL="com.stockplatform.daily-refresh"
TARGET_PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"

if launchctl list | grep -q "${LABEL}\$"; then
  launchctl unload "$TARGET_PLIST" 2>/dev/null || true
  echo "[uninstall] launchctl unload OK"
else
  echo "[uninstall] ${LABEL} not loaded — nothing to unload"
fi

if [ -f "$TARGET_PLIST" ]; then
  rm "$TARGET_PLIST"
  echo "[uninstall] removed $TARGET_PLIST"
else
  echo "[uninstall] $TARGET_PLIST does not exist"
fi
