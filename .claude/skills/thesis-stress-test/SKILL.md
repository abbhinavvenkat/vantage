---
name: thesis-stress-test
description: Synthesise all accumulated research evidence — plus codex rule library exit triggers and stalwart investor wisdom — against the original buy thesis and emit a conservative verdict. Designed for a long-duration holder who sells only when absolutely necessary.
triggers:
  - "/thesis-stress-test <symbol>"
  - "stress test thesis for <symbol>"
  - "check if thesis still holds for <symbol>"
inputs:
  symbol: "string — uppercase NSE ticker (e.g. INFY, HDFCBANK)"
  portfolio_id: "optional string — used to read the thesis from the DB via GET /api/p/<portfolio_id>/theses/<symbol>."
outputs:
  - data/research/<symbol>/thesis-stress-test/<run-id>.json
---

# thesis-stress-test

Assess whether the original buy thesis still holds, is worth watching, is structurally weakening, or has broken — anchoring every verdict in both the company's own evidence and the distilled wisdom of the world's best long-term investors.

---

## Investment philosophy embedded in this skill

This skill is built for a **long-duration, conviction-based investor** who:
- Holds with a multi-year thesis and rides through normal business volatility
- Sells **only** when the thesis premise is structurally invalidated — not on temporary setbacks
- Distinguishes sharply between **cyclical headwinds** and **structural deterioration**
- Requires multiple data points before drawing any bearish conclusion

**Default bias: hold. The burden of proof is on the bear case.**

---

## Verdict definitions

- **`intact`**: Thesis confirmed. Also the correct default when evidence is limited (< 3 quarters of digests) and there are no structural red flags. Cyclical headwinds, single-quarter misses, macro noise, and short-duration data do NOT disqualify `intact`. When in doubt, use `intact`.

- **`watch`**: 1–2 data points that *could* be structural but are unconfirmed. Management has acknowledged the issue. One more quarter is needed before escalating. This is NOT a sell signal — it is "pay close attention next quarter." Examples: a guidance miss with a plausible cyclical explanation, a new competitor whose impact is uncertain, a margin dip attributed to a specific one-off.

- **`weakened`**: Requires ≥ 3 quarters of consistent evidence that **core thesis assumptions** — not peripheral KPIs — are structurally eroding. Specifically, at least one of:
  - Pricing power demonstrably and persistently eroding (volumes up, value down for 3+ quarters)
  - Moat assumptions invalidated: key customer lost, substitution underway at scale, market share ceded to structurally superior competitors
  - Management serially missing guidance on the *primary* growth driver for 3+ quarters without credible external explanation or recovery
  - Capital allocation pivoting away from the thesis premise (e.g. thesis = "asset-light compounder"; company now doing serial debt-funded acquisitions at low ROCE)
  Do NOT call `weakened` for: commodity price cycles, macro slowdowns, one-off impairments, regulatory changes management is navigating, or sector-wide headwinds affecting all peers equally.

- **`broken`**: The core premise of the thesis is factually gone. The moat no longer exists, the growth driver has disappeared, management has definitively lost credibility (undisclosed accounting issues, fraud, sustained capital destruction over 3+ years). This is the signal to sell.

---

## Step 1 — Load the thesis

- If `portfolio_id` provided: GET `http://localhost:3000/api/p/<portfolio_id>/theses/<symbol>`. Extract `thesisMd` and `checklistJson`.
- If unavailable or empty: proceed in evidence-only mode (useful for watchlist companies).

---

## Step 2 — Load all company-specific research evidence

- `data/research/<symbol>/earnings-call-digest/*.json` — sorted oldest-to-newest. Record the count.
- `data/research/<symbol>/annual-report-summarize/*.json` — newest 2.
- `data/research/<symbol>/management-accountability/<newest>.json`
- `data/sources/<symbol>/manifest.json` (for source confidence)

---

## Step 3 — Load stalwart wisdom relevant to this verdict

Read the following stalwart profiles from `data/investor_stalwarts/`. Focus on their **Trim / Exit Triggers** and **Red Flags / Avoid List** sections only — not their buy criteria.

Priority list (read in this order; stop after 5–6 profiles if time is limited):
1. `buffett.md` — sell only on structural business economics change; almost never exits
2. `munger.md` — structural moat deterioration or management fidelity failure
3. `akre.md` — only when one of the three legs is broken (business quality, reinvestment ability, runway)
4. `lynch.md` — sell when the *story* has changed (primary reason for buying no longer applies)
5. `terry-smith.md` — persistent ROCE deterioration (3+ years) or gross margin compression (2+ years)
6. `nick-sleep.md` — flywheel has stalled or management shifted to short-term orientation

From these, extract: **what specific conditions would these investors consider a sell?** Apply that bar — not a lower one — to the evidence at hand.

---

## Step 4 — Load codex rule library exit triggers

Read `data/codex/synthesized/v0.2.0.json` (or whichever is the latest version in `data/codex/synthesized/`).

Filter for rules where `action ∈ {trim_25, trim_50, exit}`. For each rule, check: does the company's current evidence trigger this rule?

Key exit rules to check explicitly:
- `rule.universal.exit-on-broken-thesis` — is the thesis broken?
- `rule.redflag.promoter-pledge` — any pledge disclosure?
- `rule.redflag.auditor-or-governance` — auditor or governance issue?
- `rule.redflag.business-leverage` — net debt/EBITDA > 3×?
- `rule.redflag.structural-decline` — secular demand destruction (not cyclical)?
- `rule.universal.management-integrity-gate` — integrity concern?

