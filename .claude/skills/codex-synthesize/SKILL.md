---
name: codex-synthesize
description: Cross-investor merge of all data/codex/distilled/*.json into a versioned Rule Library at data/codex/synthesized/v{semver}.json.
triggers:
  - "/codex-synthesize"
inputs:
  bump: "string — major|minor|patch (default minor)"
  notes: "string — release notes for this version"
outputs:
  - data/codex/synthesized/v{semver}.json
  - data/codex/synthesized/index.json
---

# codex-synthesize

Merge per-investor distillations into a single weighted rule library that the app's `/decisions` page consumes.

## Procedure

1. Read the latest version semver from `data/codex/synthesized/index.json`. Apply `bump`.
2. Load every `data/codex/distilled/*.json`.
3. Cluster rules across investors by semantic similarity (action + conditions overlap). Within each cluster:
   - Create one synthesized rule per `.claude/rules/codex-rule-schema.md` §2.
   - `supporting_investors[]` = all distilled rules in the cluster.
   - `weight` = base weight (number of supporters / total investors in cluster) × evidence multiplier × any backtest weight from previous version.
   - `evidence_strength` = strong if ≥3 investors agree with explicit quantitative criteria; moderate if ≥2; weak if only 1 source or qualitative-only.
   - `counterexamples[]` = any distilled rule whose action contradicts the cluster's action (preserved, not discarded).
4. Conflicting clusters (e.g., "concentration ≥50% in top 3" vs "diversify across 30+ names") are kept as separate rules, both with their citations. Resolution happens in `lib/codex/ruleEngine.ts` via `user_style_profile`.
5. Write `data/codex/synthesized/v{semver}.json` per §2.
6. Update `data/codex/synthesized/index.json`:
   ```json
   { "current": "0.2.0", "history": [{ "version": "0.2.0", "generated_at": "...", "n_rules": 87, "notes": "..." }] }
   ```

## Quality

- Every synthesized rule must have ≥1 supporting investor with a real citation.
- Rules with `weight < 0.1` are dropped from the library (they'll re-emerge if more evidence accrues).
- Rationale_md explains *why* this rule is in the library, citing the convergence pattern.
