import { describe, it, expect } from 'vitest';

import { scoreSymbol, type SymbolState } from '@/lib/decisions/score';
import type { RuleLibrary, SynthesizedRule } from '@/lib/codex/synthesize';

function rule(partial: Partial<SynthesizedRule>): SynthesizedRule {
  return {
    id: partial.id ?? 'rule.test.x',
    statement: partial.statement ?? 's',
    action: partial.action ?? 'fresh_buy',
    conditions: partial.conditions ?? {},
    supporting_investors: partial.supporting_investors ?? [{ investor: 'buffett', rule_ids: [] }],
    counterexamples: partial.counterexamples ?? [],
    weight: partial.weight ?? 0.6,
    evidence_strength: partial.evidence_strength ?? 'moderate',
    rationale_md: partial.rationale_md ?? '',
    citations: partial.citations ?? [],
  };
}

function lib(rules: SynthesizedRule[]): RuleLibrary {
  return { version: '0.1.0', generated_at: '2026-05-03T00:00:00Z', rules };
}

describe('scoreSymbol', () => {
  it('returns "hold" with no fired rules for a symbol with no signals', () => {
    const r = rule({
      id: 'r1',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.5 } },
    });
    const state: SymbolState = {
      symbol: 'ACME',
      netQty: 0,
      currentPrice: 100,
      high52w: 100, // 0% drawdown -> rule should NOT fire
    };
    const result = scoreSymbol(state, lib([r]), { buffett: 1 });
    expect(result.action).toBe('hold');
    expect(result.fired.length).toBe(0);
  });

  it('fires a fresh_buy rule when drawdown threshold is met for a non-held symbol', () => {
    // Three high-weight buy rules so the buy bucket clears the not-held
    // FRESH_BUY_FLOOR (1.5). A single 0.7-weight rule is intentionally not
    // enough — see lib/decisions/score.ts.
    const r1 = rule({
      id: 'r.buy.a',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.2 } },
      weight: 0.7,
    });
    const r2 = rule({
      id: 'r.buy.b',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.2 } },
      weight: 0.6,
    });
    const r3 = rule({
      id: 'r.buy.c',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.2 } },
      weight: 0.5,
    });
    const state: SymbolState = {
      symbol: 'ACME',
      netQty: 0,
      currentPrice: 70,
      high52w: 100, // -30% drawdown
    };
    const result = scoreSymbol(state, lib([r1, r2, r3]), { buffett: 1 });
    expect(result.action).toBe('fresh_buy');
    expect(result.fired.map((f) => f.ruleId)).toContain('r.buy.a');
    expect(result.score).toBeGreaterThan(0);
  });

  it('picks the higher-weighted action when multiple rules fire on a held position', () => {
    const holdRule = rule({
      id: 'r.hold',
      action: 'hold',
      conditions: { time_in_position: { min_months_held: 6 } },
      weight: 0.4,
    });
    const trimRule = rule({
      id: 'r.trim',
      action: 'trim_50',
      conditions: { narrative: { thesis_intact: true } },
      weight: 0.9,
    });
    const state: SymbolState = {
      symbol: 'ACME',
      netQty: 100,
      currentPrice: 50,
      high52w: 100,
      monthsHeld: 24,
      thesisIntact: true,
    };
    const result = scoreSymbol(state, lib([holdRule, trimRule]), { buffett: 1 });
    const firedIds = result.fired.map((f) => f.ruleId);
    expect(firedIds).toContain('r.trim');
    expect(firedIds).toContain('r.hold');
    expect(result.action).toBe('trim_50');
  });

  it('amplifies a rule when supporting investor has higher style weight', () => {
    // Use a held position so we observe `add` (non-floored) winning;
    // style-weight comparison is what the test actually exercises.
    const r = rule({
      id: 'r.buy',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.2 } },
      weight: 0.5,
      supporting_investors: [{ investor: 'buffett', rule_ids: [] }],
    });
    const state: SymbolState = {
      symbol: 'ACME',
      netQty: 100,
      currentPrice: 70,
      high52w: 100,
    };
    const evenWeights = { buffett: 0.5, marks: 0.5 };
    const buffettHeavy = { buffett: 1, marks: 0 };

    const evenResult = scoreSymbol(state, lib([r]), evenWeights);
    const heavyResult = scoreSymbol(state, lib([r]), buffettHeavy);
    expect(heavyResult.score).toBeGreaterThan(evenResult.score);
  });

  it('routes fresh_buy contributions into "add" for held positions (regression: previously muted)', () => {
    // Before the fix: a held position would mute all fresh_buy votes and the
    // tiny hold prior (0.05) would win → "hold". After the fix: fresh_buy
    // contributions are folded into the add bucket, so a strong fresh_buy
    // signal on a held symbol now wins as "add".
    const buyRule = rule({
      id: 'r.fresh_buy',
      action: 'fresh_buy',
      conditions: { price_action: { max_drawdown_from_52w_high: -0.2 } },
      weight: 0.7,
    });
    const heldState: SymbolState = {
      symbol: 'ACME',
      netQty: 100,
      currentPrice: 70,
      high52w: 100, // -30% drawdown
    };
    const result = scoreSymbol(heldState, lib([buyRule]), { buffett: 1 });
    expect(result.fired.map((f) => f.ruleId)).toContain('r.fresh_buy');
    // The fresh_buy rule's contribution lives in perAction.fresh_buy
    // (granular storage preserved) but the winning action is "add" because
    // selection logic uses the unified buy-more bucket.
    expect(result.perAction.fresh_buy).toBeGreaterThan(0);
    expect(result.action).toBe('add');
    expect(result.score).toBeGreaterThan(0);
  });

  it('fires a red-flag rule WHEN promoter pledge is true (regression: bug was inverted)', () => {
    // Rule: avoid leverage / promoter pledge → action = exit.
    // It must fire when promoter_pledge=TRUE on the symbol, not when it is false.
    const exitRule = rule({
      id: 'r.redflag',
      action: 'exit',
      conditions: { narrative: { promoter_pledge: true } },
      weight: 0.9,
    });
    const holdRule = rule({
      id: 'r.hold',
      action: 'hold',
      conditions: { time_in_position: { min_months_held: 6 } },
      weight: 0.2,
    });

    const flagged: SymbolState = {
      symbol: 'ACME',
      netQty: 100,
      promoterPledge: true,
      monthsHeld: 24,
    };
    const clean: SymbolState = {
      symbol: 'ACME',
      netQty: 100,
      promoterPledge: false,
      monthsHeld: 24,
    };

    const flaggedRes = scoreSymbol(flagged, lib([exitRule, holdRule]), { buffett: 1 });
    const cleanRes = scoreSymbol(clean, lib([exitRule, holdRule]), { buffett: 1 });

    expect(flaggedRes.fired.map((f) => f.ruleId)).toContain('r.redflag');
    expect(flaggedRes.action).toBe('exit');
    expect(cleanRes.fired.map((f) => f.ruleId)).not.toContain('r.redflag');
    expect(cleanRes.action).not.toBe('exit');
  });
});
