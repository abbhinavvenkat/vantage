# Daily refresh (launchd cron)

A local-only macOS launchd agent that runs once per day to refresh the EOD prices for every portfolio's open positions and the trailing-year Nifty 50 series. The job hits Yahoo Finance directly from the script (bypassing the Next.js auth layer), upserts into `prices_eod`, and writes a per-day log under `data/logs/`. No external scheduler — everything is on this Mac.

## Schedule

`18:30` local time (Asia/Kolkata) — about three hours after the NSE 15:30 close, well after the EOD settlement window. Adjust `Hour`/`Minute` in `scripts/launchd/com.stockplatform.daily-refresh.plist` if you want a different slot.

## How to install

```bash
bash scripts/launchd/install.sh
```

The script:
1. Copies `scripts/launchd/com.stockplatform.daily-refresh.plist` to `~/Library/LaunchAgents/`.
2. Calls `launchctl load` on the copied plist.
3. Detects an already-loaded state and prints `already installed` instead of re-loading.
4. Echoes the label, log paths, and next-step verification command.

## How to verify it ran

```bash
# 1. Confirm launchd has it registered
launchctl list | grep com.stockplatform.daily-refresh

# 2. Tail today's log
tail -f data/logs/daily-refresh-$(date +%Y-%m-%d).log

# 3. Sanity-check the latest prices in the DB
sqlite3 data/app.db 'select symbol, date, close from prices_eod order by date desc limit 10;'
```

You can also force an ad-hoc run any time:

```bash
# Via the wrapper (writes to the same log file)
bash scripts/daily-refresh.sh

# Or directly (uses cwd as project root)
npx tsx scripts/daily-refresh.ts
```

The script is idempotent — `prices_eod` is upserted on `(symbol, date)`, so re-running on the same day is safe.

## How to uninstall

```bash
bash scripts/launchd/uninstall.sh
```

Unloads the agent and removes the plist from `~/Library/LaunchAgents/`.

## Logs

| Path | Owner | Contents |
| ---- | ----- | -------- |
| `data/logs/daily-refresh-YYYY-MM-DD.log` | the script | one line per portfolio (`refreshed=N failed=M`), Nifty 50 line, totals |
| `data/logs/launchd.out.log` | launchd | stdout if the wrapper somehow short-circuits before redirecting |
| `data/logs/launchd.err.log` | launchd | stderr from the wrapper invocation itself |

### Log retention

There is no automatic rotation. Daily files stay around forever unless cleaned. Suggested manual cleanup once a quarter:

```bash
find data/logs -name 'daily-refresh-*.log' -mtime +90 -delete
```

If you prefer hands-off rotation, add a separate launchd plist that runs the find above weekly, or wire `newsyslog`/`logrotate` against `data/logs/`.

## Troubleshooting

- **Job didn't fire**: check `launchctl list` shows the label and a recent `LastExitStatus`. If `LastExitStatus` is non-zero, look at `data/logs/launchd.err.log` and the daily log for the matching date.
- **`tsx: command not found`**: the conda env at `/opt/miniconda3/envs/stock-platform/` was renamed or deleted. Update `PATH` in both `scripts/daily-refresh.sh` and the plist's `EnvironmentVariables` entry.
- **Yahoo throttling**: the Yahoo adapter rate-limits to ~1 req/s. With 50+ holdings, expect ~60 s of fetch time. Failures are logged but never crash the run.
- **Mac asleep at 18:30**: launchd will run the job at the next wake. If you want to wake the Mac specifically for this, configure `pmset` `repeat` separately (out of scope here).

This is a local-only utility. Nothing here calls a remote scheduler.
