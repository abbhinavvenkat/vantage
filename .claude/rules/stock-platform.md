# stock-platform — repository invariants

These rules are non-negotiable. Violating them is a regression even if tests pass.

## Privacy
1. Never commit anything in `data/` except the explicit allowlist: `data/sample/` (synthetic fixtures) and `data/investor_stalwarts/` (curated public-investor profiles).
2. Strip broker client IDs (`UL\d{4}`, `CDSL` numbers, depository account numbers) at parse time. They never reach the DB or logs.
3. `accounts.alias` is user-chosen — no client IDs in DB, no client IDs in logs.
4. App logs never include `(symbol, qty, price)` triples outside debug mode (`DEBUG_LOG_TRADES=true`).
5. The `.env*` files are gitignored; only `env.example` (no leading dot) is committed as the template.
6. Test fixtures use synthetic symbols (e.g., `ACME-EQ`) and amounts.
7. Pre-commit hook scans staged diff for ISIN-like, client-ID-like, and key-like patterns.

## LLM contract
1. The Next.js app NEVER calls an LLM. No `@anthropic-ai/sdk`, no `openai`, no API keys.
2. All research is done by Claude Code skills under `.claude/skills/*` invoked from this CLI.
3. Skills write JSON to `data/research/<symbol>/<skill>/*.json` or `data/codex/...` matching the Zod schemas in `.claude/rules/research-output-schema.md` and `.claude/rules/codex-rule-schema.md`.
4. App reads skill outputs via filesystem watcher (`chokidar`) → upserts into `research_runs` / `codex_*` tables.
5. Skills MUST be idempotent on `(symbol, input_hash)` and never overwrite human-edited stalwart profiles between `<!-- HUMAN-EDITED:START -->` / `<!-- HUMAN-EDITED:END -->` markers.

## Parsers
1. Every broker parser exports `{ code, detect(file), parse(file): NormalizedTrade[] }`.
2. Auto-detect by header sniff, never by filename.
3. Idempotent ingest: `(account_id, trade_id)` unique, fallback dedupe on `(symbol, exec_time, qty, price, side)`.
4. Currency-aware from day 1 even though INR-only ships in v1.
5. Intraday detection: same-day buy/sell offsets paired and excluded from holdings; available in raw trades view.

## Architecture
1. Server Components by default; `'use client'` only when interactive.
2. Zod at every boundary — request bodies, parser outputs, skill outputs.
3. Auth-gated server actions via `next-safe-action`: `authedAction` (session) + `portfolioAction` (session + portfolio scope).
4. All DB writes go through `lib/db/queries/`; no inline SQL in routes.
5. Multi-portfolio: every personal table has `portfolio_id`; routes scoped under `/p/[portfolioId]/`. Strict one-portfolio-at-a-time view.
6. SQLite WAL mode + busy_timeout set to handle concurrent access from the app and scripts.

## TDD
1. Write tests first.
2. Run them; confirm they fail for the right reason (feature doesn't exist yet).
3. Implement minimally to pass.
4. Run tests again; if any fail, fix the implementation, not the test.

## Data directory layout
```
data/
  app.db                            gitignored
  test.db                           gitignored
  tradebooks/                       gitignored — raw user uploads
  prices/                           gitignored — EOD cache
  sources/<symbol>/                 gitignored — fetched filings/AR/transcripts
  research/<symbol>/<skill>/        gitignored — JSON skill outputs
  codex/
    raw/<investor>/                 gitignored — fetched investor letters/blogs/YT
    extracted/<investor>/           gitignored — markdown + anchors
    distilled/<investor>.json       gitignored — structured per-investor JSON
    synthesized/v{n}.json           gitignored — Rule Library
    backtests/v{n}/                 gitignored — per-rule backtest results
    trade-replays/<investor>.json   gitignored — public-trade replays
    discovery/<educator>.json       gitignored — discovered investor mentions
  investor_stalwarts/<slug>.md      ✅ COMMITTED — curated profiles
  sample/                           ✅ COMMITTED — synthetic fixtures
```
