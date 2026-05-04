/**
 * Unit tests for the new Compounder Thesis "Valuation discipline" factor.
 * Three calibration axes (PEG, sector PE, own-history PE) each vote
 * pass/partial/fail; the verdict is the majority with a worst-axis veto for
 * 10y-percentile ≥ 0.85.
 */

import { describe, it, expect } from 'vitest';

import { computeCompounderProfile } from '@/lib/compounder/score';

const baseInput = {
  symbol: 'TEST',
  sector: 'Software Services',
  fundamentals: null,
  firedRules: [],
};

function getValuationVerdict(profile: ReturnType<typeof computeCompounderProfile>) {
  const f = profile.factors.find((x) => x.factor.id === 'valuation');
  if (!f) throw new Error('no valuation factor');
  return f.verdict;
}

describe('evalValuation', () => {
  it('returns unknown when no valuation context provided', () => {
    const p = computeCompounderProfile(baseInput);
    const v = getValuationVerdict(p);
    expect(v.status).toBe('unknown');
  });

  it('PASSES when PEG ≤ 1, PE ≤ 1.3× sector, PE ≤ 1.2× own median', () => {
    const p = computeCompounderProfile({
      ...baseInput,
      valuation: {
        pe: 30,
        peg: 0.9,
        peVsSectorMedian: 1.1,
        peSectorMedian: 27,
        pe5yMedian: 28,
        pe10yPercentile: 0.4,
        earningsYieldMinusGsec: 0.05,
      },
    });
    expect(getValuationVerdict(p).status).toBe('pass');
  });

  it('FAILS when PE ≥ 85th percentile of own 10y range (veto)', () => {
    const p = computeCompounderProfile({
      ...baseInput,
      valuation: {
        pe: 60,
        peg: 0.5, // PEG would normally pass …
        peVsSectorMedian: 1.0, // sector would normally pass …
        peSectorMedian: 60,
        pe5yMedian: 35,
        pe10yPercentile: 0.92, // … but top-15% percentile vetoes them.
        earningsYieldMinusGsec: 0.01,
      },
    });
    expect(getValuationVerdict(p).status).toBe('fail');
  });

  it('FAILS when PEG and sector both fail', () => {
    const p = computeCompounderProfile({
      ...baseInput,
      valuation: {
        pe: 200,
        peg: 8.0, // way ahead of growth
        peVsSectorMedian: 5.0, // 5× the sector median
        peSectorMedian: 40,
        pe5yMedian: null,
        pe10yPercentile: null,
        earningsYieldMinusGsec: -0.06,
      },
    });
    expect(getValuationVerdict(p).status).toBe('fail');
  });

  it('PARTIAL when one axis is partial and rest are missing', () => {
    const p = computeCompounderProfile({
      ...baseInput,
      valuation: {
        pe: 50,
        peg: 1.3, // partial axis
        peVsSectorMedian: null,
        peSectorMedian: null,
        pe5yMedian: null,
        pe10yPercentile: null,
        earningsYieldMinusGsec: null,
      },
    });
    expect(getValuationVerdict(p).status).toBe('partial');
  });

  it('UNKNOWN when all three axes lack data', () => {
    const p = computeCompounderProfile({
      ...baseInput,
      valuation: {
        pe: null,
        peg: null,
        peVsSectorMedian: null,
        peSectorMedian: null,
        pe5yMedian: null,
        pe10yPercentile: null,
        earningsYieldMinusGsec: null,
      },
    });
    expect(getValuationVerdict(p).status).toBe('unknown');
  });
});

describe('factor weights still sum to 1.0 with valuation added', () => {
  it('total weight equals 1.0 ± 0.001', () => {
    const p = computeCompounderProfile(baseInput);
    const total = p.factors.reduce((s, f) => s + f.factor.weight, 0);
    expect(Math.abs(total - 1.0)).toBeLessThan(0.001);
  });

  it('valuation factor exists with weight 0.10', () => {
    const p = computeCompounderProfile(baseInput);
    const v = p.factors.find((f) => f.factor.id === 'valuation');
    expect(v).toBeDefined();
    expect(v!.factor.weight).toBeCloseTo(0.1, 5);
  });
});
