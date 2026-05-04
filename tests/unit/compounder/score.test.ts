import { describe, expect, it, beforeEach } from 'vitest';

import { _resetCachesForTest } from '@/lib/compounder/factors';
import {
  blendedCagr,
  classify,
  computeCompounderProfile,
  impliedAnnualisedCagr,
  tenYearMultiple,
} from '@/lib/compounder/score';
import type { Fundamentals } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';

beforeEach(() => {
  _resetCachesForTest();
});

const compounderFund: Fundamentals = {
  symbol: 'COMP',
  annual: {
    FY2020: {
      sales_cr: 100,
      ebitda_cr: 25,
      pat_cr: 15,
      roce_pct: 25,
      equity_bv_cr: 80,
      cfo_cr: 14,
      debt_to_equity: 0.1,
    },
    FY2021: {
      sales_cr: 120,
      ebitda_cr: 31,
      pat_cr: 19,
      roce_pct: 27,
      equity_bv_cr: 92,
      cfo_cr: 17,
      debt_to_equity: 0.1,
    },
    FY2022: {
      sales_cr: 145,
      ebitda_cr: 38,
      pat_cr: 23,
      roce_pct: 28,
      equity_bv_cr: 108,
      cfo_cr: 20,
      debt_to_equity: 0.1,
    },
    FY2023: {
      sales_cr: 173,
      ebitda_cr: 47,
      pat_cr: 29,
      roce_pct: 30,
      equity_bv_cr: 128,
      cfo_cr: 25,
      debt_to_equity: 0.05,
    },
    FY2024: {
      sales_cr: 207,
      ebitda_cr: 58,
      pat_cr: 36,
      roce_pct: 32,
      equity_bv_cr: 150,
      cfo_cr: 31,
      debt_to_equity: 0.05,
    },
    FY2025: {
      sales_cr: 248,
      ebitda_cr: 70,
      pat_cr: 45,
      roce_pct: 33,
      equity_bv_cr: 175,
      cfo_cr: 38,
      debt_to_equity: 0.05,
    },
  },
  current: { pe: 35 },
};

const brokenFund: Fundamentals = {
  symbol: 'BAD',
  annual: {
    FY2020: {
      sales_cr: 100,
      ebitda_cr: 8,
      pat_cr: 5,
      roce_pct: 7,
      equity_bv_cr: 80,
      cfo_cr: 1,
      debt_to_equity: 1.5,
    },
    FY2021: {
      sales_cr: 102,
      ebitda_cr: 7,
      pat_cr: 4,
      roce_pct: 6,
      equity_bv_cr: 95,
      cfo_cr: 0,
      debt_to_equity: 1.6,
    },
    FY2022: {
      sales_cr: 99,
      ebitda_cr: 5,
      pat_cr: 3,
      roce_pct: 5,
      equity_bv_cr: 110,
      cfo_cr: -2,
      debt_to_equity: 1.7,
    },
    FY2023: {
      sales_cr: 95,
      ebitda_cr: 3,
      pat_cr: 2,
      roce_pct: 4,
      equity_bv_cr: 125,
      cfo_cr: -3,
      debt_to_equity: 1.8,
    },
    FY2024: {
      sales_cr: 92,
      ebitda_cr: 2,
      pat_cr: 1,
      roce_pct: 3,
      equity_bv_cr: 140,
      cfo_cr: -5,
      debt_to_equity: 2.0,
    },
    FY2025: {
      sales_cr: 90,
      ebitda_cr: 1,
      pat_cr: 1,
      roce_pct: 2,
      equity_bv_cr: 155,
      cfo_cr: -6,
      debt_to_equity: 2.1,
    },
  },
  current: { pe: 80 },
};

function fired(
  action: FiredRule['action'],
  weight: number,
  tags: string[],
): FiredRule & { tags: string[] } {
  return {
    ruleId: `r.${action}.${tags[0]}`,
    action,
    weight,
    baseWeight: weight,
    styleScale: 1,
    tags,
  };
}

