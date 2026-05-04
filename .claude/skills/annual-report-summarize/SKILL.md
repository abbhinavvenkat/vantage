---
name: annual-report-summarize
description: Read a company's annual report PDF and emit a structured ARSummary JSON — business model, revenue mix, growth drivers, risks, capital allocation, management quality, key numbers, and a buy-thesis checklist. Designed for an Indian-equity long-holder who needs the qualitative substance behind the numbers.
triggers:
  - "/annual-report-summarize <symbol> <fy>"
  - "summarize annual report for <symbol>"
  - "read FY25 AR for <symbol>"
inputs:
  symbol: "string — uppercase NSE ticker (e.g. INFY, HDFCBANK)"
  fy: "string — fiscal year in FY{yy} format (e.g. FY25, FY26). Defaults to the newest available."
outputs:
  - data/research/<symbol>/annual-report-summarize/<fy>.json
---

# annual-report-summarize

Read a company's annual report and extract the qualitative and quantitative substance into a structured `ARSummary` JSON. Focus on what a long-duration investor needs: moat evidence, management quality signals, capital allocation patterns, and the 5-year financial arc.

---

## Step 1 — Locate the annual report

1. Read `data/sources/<symbol>/manifest.json`.
2. Filter for entries with `type = "annual_report"`.
3. If `fy` was specified: pick the matching entry. Otherwise: pick the entry with the highest FY number.
4. Check `local_path`:
   - If `local_path` is set AND the file exists on disk: use it directly.
   - If `local_path` is missing OR the file is absent:
     - Fetch the PDF from `url` using WebFetch.
     - Save to `data/sources/<symbol>/annual_report/<fy>__<title-slug>.pdf`.
     - Update the manifest entry's `local_path` and `sha256_local` fields in `manifest.json`.
5. If no AR entry exists in manifest at all, and the manifest file itself doesn't exist:
   - Search for the AR using the Screener.in page: `https://www.screener.in/company/<symbol>/`
   - Look for a link to the latest annual report PDF.
   - Download it and create a minimal manifest entry.
6. If still no AR can be found: emit a minimal output with all fields defaulting and `red_flags: ["Annual report not available — run company-research-fetch first."]`. Do NOT fabricate financial data.

---

## Step 2 — Read the document

Use the Read tool on the local PDF path. For large PDFs (>10 pages), read in sections:
- Pages 1–10: cover, directors' report, MD&A highlights.
- Pages covering the financial statements (look for "Standalone Statement of Profit and Loss", "Balance Sheet", "Cash Flow").
- Pages covering the business review / segment overview.
- The chairman's / MD's letter.
- Notes to accounts for any unusual items.

If the PDF text layer is absent (scanned image only), note this in `red_flags` and proceed with whatever text is extractable.

---

## Step 3 — Extract business model and strategy

From the chairman's/MD's letter and business review sections:

- **business_model_md** (3–5 sentences): what the company sells, to whom, through what channel, and what makes it difficult to replicate. Focus on moat-relevant facts (switching costs, scale advantages, brand, regulatory protection, network effects).
- **growth_drivers_md** (2–4 sentences): what management cites as the primary engines of growth for the next 3–5 years. Be specific: "Expanding rural distribution from 500K to 800K outlets" not "growing distribution".
- **risks_md** (2–4 sentences): the 2–3 most material risk factors specific to this business (not boilerplate). Include any risks management appears to be downplaying.
- **capital_allocation_md** (2–4 sentences): dividends, buybacks, capex/acquisitions. Is the company reinvesting at high returns or distributing cash? Is debt being used wisely?
- **management_quality_md** (2–4 sentences): tenure, track record, skin in the game (promoter holding trend), any governance concerns visible in notes/auditor's report.

---

## Step 4 — Extract revenue mix

Look for segment reporting, product category tables, or geographic split. For each segment/category:
```
{ segment: "Defence Electronics", share_pct: 0.74, yoy_growth: 0.18 }
```
`share_pct` = segment revenue / total revenue (0–1 scale). `yoy_growth` = (current − prior) / prior.
Cap at 8 segments. If only total figures are available, use one entry: `{ segment: "Total", share_pct: 1.0, yoy_growth: <calculated> }`.

---

## Step 5 — Extract key numbers

From the financial statements (use standalone figures; note if using consolidated):

