---
name: codex-backtest
description: Replay a Rule Library version against historical data (user tradebook + Nifty 500) and emit per-rule hit-rate and forward-return metrics.
triggers:
  - "/codex-backtest <version>"
inputs:
  version: "string — semver of rule library to test"
  universe: "user_tradebook | nifty500 | both (default both)"
  forward_window_days: "number — days to compute forward return (default 365)"
outputs:
  - data/codex/backtests/v{version}/<rule-id>.json
  - data/codex/backtests/v{version}/_summary.json
---

# codex-backtest

Empirically test each rule by replaying it against historical data.

## Procedure

1. Load `data/codex/synthesized/v{version}.json`.
2. Connect to SQLite at `data/app.db` for `prices_eod`, `corporate_actions`, `trades`, `instruments`.
3. For each rule:
   - Determine the eligible universe (user_tradebook = symbols user ever held; nifty500 = current + historical Nifty 500 constituents).
   - For each (symbol, date) point, evaluate `rule.conditions` using point-in-time data ONLY (no look-ahead).
   - On a positive match, record the signal.
   - Forward return = `(close[t+forward_window] / close[t]) - 1`, dividend-adjusted. If forward window not yet elapsed, mark `n_with_outcome` lower.
4. Compute metrics per `.claude/rules/codex-rule-schema.md` §5.
5. Write per-rule files + a `_summary.json` ranking rules by `(hit_rate × n_signals)`.

## Data limitations

- Point-in-time fundamentals (P/E, ROCE, growth rates) often unavailable historically. For rules requiring fundamentals:
  - If only current snapshot available, run forward-only backtest from today.
  - Mark `n_signals` accordingly and add `notes_md` flagging the limitation.
- Survivorship bias: `nifty500` membership changes over time. Use the point-in-time index composition where available; otherwise note `survivorship_bias: true`.

## Output use

`codex-synthesize` reads the latest backtest summary on next run and applies a multiplier to `weight`:
- `hit_rate < 0.5 AND n_signals ≥ 20` → weight × 0 (effectively dropped)
- `hit_rate ≥ 0.65` → weight × 1.2
- `n_signals < 5` → weight unchanged (insufficient evidence)
