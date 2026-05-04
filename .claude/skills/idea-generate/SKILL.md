---
name: idea-generate
description: Portfolio-scoped idea generator. Reads a user's holdings + watchlist + sector mix, identifies gaps versus benchmark/style, and emits candidate stocks with thesis, ratios, entry zones, conviction/risk, and matching codex rules. Writes a single timestamped JSON consumed by the app's Candidates tab.
triggers:
  - "/idea-generate <portfolioId>"
  - "generate ideas for portfolio <portfolioId>"
  - "find candidates for <portfolioId>"
inputs:
  portfolioId: "string — required. The portfolio's UUID. Used to scope reads (holdings, watchlist, sectors) and to write outputs under data/research/_portfolio/<portfolioId>/idea-generate/."
  benchmark: "string (default 'NIFTY500') — universe of comparison."
  max_candidates: "integer (default 12) — upper bound on the candidates emitted per run."
  refresh: "boolean (default false) — when true, re-run heuristics even if a recent run exists for today."
outputs:
  - data/research/_portfolio/<portfolioId>/idea-generate/<run-id>.json
---

# idea-generate

Surface concrete buy candidates that fill structural gaps in a portfolio. The Next.js app does NOT call any LLM; this skill is the only place where reasoning happens. The output is a strictly-validated JSON file that the app reads via `lib/db/queries/candidates.ts#importCandidatesFromFiles`.

## Output schema

The JSON MUST conform to `IdeaGenerateFile` in `lib/validation/ideaGenerate.ts` (mirrors `.claude/rules/research-output-schema.md#idea-generate`):

```jsonc
{
  "portfolio_id": "<portfolioId>",
  "run_at": "<ISO-8601 timestamp>",
  "gaps_identified": ["FMCG <1% weight", "no large-cap private bank ex-HDFC"],
  "candidates": [
    {
      "symbol": "HINDUNILVR",
      "name": "Hindustan Unilever",
      "thesis_md": "FMCG compounder with rural revival tailwind...",
      "key_ratios": { "pe": 52, "roce": 0.78, "div_yield": 0.018 },
      "entry_zones": { "fair": 2400, "strong_buy": 2150 },
      "conviction": "high",      // high|medium|low
      "risk": "low",             // low|medium|high
      "matching_codex_rules": ["rule.fmcg.rural-revival-buy"]
    }
  ]
}
```

## Procedure

1. **Load portfolio context** from `data/app.db` (read-only):
   - Holdings (`lib/db/queries/holdings.ts#getHoldings`)
   - Watchlist (`lib/db/queries/watchlist.ts#listWatchlist`)
   - Sector exposure (`lib/db/queries/sectors`)
   - User style profile (`user_style_profile` rows)
2. **Identify gaps** with the following heuristics (record each in `gaps_identified`):
   - Sector weights deviating from benchmark by more than ±3 percentage points.
   - Missing market-cap buckets (e.g., no large-cap exposure in a sector you own mid-caps in).
   - High concentration risk (single position > 15%).
   - Style-profile mismatch (e.g., user has high "quality" weight but holds 0 quality compounders).
   - Watchlist items with stale theses (>6 months old) flagged for re-review.
3. **Source candidates** from:
   - `data/codex/synthesized/v{n}.json` Rule Library — pick rules whose `action == "fresh_buy"` and whose `conditions` are satisfiable by `NIFTY500` constituents not currently held.
   - Watchlist entries already on file (promote with refreshed thesis).
   - Stalwart profiles (`data/investor_stalwarts/<slug>.md`) for case-study cross-reference.
4. **Score and rank** candidates:
   - `conviction = high` only when ≥2 codex rules converge AND no counterexample fires.
   - `risk = low` only when ROCE_5y > 15%, debt/equity < 0.3, and revenue CAGR_5y > 10%.
   - Cap output at `max_candidates`.
5. **Compute entry zones** (best-effort, optional):
   - `fair` = current consensus FY+1 EPS × historic 10-yr median P/E.
   - `strong_buy` = `fair × 0.9` (10% margin of safety).
   - Omit either field if data is unavailable; do not fabricate.
6. **Emit citations** in `matching_codex_rules` — list the `rule.*` ids from the latest synthesized version. App resolves these to investor quotes at render time.
7. **Write the file** to `data/research/_portfolio/<portfolioId>/idea-generate/<run-id>.json` where `run-id = YYYY-MM-DDThhmm` (UTC). Don't overwrite older runs — every invocation produces a new run-id.
8. **Idempotency**: if a run-id already exists and `refresh: false`, skip. The app's importer is idempotent on `(portfolioId, runId, symbol)`, so re-importing the same file is harmless.

## Constraints

- Never write outside `data/research/_portfolio/<portfolioId>/idea-generate/`.
- Never call external LLM APIs. Reasoning happens here, in this Claude Code session.
- All `symbol` fields MUST match `^[A-Z0-9][A-Z0-9._-]{0,31}$` (NSE-style ticker). Non-conforming symbols get rejected by the app's Zod validator.
- `candidates` array MUST be non-empty; if no genuine ideas exist, emit a single low-conviction "stay-cash" placeholder explaining why no fresh buys are warranted, OR skip writing the file entirely.
- `key_ratios`: numeric values only. Percentages are expressed as decimals (e.g., `0.78` for 78%). Use the same convention the rest of the app uses.
- Privacy: never embed broker client IDs or trade timestamps in the output. Only public ratios + thesis text.

## Example invocations

```
/idea-generate 7e1c-portfolio-uuid
/idea-generate 7e1c-portfolio-uuid --benchmark=NIFTY100
/idea-generate 7e1c-portfolio-uuid --refresh
```

## Rendering in the app

`app/(app)/p/[portfolioId]/candidates/page.tsx` (server component) reads via `listCandidates(db, portfolioId)`. The "Re-import from files" button hits `POST /api/p/[portfolioId]/candidates/import` which re-runs `importCandidatesFromFiles`. Each candidate has a "Promote to watchlist" button that copies thesis + entry zones + conviction onto a `watchlist` row.
