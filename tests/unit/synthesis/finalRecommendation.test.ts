/**
 * Final Recommendation synthesis — unit coverage.
 *
 * Each test pins one behavioural invariant: a verdict mapping, a risk
 * override, or a confidence rule. The fixtures use synthetic numbers so
 * they're independent of any user data.
 */

import { describe, it, expect } from 'vitest';

import {
  synthesize,
  growthScore,
  summariseFinalActions,
  FINAL_ACTION_PRIORITY,
  type SynthesizeInput,
  type FinalAction,
} from '@/lib/synthesis/finalRecommendation';

function baseInput(overrides: Partial<SynthesizeInput> = {}): SynthesizeInput {
  return {
    symbol: 'ACME-EQ',
    isHolding: true,
    isWatchlist: false,
    positionPct: 0.05,
    sectorWeight: 0.15,
    totalSymbols: 20,
    isLargestHolding: false,
    stalwartAction: 'hold',
    stalwartScore: 0.5,
    compounderClass: 'solid compounder',
    compounderWeightedScore: 0.6,
    cagrAction: 'keep',
    cagrForecast: 0.18,
    thesisVerdict: 'intact',
    growthYearFive: 0.6, // ~9.85% ann.
    growthConfidence: 'medium',
    valuation: null,
    ...overrides,
  };
}

describe('synthesize — happy paths', () => {
  it('all bullish + held → buy_more', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.9,
        cagrAction: 'add',
        cagrForecast: 0.28,
        thesisVerdict: 'intact',
        growthYearFive: 1.6, // ~21% ann.
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('buy_more');
    expect(out.weightedScore).toBeGreaterThanOrEqual(1.5);
    expect(out.confidence).toBe('high');
  });

  it('all bullish + NOT held → enter_position', () => {
    const out = synthesize(
      baseInput({
        isHolding: false,
        positionPct: null,
        stalwartAction: 'fresh_buy',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: 'fresh_buy',
        cagrForecast: 0.25,
        thesisVerdict: 'intact',
        growthYearFive: 1.5,
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('enter_position');
  });

  it('mediocre + intact + neutral CAGR → hold', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'hold',
        compounderClass: 'mediocre',
        compounderWeightedScore: 0.4,
        cagrAction: 'keep',
        thesisVerdict: 'intact',
        growthYearFive: 0.4, // ~7% ann.
      }),
    );
    expect(out.action).toBe('hold');
  });

  it('weakened + trim_25 → sell_partial', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'trim_25',
        compounderClass: 'mediocre',
        cagrAction: 'trim_partial',
        thesisVerdict: 'weakened',
        growthYearFive: 0.1,
      }),
    );
    expect(out.action).toBe('sell_partial');
  });

  it('exit + broken + replace + broken thesis → sell_full', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'exit',
        compounderClass: 'broken',
        cagrAction: 'replace',
        thesisVerdict: 'broken',
        growthYearFive: -0.2,
        growthConfidence: 'high',
      }),
    );
    // Even with broken-thesis cap, sell_full has a lower rank than hold cap,
    // so the action stays at sell_full.
    expect(out.action).toBe('sell_full');
  });
});

