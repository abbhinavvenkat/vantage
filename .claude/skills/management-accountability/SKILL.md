---
name: management-accountability
description: Cross-reference consecutive earnings call digests for a symbol to surface guidance misses, narrative drift, and tone deterioration over time. Emits a ManagementAccountability JSON that powers the commentary-drift UI on the symbol research hub.
triggers:
  - "/management-accountability <symbol>"
  - "check management accountability for <symbol>"
  - "track management commentary drift for <symbol>"
inputs:
  symbol: "string — uppercase NSE ticker (e.g. INFY, HDFCBANK)"
outputs:
  - data/research/<symbol>/management-accountability/<timestamp>.json
---

# management-accountability

For a given symbol, read all `earnings-call-digest` JSONs sorted oldest-to-newest. For each quarter N, compare N-1's guidance against N's reported actuals. Emit a structured accountability report that tracks whether management is respecting their own words.

## Prerequisites

At least two `earnings-call-digest` JSONs must exist in `data/research/<symbol>/earnings-call-digest/`. If fewer than two, emit a single-quarter stub with `verdict: 'na'` and note the reason.

## Procedure

1. **Load digests**: read all `data/research/<symbol>/earnings-call-digest/*.json`. Sort by `fq` ascending (Q1-FY24 < Q2-FY24 < ... < Q4-FY26). Parse each with `ConcallDigestSchema`.

2. **For each quarter N (starting from the second)**:
   a. **Guidance vs actuals**: compare the guidance items from quarter N-1 with the actuals reported in quarter N.
      - Revenue growth: if N-1 guided e.g. "6% YoY" and N reported 4.2% → `verdict: 'missed'`.
      - EBITDA margin: similar comparison.
      - Qualitative items: assess whether the promise ("ramp in H2", "deal momentum building") was confirmed or contradicted.
      - For each `guidance_vs_actual` item: `{ item, prev_guidance, actual, verdict: 'beat'|'met'|'missed'|'pending'|'na' }`.
      
   b. **Drift signals**: find language patterns that quietly shifted between N-1 and N without explicit acknowledgement.
      Examples:
      - "We expect double-digit growth" (N-1) → "We expect mid-single-digit growth" (N) with no explanation.
      - Confidence language weakened: "we are certain" → "we believe" → "we hope".
      - A KPI prominently cited in N-1 suddenly absent in N (possible negative signal).
      - New risk factor appeared that wasn't mentioned before.
      Each drift signal is a one-sentence observation.
      
   c. **Tone delta**: subtract N-1's `management_tone['score_-2_to_+2']` from N's. Positive = improving, negative = deteriorating.
   
   d. **Quarter verdict**:
      - `delivered`: all or most guidance items met/beat, no significant drift signals.
      - `partial`: mixed — some met, some missed, minor drift.
      - `missed`: material guidance miss or significant drift that management did not acknowledge.
      - `na`: no comparable prior-quarter guidance (first quarter or insufficient data).

3. **Compute consistency score** (0.0–1.0):
   - Score = (quarters with 'delivered') / (quarters with verdict ≠ 'na').
   - If no scorable quarters: 0.5 (neutral default).

4. **Extract red flags** (global, across all quarters):
   - Three or more consecutive partial/missed verdicts.
   - Tone deteriorated by ≥2 points over any 4-quarter window.
   - A KPI that management cited repeatedly is now absent for 2+ quarters.
   - Guidance was revised downward mid-year without clear external explanation.
   Each red flag is a one-sentence description.

5. **Write thesis impact**:
   - 2–4 sentences. Given the pattern of guidance delivery and narrative drift, what is the implication for the original investment thesis? If no thesis exists, assess overall management credibility.

6. **Validate** output against `ManagementAccountabilitySchema` from `lib/research/loadOutputs.ts`:
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
             "verdict": "met"
           }
         ],
         "drift_signals": [
           "Management stopped citing 'large deal wins' prominently — mentioned in Q2 but absent from opening remarks in Q3."
         ],
         "tone_delta": -1,
         "verdict": "partial"
       }
     ],
     "consistency_score": 0.67,
     "red_flags": [
       "Two consecutive quarters with partial delivery on revenue guidance — watch for another miss."
     ],
     "thesis_impact_md": "Management has delivered on margin guidance but consistently missed the top-line growth targets embedded in the buy thesis. The 4.5% CC growth ceiling is now a realistic scenario, not a bear case."
   }
   ```

7. **Write** to `data/research/<symbol>/management-accountability/<ISO-timestamp>.json` (UTC, formatted as `YYYY-MM-DDTHH-MM-SS`). Create directory if needed.

8. **Report**: print one summary line per symbol: `<symbol>: consistency_score=<x.xx>, <n> quarters analysed, <n> red flags.`

## Invariants

- Never invent verdict labels. If there is genuine uncertainty about whether a guidance item was met, use `'na'` or `'pending'`.
- Drift signals must be based on actual textual differences between digests — not conjecture.
- Do not compare guidance items across non-adjacent quarters (only N-1 → N).
- If only one digest exists, emit the report with the single quarter marked `verdict: 'na'` and `consistency_score: 0.5`.

## Idempotence

Each run writes a new timestamped file. The app reads the newest file via `loadLatestManagementAccountability()`. Re-running is always safe.

## Downstream

After this skill, run:
- `/thesis-stress-test <symbol>` — synthesise all evidence into a final thesis verdict.
