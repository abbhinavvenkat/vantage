/**
 * Unit tests for the previously-silent valuation conditions in the decision
 * scoring engine. Each test pins a single rule in a tiny library and verifies
 * `ruleApplies` fires only when the corresponding SymbolState input clears
 * the gate.
 */

import { describe, it, expect } from 'vitest';

import { scoreSymbol, type SymbolState } from '@/lib/decisions/score';
import type { RuleLibrary, SynthesizedRule } from '@/lib/codex/synthesize';

function lib(rule: SynthesizedRule): RuleLibrary {
  return {
    version: 'test',
    generated_at: '2026-05-04T00:00:00.000Z',
    rules: [rule],
  };
}

const baseState: SymbolState = {
  symbol: 'TEST',
  netQty: 0,
  thesisIntact: true,
};

const baseRule = (overrides: Partial<SynthesizedRule>): SynthesizedRule => ({
  id: 'rule.test',
  statement: 'test',
  action: 'fresh_buy',
  conditions: {},
  supporting_investors: [{ investor: 'lynch', rule_ids: [] }],
  counterexamples: [],
  weight: 1.0,
  evidence_strength: 'strong',
  rationale_md: '',
  citations: [],
  ...overrides,
});

describe('valuation gate: max_peg', () => {
  it('rule fires when PEG ≤ threshold', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 18, peg: 0.7 },
      lib(baseRule({ conditions: { valuation: { max_peg: 0.8 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(1);
  });

  it('rule does NOT fire when PEG > threshold', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 50, peg: 1.5 },
      lib(baseRule({ conditions: { valuation: { max_peg: 0.8 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });

  it('rule does NOT fire when PEG is missing (cannot verify)', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 50 },
      lib(baseRule({ conditions: { valuation: { max_peg: 0.8 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: min_eyield_minus_gsec', () => {
  it('rule fires when (1/PE − gsec) ≥ threshold', () => {
    // earnings yield 6.67%, gsec 7% → diff -0.33%; threshold 0.03 (3%) → no fire.
    // Provide a state where eyield-gsec = 0.04 (above 0.03 threshold).
    const r = scoreSymbol(
      { ...baseState, pe: 9, earningsYieldMinusGsec: 0.04 },
      lib(baseRule({ conditions: { valuation: { min_eyield_minus_gsec: 0.03 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(1);
  });

  it('rule does NOT fire when premium below threshold', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 50, earningsYieldMinusGsec: -0.05 },
      lib(baseRule({ conditions: { valuation: { min_eyield_minus_gsec: 0.03 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: pe_above_5y_median_pct (trim-side)', () => {
  it('trim_25 fires when current PE is 50%+ above 5y median', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100, pe: 60, pe5yMedian: 30 },
      lib(
        baseRule({ action: 'trim_25', conditions: { valuation: { pe_above_5y_median_pct: 0.5 } } }),
      ),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(1);
  });

  it('trim_25 does NOT fire when PE is near 5y median', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100, pe: 32, pe5yMedian: 30 },
      lib(
        baseRule({ action: 'trim_25', conditions: { valuation: { pe_above_5y_median_pct: 0.5 } } }),
      ),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });

  it('non-trim rule with same condition does not fire (purely informational)', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100, pe: 60, pe5yMedian: 30 },
      lib(baseRule({ action: 'add', conditions: { valuation: { pe_above_5y_median_pct: 0.5 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: pe_percentile_10y_max (trim-side)', () => {
  it('trim_50 fires when PE is in top 20% of own 10y range', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100, pe: 80, pe10yPercentile: 0.92 },
      lib(
        baseRule({ action: 'trim_50', conditions: { valuation: { pe_percentile_10y_max: 0.8 } } }),
      ),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(1);
  });

  it('trim_50 does NOT fire when PE percentile is below threshold', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100, pe: 30, pe10yPercentile: 0.55 },
      lib(
        baseRule({ action: 'trim_50', conditions: { valuation: { pe_percentile_10y_max: 0.8 } } }),
      ),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: discount_to_intrinsic_min', () => {
  it('rule does NOT fire (no DCF model) — was previously firing-for-everyone', () => {
    const r = scoreSymbol(
      baseState,
      lib(baseRule({ conditions: { valuation: { discount_to_intrinsic_min: 0.2 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: dcf_floor_required', () => {
  it('rule does NOT fire (no DCF model)', () => {
    const r = scoreSymbol(
      { ...baseState, netQty: 100 },
      lib(
        baseRule({
          action: 'hold',
          conditions: { valuation: { dcf_floor_required: true } },
        }),
      ),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});

describe('valuation gate: max_pb', () => {
  it('rule fires when P/B ≤ ceiling', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 8, pb: 0.9 },
      lib(baseRule({ conditions: { valuation: { max_pb: 1, max_pe: 12 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(1);
  });

  it('rule does NOT fire when P/B too high', () => {
    const r = scoreSymbol(
      { ...baseState, pe: 8, pb: 3.5 },
      lib(baseRule({ conditions: { valuation: { max_pb: 1, max_pe: 12 } } })),
      { lynch: 1 },
    );
    expect(r.fired).toHaveLength(0);
  });
});