describe('synthesize — risk overrides', () => {
  it('single-name > 10% caps buy_more → hold', () => {
    const out = synthesize(
      baseInput({
        positionPct: 0.12,
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.9,
        cagrAction: 'add',
        cagrForecast: 0.28,
        thesisVerdict: 'intact',
        growthYearFive: 1.6,
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('hold');
    expect(out.riskOverrides.some((r) => r.reason.includes('10% guard rail'))).toBe(true);
  });

  it('single-name > 15% forces sell_partial even on bullish votes', () => {
    const out = synthesize(
      baseInput({
        positionPct: 0.18,
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.9,
        cagrAction: 'add',
        cagrForecast: 0.28,
        thesisVerdict: 'intact',
        growthYearFive: 1.6,
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('sell_partial');
    expect(out.riskOverrides.some((r) => r.reason.includes('15% guard rail'))).toBe(true);
  });

  it('sector > 35% on enter_position → hold', () => {
    const out = synthesize(
      baseInput({
        isHolding: false,
        positionPct: null,
        sectorWeight: 0.4,
        stalwartAction: 'fresh_buy',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: 'fresh_buy',
        cagrForecast: 0.25,
        thesisVerdict: 'intact',
        growthYearFive: 1.5,
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('hold');
    expect(out.riskOverrides.some((r) => r.reason.includes('Sector weight'))).toBe(true);
  });

  it('broken thesis caps buy_more → hold even with bullish stalwarts', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add',
        compounderClass: 'solid compounder',
        compounderWeightedScore: 0.7,
        cagrAction: 'add',
        cagrForecast: 0.22,
        thesisVerdict: 'broken',
        growthYearFive: 1.0,
        growthConfidence: 'medium',
      }),
    );
    expect(['hold', 'sell_partial', 'sell_full']).toContain(out.action);
    expect(out.riskOverrides.some((r) => r.reason.toLowerCase().includes('broken'))).toBe(true);
  });

  it('broken compounder also locks buy_more', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add',
        compounderClass: 'broken',
        compounderWeightedScore: 0.2,
        cagrAction: 'add',
        thesisVerdict: 'intact',
        growthYearFive: 0.9,
        growthConfidence: 'medium',
      }),
    );
    expect(out.action).not.toBe('buy_more');
    expect(out.riskOverrides.some((r) => r.reason.toLowerCase().includes('broken'))).toBe(true);
  });

  it('untested + low growth confidence + not held → research first hold', () => {
    const out = synthesize(
      baseInput({
        isHolding: false,
        positionPct: null,
        sectorWeight: 0.1,
        // Need composite >= 1.5 so base action is enter_position; only then
        // does the "research first" override matter. Strongest possible
        // positive signals across all frameworks; growthYearFive set high
        // enough that even halved (low confidence) it still adds +1.
        stalwartAction: 'fresh_buy',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: 'fresh_buy',
        cagrForecast: 0.3,
        thesisVerdict: 'untested',
        growthYearFive: 3.0, // ~31% ann; low conf halves +2 → +1
        growthConfidence: 'low',
        valuation: {
          pe: 22,
          peg: 0.7,
          peVsSectorMedian: 0.9,
          peSectorMedian: 24,
          pe5yMedian: 25,
          pe10yPercentile: 0.3,
        },
      }),
    );
    expect(out.action).toBe('hold');
    expect(out.riskOverrides.some((r) => r.reason.toLowerCase().includes('research first'))).toBe(
      true,
    );
  });

  it('largest holding gate demotes buy_more → hold', () => {
    const out = synthesize(
      baseInput({
        isLargestHolding: true,
        positionPct: 0.09,
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.9,
        cagrAction: 'add',
        cagrForecast: 0.28,
        thesisVerdict: 'intact',
        growthYearFive: 1.6,
        growthConfidence: 'high',
      }),
    );
    expect(out.action).toBe('hold');
    expect(out.riskOverrides.some((r) => r.reason.includes('largest holding'))).toBe(true);
  });
});

describe('synthesize — confidence', () => {
  it('high when ≥4 frameworks agree directionally', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: 'add',
        cagrForecast: 0.25,
        thesisVerdict: 'intact',
        growthYearFive: 1.5,
        growthConfidence: 'high',
      }),
    );
    expect(out.confidence).toBe('high');
  });

  it('low when only 2 frameworks have data', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: null,
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: null,
        cagrForecast: null,
        thesisVerdict: null,
        growthYearFive: 1.5,
        growthConfidence: 'high',
      }),
    );
    expect(out.confidence).toBe('low');
  });

  it('low on strong cross-framework disagreement (5 active, ≥2 each direction)', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add', // +
        compounderClass: 'broken', // -
        compounderWeightedScore: 0.2,
        cagrAction: 'replace', // -
        cagrForecast: 0.05,
        thesisVerdict: 'intact', // +
        growthYearFive: 1.5, // +
        growthConfidence: 'high',
        // Valuation strongly negative → 5 active frameworks with both
        // directions represented (Stalwarts+, Compounder-, Forecast mixed,
        // Research+, Valuation-). Disagreement pulls confidence to low.
        valuation: {
          pe: 200,
          peg: 8,
          peVsSectorMedian: 5,
          peSectorMedian: 40,
          pe5yMedian: 50,
          pe10yPercentile: 0.7,
        },
      }),
    );
    expect(out.confidence).toBe('low');
  });

  it('medium when 3 active with mixed directions but not deeply split', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add', // +
        compounderClass: 'mediocre', // 0
        compounderWeightedScore: 0.4,
        cagrAction: 'trim_partial', // -
        cagrForecast: 0.1,
        thesisVerdict: null,
        growthYearFive: null,
        growthConfidence: null,
      }),
    );
    expect(out.confidence).toBe('medium');
  });
});

