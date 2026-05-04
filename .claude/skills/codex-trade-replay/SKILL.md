---
name: codex-trade-replay
description: For investors with disclosed trades (Berkshire 13F, Indian DII/promoter disclosures), reconstruct entry/exit and tag which codex rules would have fired pre-trade.
triggers:
  - "/codex-trade-replay <slug>"
inputs:
  investor_slug: "string"
  source: "13f | bse-bulk-deals | nse-bulk-deals (auto-detected from investor)"
outputs:
  - data/codex/trade-replays/<slug>.json
---

# codex-trade-replay

Validates the rule library by replaying real disclosed trades and checking which codex rules would have suggested the same action.

## Procedure

1. Determine source by investor:
   - Buffett/Pershing/Greenlight → SEC EDGAR 13F filings.
   - Indian fund managers → AMFI scheme portfolio disclosures (monthly).
   - Indian promoters/HNI → BSE/NSE bulk deal data.
2. For each disclosed trade:
   - Reconstruct (symbol, side, qty, date, est_avg_price).
   - Compute the pre-trade snapshot: price, fundamentals (where available), narrative tags.
   - Run the latest Rule Library against this snapshot.
   - Record which rules fired and what action they recommended.
   - Compute `agreement_score` = (rules agreeing with disclosed action) / (rules firing).
3. Output per `.claude/rules/codex-rule-schema.md` shape.
4. Aggregate metrics: avg agreement_score per rule across this investor's trades.

## Use

This is a **validation loop for the codex itself** — not a backtest of returns. Rules that consistently disagree with celebrated investors' disclosed actions deserve scrutiny (either the rule is wrong, or the rule needs more nuance, or the investor was wrong).

## Limitations

- 13F is delayed 45 days; only quarterly snapshots, not transaction prices.
- AMFI portfolios are month-end snapshots.
- Bulk deals only show >0.5% of equity — biased toward visible trades.
