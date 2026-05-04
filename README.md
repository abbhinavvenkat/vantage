# Vantage — Personalized Equity Growth Platform for 20+% XIRR

**Local-first portfolio intelligence for long-term Indian equity investors.**

A local-first dashboard that ingests your broker tradebooks, tracks FIFO holdings and realized P&L, surfaces sector and risk analytics, and scores every holding against a curated library of rules distilled from 63 legendary investors — giving you a personalized buy / hold / trim / exit recommendation for each position.

---

> **⚠️ DISCLAIMER**
>
> Vantage is a **personal portfolio maintenance tool** built for private, non-commercial use. It is **not** investment advice.
>
> - The author is **not registered with SEBI** (Securities and Exchange Board of India) or any other regulatory body as an investment adviser, research analyst, or broker.
> - Nothing in this software constitutes a solicitation, recommendation, endorsement, or offer to buy or sell any security.
> - All scores, recommendations, and framework outputs are **algorithmic, rules-based, and backward-looking** — they carry no predictive guarantee.
> - **Past performance of any strategy or rule is not indicative of future results.**
> - You are solely responsible for your own investment decisions. Always consult a qualified, SEBI-registered investment adviser before acting on any information.
> - This tool is provided **as-is, with no warranty** of any kind, express or implied.
>
> See [`DISCLAIMER.md`](DISCLAIMER.md) for the full legal notice.

---

## Why Vantage