describe('growthScore', () => {
  it('returns 0 for null inputs', () => {
    expect(growthScore(null, 'high')).toBe(0);
  });

  it('annualised < 5% → -1', () => {
    // 5y cumulative 0.1 ≈ 1.92% ann
    expect(growthScore(0.1, 'high')).toBe(-1);
  });

  it('annualised 5-15% → 0', () => {
    // 0.5 cumulative ≈ 8.45% ann
    expect(growthScore(0.5, 'high')).toBe(0);
  });

  it('annualised 15-25% → +1', () => {
    // 1.0 cumulative ≈ 14.87% ann (just below 15%) — boundary check
    // 1.2 cumulative ≈ 17.08% ann
    expect(growthScore(1.2, 'high')).toBe(1);
  });

  it('annualised > 25% → +2', () => {
    // 2.5 cumulative ≈ 28.5% ann
    expect(growthScore(2.5, 'high')).toBe(2);
  });

  it('low confidence halves magnitude', () => {
    expect(growthScore(2.5, 'low')).toBe(1); // +2 halved → +1
    // -1 halved → 0 (we coerce -0 → +0 in the impl)
    expect(growthScore(0.1, 'low')).toBe(0);
  });
});

describe('synthesize — abstain handling', () => {
  it('all frameworks null → composite 0 → hold', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: null,
        stalwartScore: null,
        compounderClass: null,
        compounderWeightedScore: null,
        cagrAction: null,
        cagrForecast: null,
        thesisVerdict: null,
        growthYearFive: null,
        growthConfidence: null,
      }),
    );
    expect(out.action).toBe('hold');
    expect(out.weightedScore).toBe(0);
    expect(out.confidence).toBe('low');
  });

  it('partial coverage normalises across active frameworks', () => {
    const out = synthesize(
      baseInput({
        stalwartAction: 'add',
        compounderClass: '7-9x candidate',
        compounderWeightedScore: 0.85,
        cagrAction: null,
        cagrForecast: null,
        thesisVerdict: null,
        growthYearFive: null,
        growthConfidence: null,
      }),
    );
    // Only stalwarts (+2) and compounder (+2) are active. Composite ≈ +2.
    expect(out.weightedScore).toBeGreaterThanOrEqual(1.5);
    expect(out.action).toBe('buy_more');
  });
});

describe('summariseFinalActions', () => {
  it('counts each action bucket', () => {
    const rows: { finalAction: FinalAction }[] = [
      { finalAction: 'buy_more' },
      { finalAction: 'buy_more' },
      { finalAction: 'enter_position' },
      { finalAction: 'hold' },
      { finalAction: 'sell_partial' },
      { finalAction: 'sell_full' },
    ];
    const out = summariseFinalActions(rows);
    expect(out).toEqual({
      buy_more: 2,
      enter_position: 1,
      hold: 1,
      sell_partial: 1,
      sell_full: 1,
    });
  });

  it('empty → all zeros', () => {
    const out = summariseFinalActions([]);
    expect(Object.values(out).every((v) => v === 0)).toBe(true);
  });
});

describe('FINAL_ACTION_PRIORITY ordering', () => {
  it('matches the spec sort default', () => {
    expect(FINAL_ACTION_PRIORITY.enter_position).toBe(0);
    expect(FINAL_ACTION_PRIORITY.buy_more).toBe(1);
    expect(FINAL_ACTION_PRIORITY.hold).toBe(2);
    expect(FINAL_ACTION_PRIORITY.sell_partial).toBe(3);
    expect(FINAL_ACTION_PRIORITY.sell_full).toBe(4);
  });
});
