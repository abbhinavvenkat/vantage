---
name: stalwart-profile-update
description: Regenerate data/investor_stalwarts/<slug>.md from the latest distilled JSON, preserving HUMAN-EDITED markers. Idempotent.
triggers:
  - "/stalwart-profile-update <slug>"
inputs:
  investor_slug: "string"
outputs:
  - data/investor_stalwarts/<slug>.md   ✅ COMMITTED
---

# stalwart-profile-update

Surgical regeneration of the curated investor profile. Use when `data/codex/distilled/<slug>.json` has updated but you don't want to re-run the whole `codex-distill` pipeline.

## Procedure

1. Read `.claude/rules/codex-investors.yml` for this slug's metadata.
2. Read `data/codex/distilled/<slug>.json`. If missing → exit with "Run /codex-distill first".
3. Read existing `data/investor_stalwarts/<slug>.md` if present.
4. Capture content between `<!-- HUMAN-EDITED:START -->` and `<!-- HUMAN-EDITED:END -->` markers verbatim.
5. Re-render the profile per `.claude/rules/codex-rule-schema.md` §3 template.
6. Re-insert the captured human content.
7. Bump `last_updated` in YAML frontmatter.
8. Write file (overwrite).

## Invariants

- Never lose human-edited content. If markers are missing in the existing file, add empty markers and preserve nothing (the file pre-dated marker convention).
- Never invent quotes. Every cited quote in the MD must exist verbatim in `data/codex/distilled/<slug>.json`.
- Always include the four required sections even if the distilled JSON is sparse: Snapshot, Investing Style & Edge, Core Principles, Sources. Sparse sections become "_(insufficient corpus — run /codex-fetch <slug> with more seed URLs)_".
