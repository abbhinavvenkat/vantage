---
name: events-fetch
description: Fetch upcoming corporate events (earnings, AGM, ex-div, board meetings, results dates) for a list of NSE-listed equities. Writes JSON to data/events/<symbol>.json that the stock-platform Events page imports.
triggers:
  - "/events-fetch <SYMBOL> [SYMBOL...]"
  - "fetch upcoming events for <symbols>"
  - "refresh events calendar"
inputs:
  symbols: "string[] — uppercase NSE tickers (e.g. BEL, HDFCBANK, IEX, LTIM). Required."
  horizon_days: "number (default 90) — how far in the future to look."
  force: "boolean (default false) — overwrite existing files instead of merging."
outputs:
  - data/events/<SYMBOL>.json   # one per symbol; conforms to lib/validation/events.ts#EventsFileSchema
---

# events-fetch

Pull upcoming corporate events for a watchlist/holdings symbol set from publicly-accessible sources (no API keys, no scraping behind auth). Per-host 1 req/sec; respects `robots.txt`. Strictly read-only (no writes back to source sites).

The stock-platform Next.js app NEVER calls external APIs. This skill is the **only** event ingestion path; the app reads the JSON files via `lib/events/importFromFiles.ts` triggered by the user's "Re-import from files" button on the `/p/<id>/events` page.

## Procedure

1. **Resolve targets**: For each input symbol (uppercase NSE ticker), build the BSE security code via `https://www.bseindia.com/corporates/List_Scrips.html` lookup or use the well-known BSE→NSE mapping table at `data/refs/bse_nse_map.json` if present (skip silently if not).

2. **BSE — Forthcoming Results** (`https://www.bseindia.com/corporates/Forth_Results.aspx`):
   - GET the page; parse the table.
   - Filter rows where the `Security Name` contains the symbol or matches the BSE code.
   - For each match, emit `{ eventType: 'earnings', eventDate, title: 'Quarterly Results — <quarter>' }`.

3. **BSE — Forthcoming Board Meetings** (`https://www.bseindia.com/corporates/Forth_BoardMeetings.aspx`):
   - GET the page; parse the table.
   - Map purpose → eventType:
     - "Financial Results" → `earnings`
     - "AGM" / "Annual General Meeting" → `agm`
     - "Dividend" / "Interim Dividend" → `ex_div`
     - "Record Date" → `record_date`
     - everything else → `other`
   - Title = "Board Meeting — <purpose>".

4. **NSE — Event Calendar** (`https://www.nseindia.com/companies-listing/corporate-filings-event-calendar`):
   - NSE pages require a cookie warm-up: GET `https://www.nseindia.com/` first to harvest cookies, then GET the JSON endpoint `https://www.nseindia.com/api/event-calendar?symbol=<SYMBOL>` with the harvested cookies + a desktop User-Agent.
   - Parse the JSON; emit one event per row with appropriate `eventType`.
   - If the request 401s or 403s after one retry, fall back to step 5.

5. **Trendlyne fallback** (`https://trendlyne.com/equity/<SYMBOL>/calendar/`):
   - Public, no auth. Parse the upcoming-events table.
   - Cap at top-10 events per symbol.

6. **Filter horizon**: keep only events with `eventDate >= today AND eventDate <= today + horizon_days`.

7. **Dedupe**: within a symbol, dedupe on `(eventType, eventDate, normalize(title))`. Prefer BSE-sourced rows over Trendlyne when titles differ slightly.

8. **Validate**: each output object MUST satisfy `EventsFileSchema` from `lib/validation/events.ts` (project root):
   ```jsonc
   {
     "events": [
       {
         "eventType": "earnings|agm|ex_div|record_date|other",
         "eventDate": "YYYY-MM-DD",
         "title": "string (1..200)",
         "notes": "string|null (optional)"
       }
     ]
   }
   ```
   Drop rows that fail validation; log them in stderr.

9. **Write**: For each symbol with ≥1 event, write `data/events/<SYMBOL>.json` (UTF-8, 2-space indent).
   - If file exists and `force` is false, **merge** by `(eventType, eventDate, title)` — keep both old and new dedupe-keyed entries.
   - If `force` is true, **overwrite**.

10. **Report**: print a one-line summary per symbol — `<SYMBOL>: <new>+<existing>=<total> events`. End with a global summary line.

## Compliance

- Per-host rate limit: 1 request per second (stagger BSE / NSE / Trendlyne separately, but each host hard-capped at 1 req/sec).
- Honor `robots.txt`. If a host disallows the path, skip with a warning. Never spoof identity beyond a generic browser UA.
- No paid APIs, no API keys.
- No PII or auth cookies persisted to disk.

## Idempotence guarantees

- Same input set + same source state → same output files (modulo timestamps which are NOT written into the file).
- Re-running with `force: false` is safe — entries are dedupe-keyed and merged.
- Failure of one symbol doesn't abort the run; the rest proceed and the failure is logged.

## Privacy

- Nothing in `data/events/` is committed (already gitignored under `data/`).
- The skill never reads/writes anything in `.env*`.
- The skill never logs symbol-quantity-price triples (this skill doesn't see them — it operates only on tickers).

## Verify it works

After running `/events-fetch BEL`:
1. Expect `data/events/BEL.json` to exist with at least 1 future event (BEL has quarterly results / board meetings published months ahead).
2. Open `http://localhost:3000/p/<portfolioId>/events` and click **Re-import from files** — the BEL events should appear in the inbox.
3. Re-run the skill; the count should not change (idempotency).

## Failure modes

- **NSE blocks all requests** (most common): falls back to Trendlyne automatically.
- **Symbol not found on any source**: writes nothing for that symbol; logs a one-line warning.
- **All sources down**: exits non-zero with a clear message; the existing `data/events/*.json` files are untouched.

## Suggested invocation cadence

Run weekly. The Events page also exposes a "Generate fetch command" button that copies the right `/events-fetch ...` invocation (with currently held + watchlisted symbols) for paste-back into Claude Code.
