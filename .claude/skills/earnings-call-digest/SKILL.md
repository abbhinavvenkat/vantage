---
name: earnings-call-digest
description: Parse an earnings call transcript (pre-fetched by company-research-fetch) and extract structured commentary — guidance, KPI deltas, management tone, analyst question themes, and thesis impact — into a ConcallDigest JSON file.
triggers:
  - "/earnings-call-digest <symbol> <fq>"
  - "digest <symbol> Q3-FY26 concall"
  - "extract earnings call commentary for <symbol>"
inputs:
  symbol: "string — uppercase NSE ticker (e.g. INFY, HDFCBANK)"
  fq: "string — fiscal quarter in Q{n}-FY{yy} format (e.g. Q3-FY26)"
outputs:
  - data/research/<symbol>/earnings-call-digest/<fq>.json
---

# earnings-call-digest

Parse a concall transcript for one symbol+quarter into a structured `ConcallDigest` JSON. Idempotent on `(symbol, fq)` — re-running overwrites only if the transcript has changed.

## Prerequisites

Run `/company-research-fetch <symbol>` first. The transcript must be present in `data/sources/<symbol>/` as a PDF or TXT file with `fq` in its path or filename.

## Procedure

1. **Locate transcript**: scan `data/sources/<symbol>/manifest.json`.
   - Look for an entry with `type = "concall_transcript"` and `fq = "<fq>"`.
   - Use `local_path` to find the file.
   - If not found, exit with a clear error: "No concall transcript found for <symbol> <fq>. Run /company-research-fetch first."

2. **Parse the document**:
   - If PDF: read text layer. If scanned (no text layer), skip with a warning.
   - If TXT/HTML: read directly.
   - Identify sections: opening remarks, management presentation, Q&A.

3. **Extract — guidance**:
   - Look for explicit numeric guidance: revenue growth YoY %, EBITDA margin %, capex guidance.
   - Look for qualitative guidance: "we expect", "we are confident", "we guide for", "our target is".
   - Populate `guidance.revenue_growth_yoy`, `guidance.ebitda_margin`, `guidance.qualitative`.
   - If a number was given as a range (e.g. "18–20%"), use the midpoint.

4. **Extract — KPI deltas**:
   - Find headline KPIs mentioned with YoY or QoQ comparisons: order book, headcount, utilisation, ARPU, store count, capacity, etc.
   - For each: `{ kpi, value (current), delta ("+X% YoY" or similar) }`.
   - Cap at 10 KPIs; prioritise those management mentioned prominently.

5. **Extract — analyst question themes**:
   - Group analyst questions by topic (margin pressure, growth outlook, competition, capex, working capital, etc.).
   - For each group: `{ theme, n_questions, summary (one sentence) }`.
   - Cap at 8 themes.

6. **Assess management tone** (score −2 to +2):
   - +2: highly bullish, specific commitments, no hedging.
   - +1: cautiously optimistic, some hedging.
   -  0: neutral, balanced.
   - −1: cautious, defensive language, "we remain watchful".
   - −2: distressed, guidance cuts, apologies for misses.
   - Populate `management_tone['score_-2_to_+2']` and `management_tone.notes` (one sentence explaining the score).

7. **Write thesis impact**:
   - In 1–3 sentences, describe how this quarter's commentary changes (or confirms) the investment thesis.
   - If there is no thesis loaded (no `data/research/<symbol>/thesis-stress-test/`), base this on overall business health signals.

8. **Validate output** against `ConcallDigestSchema` from `lib/research/loadOutputs.ts`:
   ```jsonc
   {
     "symbol": "INFY",
     "fq": "Q3-FY26",
     "source_url": "https://...",
     "transcript_local_path": "data/sources/INFY/concall_transcript/Q3-FY26__...",
     "guidance": {
       "revenue_growth_yoy": 0.06,
       "ebitda_margin": 0.212,
       "qualitative": "Management guided for 4.5–5% CC revenue growth for FY26."
     },
     "kpi_deltas": [
       { "kpi": "headcount", "value": "317,240", "delta": "-1.3% YoY" }
     ],
     "analyst_question_themes": [
       { "theme": "Margin sustainability", "n_questions": 4, "summary": "Analysts pressed on wage hike timing and its margin impact." }
     ],
     "management_tone": {
       "score_-2_to_+2": 1,
       "notes": "Confident on deal pipeline but cautious on near-term volume ramp."
     },
     "thesis_impact_md": "Revenue growth guidance narrows to 4.5–5% — modest positive vs the thesis assuming 6%+ growth. Margin trajectory is intact."
   }
   ```

9. **Write** to `data/research/<symbol>/earnings-call-digest/<fq>.json` (UTF-8, 2-space indent).
   - Create directory if it does not exist.
   - Overwrite if file already exists (idempotent on content).

10. **Report**: print one-line summary — `<symbol> <fq>: digest written. Tone: <score>. Guidance: <qualitative or 'numeric'>.`

## Invariants

- Never invent numbers not present in the transcript. If uncertain, use `null` for numeric fields.
- `fq` format must be `Q{1-4}-FY{2-digit-year}` (e.g. Q3-FY26). Reject anything else.
- Do not persist any user-supplied transcript paths. Only paths from `manifest.json` are valid.
- Respect the LLM contract: this skill reads from `data/sources/` only; it never writes back to source sites.

## Idempotence

Re-running with the same `(symbol, fq)` overwrites the output file with a fresh extraction. The app reads the latest file, so overwrites are safe.

## Downstream

After this skill, run:
- `/management-accountability <symbol>` — cross-reference across quarters
- `/thesis-stress-test <symbol>` — verdict against original thesis
