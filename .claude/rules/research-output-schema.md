# Research skill output schemas

All company-research skills emit JSON to `data/research/<symbol>/<skill>/<timestamp>.json` matching the schemas below. Validation via Zod in `lib/llm/skillContract.ts`.

---

## company-research-fetch
Path: `data/sources/<symbol>/manifest.json`

```jsonc
{
  "symbol": "BEL",
  "isin": "INE263A01024",
  "fetched_at": "...",
  "sources": [
    {
      "type": "annual_report" | "investor_presentation" | "concall_transcript" | "concall_audio" | "quarterly_results" | "press_release",
      "fy": "FY25", "fq": "Q3-FY26",
      "title": "...", "url": "...", "published_at": "...",
      "source": "bse" | "nse" | "ir" | "screener",
      "local_path": "data/sources/BEL/annual_report/FY25.pdf",
      "sha256_remote": "...", "sha256_local": "...",
      "license_note": "Public regulatory filing"
    }
  ],
  "warnings": [{ "url": "...", "reason": "404|robots-disallowed|paywall" }]
}
```

Idempotent on URL hash. New filings appended.

---

## annual-report-summarize
Path: `data/research/<symbol>/annual-report-summarize/<fy>.json`

```jsonc
{
  "symbol": "BEL", "fy": "FY25",
  "source_url": "...", "source_local_path": "...",
  "generated_at": "...",
  "business_model_md": "...",
  "revenue_mix": [{ "segment": "Defence Electronics", "share_pct": 0.74, "yoy_growth": 0.18 }],
  "growth_drivers_md": "...",
  "risks_md": "...",
  "capital_allocation_md": "...",
  "management_quality_md": "...",
  "red_flags": ["..."],
  "key_numbers": { "revenue": ..., "ebitda_margin": ..., "roce": ..., "fcf": ..., "net_debt": ... },
  "checklist_results": [{ "item": "ROCE > 15% for 5 years", "pass": true, "evidence": "...", "page_ref": "..." }]
}
```

---

## earnings-call-digest
Path: `data/research/<symbol>/earnings-call-digest/<fq>.json`

```jsonc
{
  "symbol": "...", "fq": "Q3-FY26",
  "source_url": "...", "transcript_local_path": "...",
  "guidance": { "revenue_growth_yoy": 0.20, "ebitda_margin": 0.28, "qualitative": "..." },
  "kpi_deltas": [{ "kpi": "order_book", "value": "...", "delta": "+22% YoY" }],
  "analyst_question_themes": [{ "theme": "...", "n_questions": 4, "summary": "..." }],
  "management_tone": { "score_-2_to_+2": 1, "notes": "Defensive on margins; bullish on order pipeline." },
  "thesis_impact_md": "..."
}
```

---

## filings-triage
Path: `data/research/<symbol>/filings-triage/<batch-id>.json`

```jsonc
{
  "symbol": "...", "batch_id": "...", "scanned_at": "...",
  "filings": [
    { "url": "...", "title": "...", "type": "...", "triage": "read_now|skim|ignore", "summary_one_line": "...", "rationale": "..." }
  ]
}
```

---

## thesis-stress-test
Path: `data/research/<symbol>/thesis-stress-test/<run-id>.json`

```jsonc
{
  "symbol": "...", "thesis_md_hash": "...", "run_at": "...",
  "checklist": [
    { "item": "...", "pass": true|false|"unknown", "evidence_md": "...", "citations": [{ "url": "...", "quote": "..." }] }
  ],
  "verdict": "intact" | "watch" | "weakened" | "broken",
  "verdict_rationale_md": "..."
}
```

Verdict definitions:
- `intact`: thesis confirmed or insufficient data for concern (< 3 quarters); default when data is limited.
- `watch`: 1–2 data points showing pressure that *could* be cyclical; not enough to conclude structural weakness. Hold, monitor next quarter.
- `weakened`: ≥ 3 quarters of evidence showing structural deterioration in core thesis assumptions — loss of pricing power, moat erosion, serial unacknowledged guidance cuts on key KPIs. NOT triggered by cyclical headwinds, one-off misses, or macro factors outside management's control.
- `broken`: core premise invalidated — the competitive advantage no longer exists, the growth driver is gone, or management has lost credibility entirely.

---

## management-accountability
Path: `data/research/<symbol>/management-accountability/<ISO-timestamp>.json`

Cross-references consecutive `earnings-call-digest` outputs to track whether management delivered on guidance and flags narrative drift.

```jsonc
{
  "symbol": "INFY",
  "generated_at": "2026-05-04T10:00:00.000Z",
  "quarters": [
    {
      "fq": "Q3-FY26",
      "guidance_vs_actuals": [
        {
          "item": "Revenue growth YoY",
          "prev_guidance": "4.5–5% CC growth for FY26",
          "actual": "4.2% CC growth reported",
          "verdict": "met"   // beat | met | missed | pending | na
        }
      ],
      "drift_signals": [
        "Management stopped citing 'large deal wins' in opening remarks — mentioned prominently in Q2."
      ],
      "tone_delta": -1,       // vs previous quarter; positive = improving
      "verdict": "partial"    // delivered | partial | missed | na
    }
  ],
  "consistency_score": 0.67,  // 0..1; (delivered quarters) / (scorable quarters)
  "red_flags": [
    "Two consecutive quarters of partial delivery on revenue guidance."
  ],
  "thesis_impact_md": "Top-line misses are narrowing the margin of safety in the buy thesis."
}
```

Zod schema: `ManagementAccountabilitySchema` in `lib/research/loadOutputs.ts`.
Loader: `loadLatestManagementAccountability(symbol)` — reads newest file in the directory.

---

## idea-generate
Path: `data/research/_portfolio/idea-generate/<run-id>.json` (portfolio-scoped, not per-symbol)

```jsonc
{
  "portfolio_id": "...", "run_at": "...",
  "gaps_identified": ["FMCG <1% weight", "no large-cap private bank ex-HDFC", "..."],
  "candidates": [
    {
      "symbol": "HINDUNILVR", "name": "...", "thesis_md": "...",
      "key_ratios": { "pe": 52, "roce": 0.78, "div_yield": 0.018, "5y_revenue_cagr": 0.08 },
      "entry_zones": { "fair": 2400, "strong_buy": 2150 },
      "conviction": "high", "risk": "low",
      "matching_codex_rules": ["rule.fmcg.rural-revival-buy"]
    }
  ]
}
```
