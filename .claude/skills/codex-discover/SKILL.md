---
name: codex-discover
description: Scan extracted educator transcripts (Shankar Nath etc.) for mentioned investors; output a discovery file with suggested seed URLs for human approval. Never auto-appends to codex-investors.yml.
triggers:
  - "/codex-discover <educator-slug>"
inputs:
  educator_slug: "string — slug whose discovery_mode is 'youtube-referenced'"
outputs:
  - data/codex/discovery/<educator-slug>.json
---

# codex-discover

Mine educator content for the next batch of investors to add to the codex.

## Procedure

1. Validate the educator slug has `discovery_mode: youtube-referenced` in `.claude/rules/codex-investors.yml`. Otherwise abort with explanation.
2. Read all markdown under `data/codex/extracted/<educator-slug>/`.
3. Build a candidate-investor list:
   - Named-entity recognition for PERSON entities (use a simple pattern + small curated allow-list of investing-context cues: "fund manager", "portfolio manager", "investor", "wrote", "manages", etc.). Skip pure celebrities.
   - Cross-check against existing slugs in `codex-investors.yml`. Skip those already covered.
4. For each candidate, gather:
   - Mention count
   - Top 3 contexts (source filename + paragraph anchor + ±2-sentence quote)
   - Suggested seed URLs (do a non-fetching guess: `https://www.youtube.com/results?search_query=<name>+interview`, plus a domain guess if a fund name appeared near the mention).
   - Suggested style tags inferred from surrounding text.
   - Suggested priority (default 3).
5. Write `data/codex/discovery/<educator-slug>.json` per the schema in `.claude/rules/codex-rule-schema.md` §4.

## Approval gate

This skill **NEVER** appends to `.claude/rules/codex-investors.yml`. It only emits a JSON proposal. Adding entries to the YAML is an explicit human action (or a separate `codex-discover-approve` skill not yet implemented).

## Quality

- Filter false positives: drop names mentioned only once unless context is strongly investing-related.
- Drop already-covered investors (case-insensitive name match against YAML `name` field).
- Preserve original quote casing/spelling.
