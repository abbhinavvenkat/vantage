# Codex output schemas

All codex skills emit JSON conforming to the schemas below. Validation via Zod (mirrored in `lib/codex/ruleSchema.ts`).

---

## 1. Per-investor distilled JSON (`data/codex/distilled/<slug>.json`)

```jsonc
{
  "investor_slug": "buffett",
  "investor_name": "Warren Buffett",
  "version": "0.1.0",
  "generated_at": "2026-05-03T...",
  "principles": [
    {
      "id": "buffett.principle.circle-of-competence",
      "statement": "Only invest within your circle of competence.",
      "source_url": "https://www.berkshirehathaway.com/letters/1996.html",
      "quote": "What an investor needs is the ability to correctly evaluate selected businesses.",
      "page_or_anchor": "p-12",
      "confidence": "high",
      "applicability_tags": ["all-markets", "all-caps"]
    }
  ],
  "mental_models": [ /* same shape as principles */ ],
  "valuation_methods": [
    {
      "id": "buffett.valuation.owner-earnings",
      "statement": "Owner earnings = reported earnings + D&A − maintenance capex − working-capital needs.",
      "source_url": "...", "quote": "...", "page_or_anchor": "...",
      "formula": "OE = NI + D&A − maintenance_capex − ΔWC",
      "confidence": "high",
      "applicability_tags": ["compounders"]
    }
  ],
  "position_sizing_rules": [ /* statement + cite + tags */ ],
  "buy_triggers":   [ /* statement + cite + conditions{...} + tags */ ],
  "add_triggers":   [ /* same */ ],
  "trim_triggers":  [ /* same */ ],
  "exit_triggers":  [ /* same */ ],
  "red_flags":      [ /* statement + cite + tags */ ],
  "case_studies": [
    {
      "id": "buffett.case.coca-cola-1988",
      "company": "Coca-Cola",
      "ticker": "KO",
      "year_entered": 1988,
      "year_exited": null,
      "thesis_md": "...",
      "outcome_md": "...",
      "rules_demonstrated": ["buffett.principle.circle-of-competence", "buffett.valuation.owner-earnings"],
      "source_url": "...", "quote": "...", "page_or_anchor": "..."
    }
  ]
}
```

Every `entry` MUST cite `source_url` + `quote` + `page_or_anchor`. `confidence ∈ {high, medium, low}`. `applicability_tags` from the controlled vocabulary in `.claude/rules/codex-investors.yml#applicability_tags`.

---

## 2. Synthesized Rule Library (`data/codex/synthesized/v{semver}.json`)

```jsonc
{
  "version": "0.1.0",
  "generated_at": "...",
  "rules": [
    {
      "id": "rule.compounder.add-on-temporary-narrative-break",
      "statement": "Add to a compounder when price falls ≥20% on a temporary narrative concern that doesn't impair 5-year earnings power.",
      "action": "add",                                    // fresh_buy|add|hold|trim_25|trim_50|exit
      "conditions": {
        "valuation":    { "max_pe": 35, "max_ev_ebitda": 25 },
        "fundamentals": { "min_roce_5y_avg": 0.18, "min_revenue_cagr_5y": 0.10 },
        "narrative":    { "drawdown_cause": "temporary_narrative", "thesis_intact": true },
        "price_action": { "max_drawdown_from_52w_high": -0.20 },
        "time_in_position": { "min_months_held": 12 }
      },
      "supporting_investors": [
        { "investor": "buffett", "rule_ids": ["buffett.principle.mr-market", "buffett.principle.business-quality"] },
        { "investor": "agrawal", "rule_ids": ["agrawal.qglp.quality"] },
        { "investor": "akre",    "rule_ids": ["akre.three-legged-stool"] }
      ],
      "counterexamples": [
        { "investor": "lynch", "note": "Lynch warns against 'averaging down' on broken stories — distinguishes by checklist." }
      ],
      "weight": 0.78,                                     // 0..1, set by codex-synthesize
      "evidence_strength": "strong",                      // weak|moderate|strong
      "rationale_md": "Three top investors converge on this exact pattern with quantitative criteria; Lynch's caveat is captured as a checklist gate."
    }
  ]
}
```

