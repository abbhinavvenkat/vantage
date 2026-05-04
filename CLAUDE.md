# Vantage — Project Instructions for Claude

Local-only Next.js dashboard for portfolio monitoring, research, and rule-based buy/sell scoring.

## Environment

**This project uses a dedicated conda env named `stock-platform` (Node 20 + npm).** Activate before any tooling:

```bash
conda activate stock-platform
```

Verify: `node --version` should print `v20.x`, `npm --version` ≥ 10.

If a fresh shell isn't conda-activated, prefix commands with:
```bash
source /opt/miniconda3/etc/profile.d/conda.sh && conda activate stock-platform && <cmd>
```

## Repo layout
- `app/` — Next.js 15 App Router (RSC by default)
- `lib/` — parsers, analytics, db, auth, pricing, codex, llm
- `.claude/skills/` — Claude Code skills that produce JSON the app reads (no API keys, ever)
- `.claude/rules/` — invariants the codebase + skills must respect
- `data/` — **gitignored**, all PII + bulk fetched artifacts live here (`tradebooks/`, `app.db`, `sources/`, `research/`, `codex/`)
- `data/sample/` — synthetic fixtures, committed
- `data/investor_stalwarts/` — **committed** curated investor profile MDs (one per investor) used for future webpages and to inform analysis of the user's stock calls; updated by the `stalwart-profile-update` skill
- `tests/` — `unit/`, `integration/`, `e2e/`

## Env file
The Claude hook in this machine protects `.env*` paths from being written by the assistant. The committed template lives at `env.example` (no leading dot). Copy to `.env.local` manually:
```bash
cp env.example .env.local
# then edit values
```

## Commands

```bash
npm install
npm run dev              # localhost:3000
npm run build
npm run test             # vitest unit + integration
npm run test:e2e         # playwright
npm run db:migrate       # drizzle migrations
npm run db:studio        # drizzle studio
npm run seed:sample      # load synthetic tradebook
```

Daily cron: see docs/daily-refresh.md

## Privacy rules (non-negotiable)
1. **Nothing in `data/` is ever committed.** Pre-commit hook scans for ISIN-like + client-ID-like patterns.
2. Broker client IDs (`UL\d{4}`, `CDSL` numbers, etc.) stripped at parse time — never persisted to DB or logs.
3. `accounts.alias` is user-chosen — no client IDs in DB.
4. `.env.example` ships placeholders only; `.env.local` is gitignored.
5. App logs never include `(symbol, qty, price)` triples outside debug mode.
6. Test fixtures use synthetic symbols (`ACME-EQ`) and amounts.

## TDD discipline (enforced)
1. Write tests first.
2. Run them; confirm they fail for the right reason.
3. Implement minimally to pass.
4. Run tests again; if any fail, fix the implementation, not the test.

Applies to parsers, analytics (FIFO, XIRR, intraday detection), auth flows, and route handlers.

## Architecture invariants
- **Server Components by default**; `'use client'` only when interactive.
- **Zod at every boundary** — API request bodies, parser outputs, skill outputs.
- **Auth-gated server actions** via `next-safe-action`: `authedAction` (session) and `portfolioAction` (session + portfolio scope).
- **All DB writes go through `lib/db/queries/`** — no inline SQL in routes.
- **Parsers expose `{detect, parse}`**; auto-detect by header sniff, never by filename.
- **Idempotent ingest**: `(account_id, trade_id)` unique; fallback dedupe on `(symbol, exec_time, qty, price, side)`.
- **Delivery-only holdings**: `intradayDetect` pairs same-day buy/sell offsets and excludes them from holdings.
- **Currency-aware from day 1** even though INR-only in v1 (IndMoney/USD comes in Phase 6 as additive).
- **Multi-portfolio**: every personal table has `portfolio_id`; routes scoped under `/p/[portfolioId]/`. Strict one-portfolio-at-a-time view.

## LLM contract — no API keys
- The Next.js app **never** calls an LLM.
- All research is done by **Claude Code skills** in `.claude/skills/*` invoked from this CLI.
- Skills write JSON to `data/research/<symbol>/<skill>/*.json` or `data/codex/...` matching schemas in `.claude/rules/research-output-schema.md` and `.claude/rules/codex-rule-schema.md`.
- App reads via filesystem watcher (`chokidar`) → upserts into `research_runs` / `codex_*`.
- **No PDF uploads**: `company-research-fetch` auto-discovers AR/concall/filings from BSE → IR site → Screener → NSE.

## Investor Codex (parallel research track)
- Roster + sourcing in `.claude/rules/codex-investors.yml`.
- Pipeline: `codex-fetch` → `codex-extract` → `codex-distill` → `codex-synthesize` → `codex-backtest`.
- `codex-discover` runs after Shankar Nath / educator transcripts to auto-queue newly-mentioned investors.
- Versioned rule library at `data/codex/synthesized/v{n}.json`. Decisions in app cite back to original investor quotes.

## Things NOT to do (per global CLAUDE.md)
- Don't summarise the diff at the end of responses.
- Don't add docstrings/comments/types to code you didn't change.
- Don't mock the DB in integration tests — use a tmp SQLite file.
- Don't propose changes to code you haven't read.
- Don't add features not asked for.