If any exit rule fires with strong evidence → `broken`. If trim rules fire → factor into `watch` or `weakened`.

Include the matching codex rules (id + statement) in `stalwart_citations` in the output.

---

## Step 5 — Classify every negative signal

For each concerning data point from Steps 2–4, explicitly ask: **cyclical or structural?**

| Type | Definition | Verdict impact |
|------|-----------|----------------|
| Cyclical | Commodity price move, macro slowdown, currency headwind, one-off regulatory change, sector-wide issue, single miss with clear explanation | Does NOT count toward `weakened` |
| Structural | Persistent pricing power loss, moat erosion, serial guidance misses on core KPI (3+ quarters), management credibility failure, capital misallocation | Counts toward `weakened` |

---

## Step 6 — Assess evidence sufficiency and determine verdict

Apply this decision tree:

```
n_digests = number of earnings-call-digest files available

IF n_digests == 0:
    → intact  (no data to contradict thesis)

IF n_digests == 1 or 2:
    IF no stalwart exit condition fires AND no codex exit rule fires:
        → intact
    IF 1–2 structural concerns, unconfirmed, management acknowledged:
        → watch
    IF a hard stalwart exit condition fires (e.g. governance, promoter pledge, moat provably gone):
        → weakened or broken (rare with only 1–2 quarters)

IF n_digests >= 3:
    Apply full stalwart + codex framework
    IF all or most checklist items pass AND no structural deterioration:
        → intact
    IF 1–2 structural signals, confirmed but management addressing:
        → watch
    IF core assumption structurally eroding, confirmed across 3+ quarters:
        → weakened
    IF core premise factually gone:
        → broken

TIE-BREAK: always take the more conservative (less bearish) tier.
```

---

## Step 7 — Write the verdict rationale (3–5 sentences)

Must include:
1. What is holding up from the original thesis
2. What is showing stress — and whether it is cyclical or structural
3. Which stalwart framework best matches this situation and what it says
4. The **next observable event** that would change the verdict (earnings date, regulatory decision, KPI to watch)

---

## Step 8 — Validate and write output

Schema: `ThesisStressTestSchema` from `lib/research/loadOutputs.ts`. Include an optional `stalwart_citations` field alongside the checklist for the stalwart/codex references.

```jsonc
{
  "symbol": "INFY",
  "thesis_md_hash": "sha256-of-thesis-markdown",
  "run_at": "2026-05-04T10:00:00.000Z",
  "checklist": [
    {
      "item": "Revenue CAGR > 8% over 3 years",
      "pass": false,
      "evidence_md": "FY26 guidance 4.5–5% CC; 2 quarters of sub-6% growth. Cyclical IT spending freeze is the stated cause.",
      "citations": [{ "url": "...", "quote": "..." }]
    }
  ],
  "verdict": "watch",
  "verdict_rationale_md": "Revenue growth is below thesis expectations for 2 consecutive quarters. Management attributes this to macro-driven BFSI spending freeze — a plausible cyclical explanation consistent with all peers. No market share loss is visible. Per Akre's framework, none of the three legs (business quality, reinvestment, runway) are broken. Per Lynch, the story has not changed — IT services demand is deferred, not destroyed. Verdict is watch, not weakened — with only 2 quarters of data and a clear external cause. Next check: Q4-FY26 results (April–May 2026). If sub-6% continues with no macro improvement and peers are recovering, upgrade to weakened."
}
```

Run ID: `<symbol>-<YYYYMMDD-HHmmss>`.
Write to `data/research/<symbol>/thesis-stress-test/<run-id>.json`. Create directory if needed.

Report: `<symbol>: verdict=<verdict> (<n> digests). Stalwart match: <framework>. Next event: <date/trigger>.`

---

## Common misclassification traps — do not make these errors

| Situation | Wrong | Correct | Stalwart rationale |
|-----------|-------|---------|-------------------|
| 1–2 quarter miss on secondary KPI | weakened | intact | Insufficient data; all investors demand persistent evidence |
| Commodity price headwind → margin miss | weakened | intact | Cyclical; Terry Smith requires 2+ years of gross margin compression |
| Competitor entry (impact unconfirmed) | weakened | watch | Lynch: story unchanged until the new player demonstrably takes share |
| Only 2 quarters of concall data | weakened | watch or intact | Munger: "I have never made money thinking about short-term patterns" |
| Volume growth strong, value weak (1 quarter) | weakened | watch | 1 data point; Terry Smith needs 2+ years of pricing power loss |
| Sector-wide slowdown | weakened | intact | External, not company-specific; Buffett holds through sector cycles |
| Management guided conservatively and beat | weakened | intact | Management beat — this is a positive signal |
| Guidance cut with clear acknowledged reason | weakened | watch | Lynch: only sell if the story changes; management acknowledging and addressing ≠ story changed |
| Strong volume / unit economics despite revenue miss | weakened | watch | Core business intact; revenue is a lagging number |

---

## Invariants

- Never fabricate evidence. If uncertain → `pass: 'unknown'`.
- When in doubt on verdict tier → take the more conservative (less bearish) option.
- Always cite the stalwart framework that most closely matches the situation.
- Always state the next observable event that would change the verdict.
- Do not read or write `.env*` files.

## Suggested cadence

After each quarterly earnings cycle once new concall digests are available. Not more frequently.