Conflicting rules are RETAINED (not de-duped); resolution happens at scoring time via `user_style_profile`.

---

## 3. Stalwart Profile (`data/investor_stalwarts/<slug>.md`) — COMMITTED

This is the human-readable curated profile, ONE per investor in `.claude/rules/codex-investors.yml`. **These files are committed to git** (unlike the rest of `data/`).

Template:

```markdown
---
slug: buffett
name: Warren Buffett
style_tags: [value, quality, concentration, long-duration]
active_period: "1965–present"
primary_geo: "US"
aum_or_track_record: "Berkshire Hathaway book value CAGR ~19.8% (1965–2023) vs S&P 500 ~10.2% (with dividends)"
last_updated: "2026-05-03"
---

# Warren Buffett

## Snapshot
2–4 sentences.

## Investing Style & Edge
What kind of investor, holding periods, concentration vs diversification, position sizing.

## Core Principles
Bulleted, each cited as `[source](url#anchor)`.

## Mental Models & Frameworks
Frameworks they invented or popularised. Each: name, one-line definition, citation.

## Valuation Approach
DCF, owner earnings, P/E rules of thumb, growth-at-reasonable-price math, etc.

## Buy Triggers
Conditions for entry, with citations.

## Add Triggers
When they add to a winner.

## Trim / Exit Triggers
When they reduce or sell.

## Red Flags / Avoid List
What they refuse to touch and why.

## Notable Wins (Case Studies)
3–6 documented wins: company, entry rationale, hold period, return.

## Notable Losses / Mistakes
3–6 documented losses or stated mistakes.

## Quotes Worth Remembering
5–10 short quotes with full citations.

## Applicability to Indian Equities
1–3 paragraphs. (For Indian investors: "Cross-applicability to global equities".)

## Recommended Reading / Listening
Top 3–5 sources.

## Sources
Full URL list of everything cited above.

<!-- HUMAN-EDITED:START -->
<!-- Anything between these markers is preserved by stalwart-profile-update across regenerations. -->
<!-- HUMAN-EDITED:END -->
```

The `stalwart-profile-update` skill regenerates everything OUTSIDE the `HUMAN-EDITED` markers and bumps `last_updated`. Users may edit anywhere; their additions are protected only inside the markers.

---

## 4. Discovery output (`data/codex/discovery/<educator-slug>.json`)

```jsonc
{
  "educator_slug": "shankar-nath",
  "scanned_at": "...",
  "mentions": [
    {
      "investor_name": "Pulak Prasad",
      "count": 4,
      "contexts": [
        { "source": "video-12345.md", "anchor": "p-7", "quote": "Pulak Prasad's 'avoid losers' framework..." }
      ],
      "suggested_seed_urls": [
        "https://www.nalandacapital.com/",
        "https://www.youtube.com/results?search_query=pulak+prasad+nalanda"
      ],
      "suggested_style_tags": ["quality", "concentration", "indian-equities"],
      "suggested_priority": 2
    }
  ]
}
```

Discovery NEVER auto-appends to `codex-investors.yml`. The skill emits this file; a human reviews and adds confirmed entries by hand (or via a separate approval skill).

---

## 5. Backtest output (`data/codex/backtests/v{version}/<rule-id>.json`)

```jsonc
{
  "rule_id": "rule.compounder.add-on-temporary-narrative-break",
  "rule_library_version": "0.1.0",
  "universe": "user_tradebook",       // or "nifty500"
  "period": { "start": "2020-01-01", "end": "2026-04-30" },
  "n_signals": 42,
  "n_with_outcome": 38,
  "hit_rate": 0.71,                    // % of signals where action was correct ex-post
  "avg_return_when_triggered": 0.23,   // 1y forward, simple
  "avg_return_baseline": 0.08,         // same period Nifty 50
  "max_drawdown_when_triggered": -0.18,
  "false_positive_rate": 0.29,
  "notes_md": "..."
}
```

Rules with `hit_rate < 0.5` AND `n_signals ≥ 20` get `weight: 0` in the next `codex-synthesize` pass.