| Principle | What it means |
|---|---|
| **Local-first** | Your tradebook, holdings, and research never leave your machine. No cloud sync, no third-party database. |
| **No LLM calls from the app** | The Next.js dashboard never touches an API key. All AI-powered research is done offline via [Claude Code skills](#claude-code-skills). |
| **Built for long-horizon investors** | FIFO P&L, XIRR vs benchmarks, LTCL/STCL harvesting, compounder scoring — not tick-by-tick trading. |
| **Investor-framework-native** | Recommendations are grounded in the published frameworks of Buffett, Munger, Lynch, Agrawal and 59 others — not black-box ML. |

---

## Features

### Holdings & Benchmark Comparison
Upload Zerodha / Groww / IndMoney tradebooks (CSV or XLSX). Vantage parses them idempotently, detects intraday pairs, and computes FIFO open positions. The holdings page shows invested cost, market value, unrealized P&L, and a money-weighted XIRR curve vs Nifty 50, Nifty 500, BSE 500, and popular flexicap funds — so you can see at a glance whether your stock-picking is adding value.

### Analytics
Four sub-views under a single tab:

- **Realized P&L** — every closed lot with FIFO cost, proceeds, gain/loss, holding period, and short/long-term classification.
- **Sectors** — allocation bar, HHI concentration index, and a drilldown showing each sector's market value and individual holdings.
- **Risk** — portfolio-level risk metrics and sector-vs-index comparisons.
- **Cohorts** — group holdings by holding period, return bucket, or conviction level.

### Research Hub
One consolidated page with six sections:

| Section | What it does |
|---|---|
| **Theses** | Write and track your investment thesis for each holding. |
| **Watchlist** | Track symbols you don't hold yet — with target buy/sell prices, conviction level, and a one-line thesis. Price alerts fire when the CMP crosses your target. |
| **News** | Fetched by the `news-fetch` skill; mark items read, filter by symbol or sector. |
| **Filings** | BSE/NSE filings triage — rated read-now / skim / ignore by the `company-research-fetch` skill. |
| **Events** | Calendar of analyst days, AGMs, earnings dates, and custom reminders. |
| **Alerts** | Rule-based price alerts (% drop from 52-week high, absolute price thresholds, volume spikes). Bell badge in the header shows unacknowledged count. |

### Recommendations
Every holding and watchlist symbol is scored against the **Stalwarts Wisdom Codex** — a versioned rule library distilled from 63 investor frameworks. The table shows:

- **Final action** — synthesized across all frameworks: Add More / Enter / Retain / Pass / Sell Partial / Sell Full
- **Stalwarts score** — raw rule-library score with the top firing rules
- **Compounder classification** — Solid / 7-9x / Mediocre / Broken, with estimated 10-year return
- **CAGR fit** — whether the position is on track for the portfolio's target CAGR
- **Thesis verdict** — Intact / Watch / Weakened / Broken, from the last stress-test run
- **Growth forecast** — 1Y / 3Y / 5Y earnings growth projections
- **Position size** — current weight vs portfolio

### Actions
Four tools under one tab:

- **Rebalance** — set target weights by symbol or sector; get a suggested buy/sell trade list at current prices.
- **Tax Harvest** — FIFO-derived lots currently in loss, classified as LTCL (≥365 days) or STCL, sorted by largest loss. Includes a re-buy window reminder for Indian settlement rules.
- **Candidates** — idea-generator outputs from the `idea-generate` skill: thesis, key ratios, entry zones, matching Codex rules. One-click promote to watchlist.
- **Style Mixer** — slider for each investor in the rule library. Drag Buffett up, drag Graham down; the multiplier shifts which rules dominate your Recommendations score. Auto-weight by each investor's backtested XIRR is one click away.

### Stalwarts Wisdom Codex
A living knowledge base synthesized from public writings, interviews, letters, and talks of 63 master investors. Organized into:
- **Convergent Core** — principles agreed upon by 10+ investors across schools and eras
- **Strong Consensus** — 5-9 investor agreement
- **School Splits** — where value, GARP, quality, and contrarian schools diverge
- **India-Specific Consensus** — frameworks specifically applicable to Indian equities
- **Universal Buy/Sell signals** and **Red Flags**

---

## How the Recommendation Framework Works

```
Investor writings (public)
        │
        ▼
  codex-fetch / codex-extract          Raw text → structured markdown
        │
        ▼
  codex-distill                        Per-investor JSON: principles, triggers, red flags, case studies
        │
        ▼
  codex-synthesize                     Merge 63 investors → versioned Rule Library (data/codex/synthesized/vN.json)
        │                              Each rule: action, conditions, supporting investors, weight, evidence strength
        ▼
  codex-backtest                       4-cycle Indian-equity backtest; rules with hit rate < 50% → weight = 0
        │
        ▼
  Scoring engine (lib/decisions/)
        │  For each symbol:
        │  1. Load fundamentals + price data
        │  2. Evaluate each rule's conditions
        │  3. Multiply rule weight × investor style weight (from Style Mixer)
        │  4. Aggregate per-action scores → Stalwarts recommendation
        │
        ▼
  Synthesis (lib/synthesis/finalRecommendation.ts)
        │  Cross-checks:
        │  · Compounder profile (ROCE, FCF, moat)
        │  · CAGR planner fit
        │  · Thesis stress-test verdict
        │  · Position size & concentration risk overrides
        │
        ▼
  Final action displayed in Recommendations tab
```

**Conflicting rules are retained, not de-duped.** When Graham says sell and Lynch says hold, both rules fire — their weighted scores compete, and the net determines the final call. You can see every firing rule in the drill-down panel.

**Style Mixer weighting** is a per-user multiplier stored in the database. It never modifies the rule library itself — the same Codex serves all portfolios, but each portfolio owner can tune whose voice carries more weight.

---

## Quick Start

### Prerequisites
- Node.js 20+ and npm 10+
- (Recommended) [Conda](https://docs.conda.io/) with the `stock-platform` environment

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/vantage.git
cd vantage

# Install dependencies
npm install

# Copy env template and fill in values
cp env.example .env.local

# Run database migrations (creates data/app.db)
npm run db:migrate

# (Optional) Load synthetic sample data to explore the UI
npm run seed:sample

# Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). On first run you'll be prompted to create a password. Then create a portfolio and upload a Zerodha / Groww tradebook.

### Uploading a Tradebook
Go to **Holdings → Upload Tradebook** and drop a Zerodha EQ CSV, Groww trades CSV, or IndMoney XLSX. The parser auto-detects the broker by header sniff. Re-uploading the same file is safe — ingest is idempotent on `(account, trade_id)`.

---

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server on localhost:3000 |
| `npm run build` | Production build |
| `npm run test` | Vitest unit + integration suite |
| `npm run test:e2e` | Playwright end-to-end tests |
| `npm run db:migrate` | Apply Drizzle migrations to data/app.db |
| `npm run db:studio` | Open Drizzle Studio (visual DB browser) |
| `npm run seed:sample` | Load synthetic fixture portfolio |

---

## Project Structure

```
vantage/
├── app/                        # Next.js 15 App Router
│   ├── (app)/                  # Authenticated shell
│   │   ├── p/[portfolioId]/    # Per-portfolio pages
│   │   │   ├── holdings/       # Holdings + benchmark chart
│   │   │   ├── analytics/      # Realized P&L, Sectors, Risk, Cohorts, Compare
│   │   │   ├── research/       # Theses, Watchlist, News, Filings, Events, Alerts
│   │   │   ├── actions/        # Rebalance, Tax Harvest, Candidates, Style Mixer
│   │   │   └── recommendations/# Stalwarts scoring table
│   │   └── codex/              # Stalwarts Wisdom Codex reader
│   ├── (auth)/                 # Login / setup
│   └── api/                    # Route handlers (auth, ingest, prices, actions)
├── lib/                        # Pure business logic
│   ├── analytics/              # FIFO, XIRR, tax harvest, rebalance, cohorts
│   ├── auth/                   # Session, password hashing, rate limiting
│   ├── codex/                  # Rule library loader
│   ├── decisions/              # Scoring engine, growth forecasts
│   ├── synthesis/              # Final recommendation synthesizer
│   ├── compounder/             # Compounder profile scorer
│   ├── cagr/                   # Target CAGR planner
│   ├── db/                     # Drizzle schema + query functions
│   ├── parsers/                # Zerodha / Groww / IndMoney parsers
│   └── pricing/                # Yahoo Finance EOD price fetcher
├── components/ui/              # Design system (Button, Card, Badge, Icons…)
├── .claude/
│   ├── skills/                 # Claude Code skills (LLM research pipeline)
│   └── rules/                  # Codex schemas, invariants
├── data/                       # ⚠️ gitignored — all personal data lives here
│   ├── sample/                 # ✅ committed — synthetic fixture
│   └── investor_stalwarts/     # ✅ committed — curated investor profiles
├── drizzle/                    # SQL migration files
└── tests/                      # Unit, integration, E2E
```

---

## Claude Code Skills

The Next.js app **never** calls an LLM. All AI-powered research is done by Claude Code skills invoked from the CLI. Each skill reads from `data/` and writes structured JSON that the app picks up via filesystem watcher.

| Skill | What it does |
|---|---|
| `annual-report-summarize` | Summarizes an annual report PDF into business model, revenue mix, risks, key numbers, and checklist results |
| `earnings-call-digest` | Extracts guidance, KPI deltas, analyst question themes, and management tone from a concall transcript |
| `thesis-stress-test` | Checks each thesis assumption against the latest filings and gives an Intact / Watch / Weakened / Broken verdict |
| `management-accountability` | Cross-references consecutive earnings call digests to track guidance delivery and narrative drift |
| `idea-generate` | Scans portfolio gaps and generates ranked buy candidates with thesis, ratios, and entry zones |
| `news-fetch` | Fetches recent news for held symbols and classifies relevance |
| `events-fetch` | Pulls upcoming earnings dates, AGMs, analyst days into the Events calendar |
| `company-research-fetch` | Discovers and downloads annual reports, concall transcripts, and investor presentations from BSE/NSE/IR sites |
| `codex-fetch` / `codex-extract` | Downloads and parses investor letters, interviews, and talks |
| `codex-distill` | Structures per-investor principles, triggers, red flags, and case studies into JSON |
| `codex-synthesize` | Merges all investor JSONs into a versioned Rule Library |
| `codex-backtest` | Backtests each rule against your tradebook history |
| `codex-discover` | Scans educator transcripts for newly mentioned investors to add to the roster |
| `stalwart-profile-update` | Regenerates the human-readable investor profile Markdown, preserving human-edited sections |
| `codex-trade-replay` | Reconstructs public investor trades for backtesting purposes |

Run any skill from the Claude Code CLI inside the project:
```
/annual-report-summarize RELIANCE FY25
/thesis-stress-test BAJFINANCE
/idea-generate <portfolioId>
```

Output schemas are defined in [`.claude/rules/research-output-schema.md`](.claude/rules/research-output-schema.md).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, React Server Components) |
| Language | TypeScript (strict mode) |
| Database | SQLite via [Drizzle ORM](https://orm.drizzle.team/) |
| Styling | Tailwind CSS + CSS custom properties design tokens |
| Validation | [Zod](https://zod.dev/) at every API and skill boundary |
| Auth | Custom session + bcrypt; [next-safe-action](https://next-safe-action.dev/) for server actions |
| Testing | [Vitest](https://vitest.dev/) (unit + integration), [Playwright](https://playwright.dev/) (E2E) |
| Prices | Yahoo Finance EOD (cached in SQLite) |

---

## Privacy & Data

- **Nothing in `data/` is committed to git** — only `data/sample/` (synthetic fixtures) and `data/investor_stalwarts/` (public investor profiles) are tracked.
- Broker client IDs (`UL\d{4}`, CDSL numbers) are stripped at parse time and never reach the database or logs.
- A pre-commit hook scans staged diffs for ISIN-like, client-ID-like, and secret-key-like patterns and blocks the commit if found.
- App logs never include `(symbol, qty, price)` triples outside `DEBUG_LOG_TRADES=true` mode.

---

## Testing

```bash
npm run test        # unit + integration (Vitest)
npm run test:e2e    # E2E flows (Playwright)
```

The project follows strict TDD: tests are written before implementation, integration tests use a real SQLite temp file (no mocks), and E2E tests cover the full upload → holdings → realized → recommendations flow.

---

## Roadmap

- [x] Phase 1 — Zerodha parser, FIFO analytics, holdings UI, auth, prices
- [x] Phase 1 — Stalwarts Codex pipeline + Recommendations engine
- [x] Phase 1 — Research hub, Alerts, Tax harvest, Rebalancer, Style Mixer
- [ ] Phase 2 — Groww CSV parser, CSV export, XIRR vs custom index
- [ ] Phase 3 — Dividend tracking improvements, corporate action automation
- [ ] Phase 4 — Mobile-optimized views
- [ ] Phase 5 — IndMoney / USD portfolio support (additive, currency-aware)

---

## Disclaimer

This project is built for **personal, non-commercial use only**. The author is not a SEBI-registered investment adviser or research analyst. Nothing in this software constitutes investment advice. All algorithmic recommendations are rule-based, backward-looking, and carry no guarantee of future returns. You are solely responsible for your own investment decisions.

See [`DISCLAIMER.md`](DISCLAIMER.md) for the full legal notice.

---

## Acknowledgements

The Stalwarts Wisdom Codex is built on the publicly available writings, interviews, annual letters, and talks of legendary investors including Warren Buffett, Charlie Munger, Howard Marks, Peter Lynch, Raamdeo Agrawal, Saurabh Mukherjea, Mohnish Pabrai, Joel Greenblatt, Benjamin Graham, Aswath Damodaran, and many others. All original works remain the intellectual property of their respective authors.

Built with [Next.js](https://nextjs.org/), [Drizzle ORM](https://orm.drizzle.team/), [Vitest](https://vitest.dev/), [Playwright](https://playwright.dev/), and [Claude Code](https://claude.ai/code).
