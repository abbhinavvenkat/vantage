---
name: news-fetch
description: Fetch recent news headlines per symbol from Google News RSS for a list of NSE-listed equities. Writes JSON to data/news/<symbol>.json that the stock-platform News page imports.
triggers:
  - "/news-fetch <SYMBOL> [SYMBOL...]"
  - "fetch news for <symbols>"
  - "refresh news feed"
inputs:
  symbols: "string[] — uppercase NSE tickers (e.g. BEL, HDFCBANK, IEX, LTIM). Required."
  horizon_days: "number (default 14) — look-back window in days."
  force: "boolean (default false) — overwrite existing files instead of merging."
outputs:
  - data/news/<SYMBOL>.json   # one per symbol; conforms to lib/validation/news.ts#NewsFileSchema
---

# news-fetch

Pull recent news headlines for a watchlist/holdings symbol set from publicly-accessible sources (Google News RSS — no API keys, no scraping behind auth). Per-host 1 req/sec; respects `robots.txt`. Strictly read-only.

The stock-platform Next.js app NEVER calls external APIs. This skill is the **only** news ingestion path; the app reads the JSON files via `lib/db/queries/news.ts#importNewsFromFiles` triggered by the user's "Re-import from files" button on the `/p/<id>/news` page.

## Procedure

1. **Resolve company name**: For each input symbol (uppercase NSE ticker), look up the human-readable company name from `data/refs/symbol_company.json` (a `{ "<SYMBOL>": "<Company Name>" }` map). If the file is missing or the symbol is absent, fall back to the bare symbol. The query string is `<COMPANY+NAME>+stock` (or `<SYMBOL>+stock`).

2. **Google News RSS** — `https://news.google.com/rss/search?q=<QUERY>&hl=en-IN&gl=IN&ceid=IN:en`:
   - GET the RSS feed.
   - Parse the `<item>` elements. For each:
     - `title` ← `<title>` (strip the trailing " - <Source>" suffix Google appends).
     - `url` ← `<link>` (Google news redirector URL is fine; do not follow).
     - `publishedAt` ← `<pubDate>` parsed to ISO 8601 (`YYYY-MM-DDThh:mm:ssZ`).
     - `source` ← the substring after the last " - " in the original `<title>`, or the host of `<link>` if not present.
   - If the feed returns 0 items, skip silently with a log line.

3. **Filter horizon**: keep only items where `publishedAt >= now - horizon_days`.

4. **Dedupe**: within a symbol, dedupe on `url`. If two URLs share the same `(normalized_title, source)` keep the older one (URL stability).

5. **Validate**: each output object MUST satisfy `NewsFileSchema` from `lib/validation/news.ts` (project root):
   ```jsonc
   {
     "items": [
       {
         "title": "string (1..500)",
         "url": "https://...",          // valid URL
         "publishedAt": "string (1..64)", // ISO 8601 preferred
         "source": "string (1..200)"
       }
     ]
   }
   ```
   Drop rows that fail validation; log them in stderr.

6. **Write**: For each symbol with ≥1 item, write `data/news/<SYMBOL>.json` (UTF-8, 2-space indent).
   - If file exists and `force` is false, **merge** — keep both old and new entries deduped by `url`.
   - If `force` is true, **overwrite**.

7. **Report**: print a one-line summary per symbol — `<SYMBOL>: <new>+<existing>=<total> items`. End with a global summary line.

## Compliance

- Per-host rate limit: 1 request per second (Google News RSS is the only host this skill talks to).
- Honor `robots.txt`. If `news.google.com` disallows the RSS path, skip with a warning. Never spoof identity beyond a generic browser UA.
- No paid APIs, no API keys.
- No PII or auth cookies persisted to disk.

## Idempotence guarantees

- Same input set + same source state → same output files (modulo timestamps which are NOT written into the file).
- Re-running with `force: false` is safe — entries are dedupe-keyed on `url` and merged.
- Failure of one symbol doesn't abort the run; the rest proceed and the failure is logged.

## Privacy

- Nothing in `data/news/` is committed (already gitignored under `data/`).
- The skill never reads/writes anything in `.env*`.
- The skill never logs symbol-quantity-price triples (this skill doesn't see them — it operates only on tickers).

## Verify it works

After running `/news-fetch BEL`:
1. Expect `data/news/BEL.json` to exist with at least 1 recent item.
2. Open `http://localhost:3000/p/<portfolioId>/news` and click **Re-import from files** — the BEL items should appear in the feed.
3. Re-run the skill; the count should not change (idempotency).

## Failure modes

- **Google News blocks all requests**: very rare for the RSS endpoint; if it 4xx-s after one retry, bail with a clear message and leave existing files untouched.
- **Symbol not found / no items**: writes nothing for that symbol; logs a one-line warning.

## Suggested invocation cadence

Run daily or as needed. The News page exposes a "Copy fetch command" button that copies the right `/news-fetch ...` invocation (with currently held + watchlisted symbols) for paste-back into Claude Code.
