---
name: company-research-fetch
description: Auto-discover and download a company's annual reports, investor presentations, concall transcripts, and quarterly filings from BSE → IR site → Screener → NSE. No PDF uploads — fetched from canonical sources.
triggers:
  - "/company-research-fetch <symbol>"
  - "fetch BEL annual report"
inputs:
  symbol: "string — NSE symbol (e.g., BEL, HDFCBANK)"
  fy: "optional string — limit to one FY (e.g., FY25)"
outputs:
  - data/sources/<symbol>/manifest.json
  - data/sources/<symbol>/<type>/<file>
---

# company-research-fetch

Discover and download a company's research artifacts from canonical sources. **No user uploads ever**.

## Procedure

1. Resolve company:
   - NSE symbol → BSE scrip code via `https://www.bseindia.com/corporates/List_Scrips.html` (cached).
   - Look up ISIN, IR website (from BSE/NSE corporate info), Screener page (`https://www.screener.in/company/<SYMBOL>/`).
2. Walk source order:
   - **BSE Corporate Filings**: `https://www.bseindia.com/stock-share-price/<...>/corp_filings/...` — list filings; filter by type (`Annual Report`, `Investor Presentation`, `Earnings Call Transcript`, `Quarterly Results`); download PDFs.
   - **IR website**: scrape `/investors/`, `/financials/`, `/reports/` paths; pick up missing artifacts.
   - **Screener announcements**: `https://www.screener.in/api/<id>/announcements/` for completeness.
   - **NSE corporate filings** as fallback.
3. For each artifact:
   - Compute remote sha256 (HEAD + range read) and local sha256 after download; compare.
   - Save to `data/sources/<symbol>/<type>/<fy_or_fq>__<title-slug>.<ext>`.
   - Append to `data/sources/<symbol>/manifest.json` per `.claude/rules/research-output-schema.md` §company-research-fetch.
4. Idempotent on URL hash.

## Invariants

- Do not accept user-supplied PDF paths. Every artifact must come from a canonical source (BSE / IR / NSE / Screener).
- Respect robots.txt; per-host rate limit 1 req/sec.
- Log all 404/403/paywall URLs to `manifest.warnings[]`.

## Use

After this skill completes, downstream skills consume the manifest:
- `/annual-report-summarize <symbol> <fy>` reads the AR PDF.
- `/earnings-call-digest <symbol> <fq>` reads the concall transcript.
- `/filings-triage <symbol>` ranks recent filings by importance.
