---
name: codex-distill
description: For one investor, read extracted markdown and emit (a) data/codex/distilled/<slug>.json structured per codex-rule-schema.md, and (b) regenerate data/investor_stalwarts/<slug>.md curated profile preserving HUMAN-EDITED markers.
triggers:
  - "/codex-distill <slug>"
inputs:
  investor_slug: "string"
  re_distill: "boolean (default false) — re-process even if distilled.json is current"
outputs:
  - data/codex/distilled/<slug>.json
  - data/investor_stalwarts/<slug>.md   ✅ COMMITTED
---

# codex-distill

Read every extracted markdown for an investor and produce a structured distillation + a human-readable curated profile.

## Procedure

1. Read `.claude/rules/codex-investors.yml` entry for this slug (style_tags, geo, license_note).
2. Read `.claude/rules/codex-rule-schema.md` §1 (distilled JSON) and §3 (Stalwart Profile MD).
3. Read all `data/codex/extracted/<slug>/*.md` — these are the only allowed source for citations.
4. Reason over the corpus and emit `data/codex/distilled/<slug>.json` per §1. Every entry MUST cite a real `source_url`, `quote`, and `page_or_anchor` that exists in the extracted markdown. NO hallucinated citations.
5. Regenerate `data/investor_stalwarts/<slug>.md` per §3:
   - Read the existing file if present.
   - Capture content between `<!-- HUMAN-EDITED:START -->` and `<!-- HUMAN-EDITED:END -->` markers verbatim.
   - Re-write everything OUTSIDE those markers from the freshly distilled JSON.
   - Bump `last_updated` in YAML frontmatter.
   - Always include the markers (empty if not yet edited) so future runs preserve human contributions.

## Quality bar

- Every quote in the MD must be ≤3 sentences (fair use; full text lives in `data/codex/extracted/`).
- Every quote must be exact (verbatim from extracted markdown).
- Every cited URL must appear in `data/codex/raw/<slug>/manifest.json`.
- If the corpus is sparse (< 3 source documents), output a partial profile with `## Snapshot` only and `## Status: Insufficient corpus — fetch more sources` — do not invent content.

## Anti-hallucination

- If you cannot find a quote supporting a claim, DROP the claim. Do NOT paraphrase a generic principle without a real citation from this investor.
- For investors with `license_note: "Citations only"`, the distilled JSON may include book-derived principles ONLY if you have a verifiable secondary citation (e.g., a public interview where the investor states the principle). Otherwise drop.