describe('classify', () => {
  it('maps weighted scores to classifications', () => {
    expect(classify(0.85)).toBe('7-9x candidate');
    expect(classify(0.75)).toBe('7-9x candidate');
    expect(classify(0.6)).toBe('solid compounder');
    expect(classify(0.4)).toBe('mediocre');
    expect(classify(0.2)).toBe('broken');
  });
});

describe('impliedAnnualisedCagr', () => {
  it('clamps and interpolates linearly', () => {
    expect(impliedAnnualisedCagr(1.0)).toBeCloseTo(0.25, 6);
    expect(impliedAnnualisedCagr(0.0)).toBeCloseTo(0.06, 6);
    expect(impliedAnnualisedCagr(0.5)).toBeCloseTo(0.155, 6);
  });
  it('classifies 0.78 score around the 7-9x bar', () => {
    const cagr = impliedAnnualisedCagr(0.78);
    const tenX = tenYearMultiple(cagr);
    expect(cagr).toBeGreaterThan(0.2);
    expect(tenX).toBeGreaterThan(6); // ~7x territory
  });
});

describe('tenYearMultiple', () => {
  it('25% over 10y is ~9.3x', () => {
    expect(tenYearMultiple(0.25)).toBeCloseTo(9.31, 1);
  });
  it('20% over 10y is ~6.2x', () => {
    expect(tenYearMultiple(0.2)).toBeCloseTo(6.19, 1);
  });
});

describe('blendedCagr', () => {
  it('returns profileCagr when forecast missing', () => {
    expect(blendedCagr(0.22, null)).toBeCloseTo(0.22, 6);
  });
  it('averages annualised forecast with profile', () => {
    // 5y forecast 0.6 (cumulative) → ann = 1.6^(1/5)-1 ≈ 0.0986
    // 0.5*0.22 + 0.5*0.0986 ≈ 0.1593
    expect(blendedCagr(0.22, 0.6)).toBeCloseTo(0.1593, 3);
  });
});

describe('computeCompounderProfile — integration', () => {
  it('classifies a quality compounder as 7-9x or solid', () => {
    const p = computeCompounderProfile({
      symbol: 'COMP',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [fired('hold', 0.7, ['quality', 'compounder'])],
    });
    expect(p.passCount).toBeGreaterThanOrEqual(7);
    expect(p.failCount).toBe(0);
    expect(p.weightedScore).toBeGreaterThan(0.75);
    expect(p.classification).toBe('7-9x candidate');
    expect(p.estimatedTenYearReturn).toBeGreaterThan(6);
  });

  it('classifies a broken stock as broken', () => {
    const p = computeCompounderProfile({
      symbol: 'BAD',
      sector: 'Realty', // hard-cyclical fail
      fundamentals: brokenFund,
      firedRules: [fired('exit', 0.8, ['red_flag', 'governance'])],
    });
    expect(p.failCount).toBeGreaterThanOrEqual(5);
    expect(p.weightedScore).toBeLessThan(0.35);
    expect(p.classification).toBe('broken');
  });

  it('produces caveats listing every unknown factor', () => {
    const p = computeCompounderProfile({
      symbol: 'NODATA',
      sector: 'Unmapped',
      fundamentals: null,
      firedRules: [],
    });
    expect(p.unknownCount).toBeGreaterThan(5);
    expect(p.caveats.length).toBe(p.unknownCount);
  });

  it('always returns 12 factor verdicts', () => {
    const p = computeCompounderProfile({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: null,
      firedRules: [],
    });
    expect(p.factors.length).toBe(12);
  });

  it('weightedScore is bounded in [0,1]', () => {
    const p1 = computeCompounderProfile({
      symbol: 'X',
      sector: 'Software Services',
      fundamentals: compounderFund,
      firedRules: [fired('hold', 1, ['quality'])],
    });
    const p2 = computeCompounderProfile({
      symbol: 'Y',
      sector: 'Realty',
      fundamentals: brokenFund,
      firedRules: [],
    });
    expect(p1.weightedScore).toBeLessThanOrEqual(1);
    expect(p1.weightedScore).toBeGreaterThanOrEqual(0);
    expect(p2.weightedScore).toBeLessThanOrEqual(1);
    expect(p2.weightedScore).toBeGreaterThanOrEqual(0);
  });
});