```jsonc
{
  "revenue": <INR crores>,
  "ebitda_margin": <0.xx — EBITDA/Revenue>,
  "roce": <0.xx — EBIT / (equity + long-term debt)>,
  "fcf": <INR crores — operating cashflow minus capex>,
  "net_debt": <INR crores — total debt minus cash; negative = net cash>
}
```

If any figure is unavailable or unreliable (e.g., single-year standalone statement missing EBITDA detail), use `null` and note the gap in `red_flags`. **Do not estimate or interpolate.**

---

## Step 6 — Extract red flags

Scan specifically for:
- Auditor qualifications or emphasis-of-matter paragraphs.
- Promoter pledge disclosures (check `Shareholding Pattern` or notes to accounts).
- Related-party transactions that look unusual in size or nature.
- Net debt increase of >2× in one year without obvious capex rationale.
- Revenue/profit recognition policies that appear aggressive.
- Contingent liabilities > 50% of net worth.
- Any restatements or accounting policy changes.

List each as a one-sentence `red_flags[]` entry. If none: empty array.

---

## Step 7 — Run the checklist

Evaluate these items against the annual report evidence:

| Item | Pass condition |
|------|---------------|
| ROCE > 15% for 5 years | Yes if most recent year ROCE ≥ 15% and described as consistent in MD&A |
| Revenue CAGR > 10% (3–5 years) | Yes if 3-year or 5-year CAGR visible in highlights/trends |
| Gross margin stable or expanding | Yes if explicitly noted in MD&A or derivable from segment data |
| FCF positive for 3+ years | Yes if cash flow from operations > capex for current year + mentioned in MD&A |
| Net debt < 1× EBITDA | Yes if net_debt / (revenue × ebitda_margin) < 1.0 |
| Promoter holding > 40% | Yes if visible in shareholding pattern |
| No auditor qualification | Yes if auditors report is clean |
| Dividend / buyback growing | Yes if DPS increased or buyback happened in last 2 years |
| Working capital days improving | Yes if explicitly mentioned as improving in MD&A |
| Management guidance credibility | Yes if MD's letter targets are specific (not vague) and consistent with reported numbers |

For each item: `{ item, pass: true|false|"unknown", evidence: <one sentence>, page_ref: <approx page or section> }`.

---

## Step 8 — Validate and write output

Schema: `ARSummarySchema` from `lib/research/loadOutputs.ts`.

```jsonc
{
  "symbol": "BEL",
  "fy": "FY25",
  "source_url": "https://www.bseindia.com/...",
  "source_local_path": "data/sources/BEL/annual_report/FY25__annual-report.pdf",
  "generated_at": "2026-05-04T10:00:00.000Z",
  "business_model_md": "BEL is a defence PSU...",
  "revenue_mix": [
    { "segment": "Defence Electronics", "share_pct": 0.74, "yoy_growth": 0.18 }
  ],
  "growth_drivers_md": "...",
  "risks_md": "...",
  "capital_allocation_md": "...",
  "management_quality_md": "...",
  "red_flags": [],
  "key_numbers": {
    "revenue": 21408,
    "ebitda_margin": 0.17,
    "roce": 0.29,
    "fcf": 1850,
    "net_debt": -3200
  },
  "checklist_results": [
    { "item": "ROCE > 15% for 5 years", "pass": true, "evidence": "FY25 ROCE 29%; MD&A cites consistent 20%+ over 5 years.", "page_ref": "p-34" }
  ]
}
```

Write to `data/research/<symbol>/annual-report-summarize/<fy>.json`. Create directory if needed. Use 2-space indent.

Report: `<symbol> <fy>: AR summarized. ROCE=<x>%, FCF=<x>cr. <n> red flags. Checklist: <n_pass>/<n_total> pass.`

---

## Invariants

- **Never fabricate financial numbers**. If a figure is not in the document, use `null`.
- **Do not use Screener/news/internet estimates** — only figures from the annual report itself.
- Use standalone financial figures by default; switch to consolidated only if standalone is clearly missing.
- `fy` format must be `FY{2-digit-year}` (e.g. FY25). Reject other formats.
- If reading a PDF, use the Read tool with `pages` parameter on large documents to avoid hitting the 20-page limit — read the most relevant sections iteratively.
- Do not write to `.env*` files.

## Idempotence

Re-running overwrites the output file. The app reads the latest file via `loadARSummaries()`. Overwrites are safe.

## Downstream

After this skill, run:
- `/earnings-call-digest <symbol> <fq>` — for the latest concall
- `/thesis-stress-test <symbol>` — synthesise all evidence into a verdict
