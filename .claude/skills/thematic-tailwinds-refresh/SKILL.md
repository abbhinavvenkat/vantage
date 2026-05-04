---
name: thematic-tailwinds-refresh
description: Refresh `data/refs/thematic_tailwinds.json` — the catalog of structural / emerging / maturing / declining themes that the Compounder Thesis framework reads to award "thematic tailwind" credit (10x optionality for businesses sitting in AI, EV, drones, renewables, semiconductors, India consumer premium, etc.). Strictly read-only against public sources, no API keys.
---

# thematic-tailwinds-refresh

Update the theme catalog driving the Compounder Thesis framework's `thematic_tailwind` factor (`lib/compounder/factors.ts`). The factor reads `data/refs/thematic_tailwinds.json` — this skill regenerates it from public consultancy / institutional research with citation-anchored evidence per theme.

## What it produces

```jsonc
{
  "version": "0.x.0",
  "generated_at": "<ISO timestamp>",
  "source_summary": "<one paragraph noting which sources were consulted>",
  "themes": {
    "<theme_id>": {
      "label": "<human label>",
      "tier": "structural | emerging | maturing | declining",
      "horizon_years": <integer>,
      "growth_outlook_pct_yoy": <number, +ve = growing, -ve = declining>,
      "evidence": [
        { "source": "<institution>", "citation": "<one-line takeaway>", "url": "<public URL>" }
      ]
    }
  },
  "symbol_themes": {
    "<NSE_SYMBOL>": ["<theme_id>", ...]
  }
}
```

Schema mirrored at `lib/compounder/thematicTailwinds.ts#ThematicTailwindsRef`.

## Procedure

1. **Sources to scan** (all public, no auth):
   - **McKinsey Global Institute** — economic-impact reports per theme: https://www.mckinsey.com/mgi
   - **IEA** — World Energy Outlook, Coal report, Global EV Outlook: https://www.iea.org
   - **BloombergNEF** — public summaries of NEO / EV outlook
   - **Goldman Sachs Insights** (public), Morgan Stanley Ideas
   - **NASSCOM** — Indian IT/ESDM/ERD reports: https://www.nasscom.in
   - **AMFI / SEBI / NIIF** — financialization stats
   - **Government policy**: NITI Aayog NIP, MoD defence procurement, MeitY ESDM plan
   - **CB Insights / PitchBook** — public theme briefings (no paid content)
   - **Top-of-mind investor commentary**: Buffett letters, Howard Marks memos, Indian fund managers' annual letters that surface theme bets

2. **Build the theme list** (target 12–18 themes):
   - Always include: `ai_compute`, `ev_battery`, `renewable_energy`, `drones_defence`, `semiconductor_design`, `cybersecurity`, `data_center`, `automotive_software`, `engineering_rd_outsourcing`, `specialty_chemicals_china_plus_one`, `biotech_specialty_pharma`, `financialization_india`, `indian_premium_consumer`, `indian_capex_cycle`.
   - Add 2–3 more if cross-source consensus emerges (e.g., space-tech, agritech, hydrogen).
   - Include 1–2 declining/maturing themes as anchors: `legacy_oil_gas`, `thermal_coal`.

3. **Tier each theme** based on:
   - **structural**: ≥ 15-year horizon, growth ≥ 15% CAGR estimate, ≥ 3 cross-source consensus citations
   - **emerging**: 5–15 year horizon, growth 10–15%, ≥ 2 cross-source citations
   - **maturing**: GDP-like growth (5–10%), saturating
   - **declining**: negative or near-zero growth outlook, regulatory headwinds

4. **Symbol classification** (the heart of this skill):
   - For each NSE symbol the user holds or watchlists (read from `data/refs/symbol_company.json` keys + the user's portfolio if available), determine 1–3 themes the company *primarily* operates in.
   - Use the company's annual report or `https://www.bseindia.com/corporates/anndet_new.aspx` listing description as the source. Do NOT infer themes from price action.
   - Be conservative: a company with 30%+ revenue from a theme can be tagged. Below that, omit.
   - Tag with the strongest theme first, then auxiliary themes.

5. **Validate** the JSON before writing:
   - Every theme has ≥ 1 evidence entry with a public URL
   - Every symbol in `symbol_themes` references theme ids that exist in `themes`
   - Total themes between 12 and 20

6. **Write** to `data/refs/thematic_tailwinds.json` (UTF-8, 2-space indent). Bump `version` (semver: minor for new themes, patch for symbol re-tagging only). Set `generated_at` to current ISO timestamp.

7. **Verify**: run `PATH=/opt/miniconda3/envs/stock-platform/bin:$PATH npx tsx scripts/recompute-compounder.ts` and confirm:
   - No symbol shows "thematic_tailwind: unknown" if it's in the user's portfolio (every held / watchlist name should be tagged).
   - Score deltas vs. previous run are reasonable (no symbol flipping classification by more than one tier).

## Compliance

- All sources are public; no paid APIs, no auth-walled content.
- Per-host 1 req/sec, respect `robots.txt`.
- Don't claim institutional source authority you can't verify — if McKinsey closed a report behind a wall, cite the public abstract page only.

## Idempotence

Re-running the skill with the same source state should produce a near-identical file (modulo the timestamp). Symbol tagging is conservative — don't add or remove tags without an evidence change.

## When to run

- Quarterly or after major macro events that shift theme tiers (e.g., a regulatory shift on EV subsidies, an AI funding surge, a thermal-coal policy move).
- Whenever the user adds a symbol to the portfolio that isn't yet classified.

## Failure modes

- **All sources behind paywalls**: bail with a one-line message; the existing JSON stays in place.
- **Some symbols un-classifiable**: tag what you can, leave the rest out. The factor returns "unknown" for them, contributing a neutral 0.4 score (no penalty, no boost).

## Privacy

This skill operates on public ticker symbols + sector classification only. No personal trade data, no holdings quantities, no auth cookies persisted.
