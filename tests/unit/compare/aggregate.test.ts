import { describe, expect, it } from 'vitest';

import {
  MAX_COMPARE_SYMBOLS,
  buildCompareColumn,
  parseSymbolsParam,
  type CompareInputs,
} from '@/lib/compare/aggregate';

function baseInputs(overrides: Partial<CompareInputs> = {}): CompareInputs {
  return {
    symbol: 'ACME-EQ',
    sector: 'Software Services',
    inPortfolio: false,
    inWatchlist: false,
    position: null,
    latestPrice: null,
    stats: null,
    arSummary: null,
    concall: null,
    stressTest: null,
    asOfDate: '2026-05-03',
    ...overrides,
  };
}

describe('parseSymbolsParam', () => {
  it('returns empty list for undefined or empty input', () => {
    expect(parseSymbolsParam(undefined)).toEqual([]);
    expect(parseSymbolsParam('')).toEqual([]);
    expect(parseSymbolsParam(',,,')).toEqual([]);
  });

  it('splits, trims, uppercases, and dedupes', () => {
    expect(parseSymbolsParam(' bel , hdfcbank,BEL , eichermot ')).toEqual([
      'BEL',
      'HDFCBANK',
      'EICHERMOT',
    ]);
  });

  it('caps at MAX_COMPARE_SYMBOLS', () => {
    const many = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].join(',');
    const got = parseSymbolsParam(many);
    expect(got).toHaveLength(MAX_COMPARE_SYMBOLS);
    expect(got).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('handles array form (Next.js may pass string[])', () => {
    expect(parseSymbolsParam(['BEL,HDFCBANK', 'TCS'])).toEqual(['BEL', 'HDFCBANK', 'TCS']);
  });
});

describe('buildCompareColumn — missing data', () => {
  it('returns null position, empty fundamentals, null concall/stressTest when only symbol is known', () => {
    const col = buildCompareColumn(baseInputs());
    expect(col.symbol).toBe('ACME-EQ');
    expect(col.sector).toBe('Software Services');
    expect(col.position).toBeNull();
    expect(col.fundamentals).toEqual([]);
    expect(col.fundamentalsFy).toBeNull();
    expect(col.concall).toBeNull();
    expect(col.stressTest).toBeNull();
    expect(col.price.cmp).toBeNull();
    expect(col.price.distanceFromHighPct).toBeNull();
    expect(col.price.high52w).toBeNull();
    expect(col.price.low52w).toBeNull();
    expect(col.price.avgVolume30d).toBeNull();
  });

  it('computes distanceFromHighPct only when both cmp and high52w present', () => {
    const cmpOnly = buildCompareColumn(
      baseInputs({
        latestPrice: { symbol: 'ACME-EQ', close: 100, date: '2026-05-02' },
      }),
    );
    expect(cmpOnly.price.cmp).toBe(100);
    expect(cmpOnly.price.distanceFromHighPct).toBeNull();

    const both = buildCompareColumn(
      baseInputs({
        latestPrice: { symbol: 'ACME-EQ', close: 80, date: '2026-05-02' },
        stats: { high52w: 100, low52w: 50, avgVolume30d: 1000 },
      }),
    );
    expect(both.price.distanceFromHighPct).toBeCloseTo(-0.2, 6);
    expect(both.price.high52w).toBe(100);
    expect(both.price.avgVolume30d).toBe(1000);
  });
});

describe('buildCompareColumn — position math', () => {
  it('computes mv / pnl / pct / holding period when held with cmp available', () => {
    const col = buildCompareColumn(
      baseInputs({
        inPortfolio: true,
        position: {
          symbol: 'ACME-EQ',
          qty: 10,
          costBasis: 1000,
          avgCost: 100,
          firstBuyDate: '2026-01-01',
          lots: [{ qty: 10, costPerShare: 100, date: '2026-01-01' }],
        },
        latestPrice: { symbol: 'ACME-EQ', close: 150, date: '2026-05-03' },
        asOfDate: '2026-05-03',
      }),
    );
    expect(col.position).not.toBeNull();
    expect(col.position!.qty).toBe(10);
    expect(col.position!.avgCost).toBe(100);
    expect(col.position!.costBasis).toBe(1000);
    expect(col.position!.marketValue).toBe(1500);
    expect(col.position!.unrealizedPnl).toBe(500);
    expect(col.position!.pctReturn).toBeCloseTo(50, 6);
    expect(col.position!.holdingPeriodDays).toBe(122);
  });

  it('null mv/pnl when cmp missing but qty/avg still surface', () => {
    const col = buildCompareColumn(
      baseInputs({
        inPortfolio: true,
        position: {
          symbol: 'ACME-EQ',
          qty: 5,
          costBasis: 500,
          avgCost: 100,
          firstBuyDate: '2026-04-15',
          lots: [{ qty: 5, costPerShare: 100, date: '2026-04-15' }],
        },
        asOfDate: '2026-05-03',
      }),
    );
    expect(col.position!.marketValue).toBeNull();
    expect(col.position!.unrealizedPnl).toBeNull();
    expect(col.position!.pctReturn).toBeNull();
    expect(col.position!.holdingPeriodDays).toBe(18);
  });
});

describe('buildCompareColumn — fundamentals', () => {
  it('orders preferred keys first then trails extras; preserves null entries', () => {
    const col = buildCompareColumn(
      baseInputs({
        arSummary: {
          symbol: 'ACME-EQ',
          fy: 'FY25',
          generated_at: '2026-04-15T00:00:00Z',
          business_model_md: '',
          revenue_mix: [],
          growth_drivers_md: '',
          risks_md: '',
          capital_allocation_md: '',
          management_quality_md: '',
          red_flags: [],
          key_numbers: {
            net_debt: -200, // preferred (last)
            revenue: 1200, // preferred (first)
            random_extra: 7, // extra
            roce: 0.18, // preferred (third)
          },
          checklist_results: [],
        },
      }),
    );
    expect(col.fundamentalsFy).toBe('FY25');
    expect(col.fundamentals.map((f) => f.key)).toEqual([
      'revenue',
      'roce',
      'net_debt',
      'random_extra',
    ]);
    expect(col.fundamentals[0]?.label).toBe('Revenue');
    expect(col.fundamentals[1]?.value).toBeCloseTo(0.18, 6);
  });

  it('omits gracefully when AR has no key_numbers', () => {
    const col = buildCompareColumn(
      baseInputs({
        arSummary: {
          symbol: 'ACME-EQ',
          fy: 'FY24',
          generated_at: '2025-06-01T00:00:00Z',
          business_model_md: '',
          revenue_mix: [],
          growth_drivers_md: '',
          risks_md: '',
          capital_allocation_md: '',
          management_quality_md: '',
          red_flags: [],
          key_numbers: {},
          checklist_results: [],
        },
      }),
    );
    expect(col.fundamentals).toEqual([]);
    expect(col.fundamentalsFy).toBe('FY24');
  });
});

describe('buildCompareColumn — concall + stress test', () => {
  it('reads tone from new (-2..+2) key, falls back to legacy key', () => {
    const newKey = buildCompareColumn(
      baseInputs({
        concall: {
          symbol: 'ACME-EQ',
          fq: 'Q3-FY26',
          guidance: { revenue_growth_yoy: 0.2, ebitda_margin: 0.28, qualitative: 'bullish' },
          kpi_deltas: [],
          analyst_question_themes: [],
          management_tone: { 'score_-2_to_+2': 1, notes: '' } as Record<string, unknown>,
          thesis_impact_md: '',
        },
      }),
    );
    expect(newKey.concall!.fq).toBe('Q3-FY26');
    expect(newKey.concall!.revenueGrowthYoy).toBeCloseTo(0.2, 6);
    expect(newKey.concall!.ebitdaMargin).toBeCloseTo(0.28, 6);
    expect(newKey.concall!.qualitative).toBe('bullish');
    expect(newKey.concall!.managementToneScore).toBe(1);

    const legacy = buildCompareColumn(
      baseInputs({
        concall: {
          symbol: 'ACME-EQ',
          fq: 'Q2-FY26',
          guidance: {},
          kpi_deltas: [],
          analyst_question_themes: [],
          management_tone: { score_2_to_2: -1 } as Record<string, unknown>,
          thesis_impact_md: '',
        },
      }),
    );
    expect(legacy.concall!.managementToneScore).toBe(-1);
  });

  it('passes through stress test verdict + rationale', () => {
    const col = buildCompareColumn(
      baseInputs({
        stressTest: {
          symbol: 'ACME-EQ',
          run_at: '2026-04-30T00:00:00Z',
          checklist: [],
          verdict: 'weakened',
          verdict_rationale_md: 'Margin pressure unresolved.',
        },
      }),
    );
    expect(col.stressTest).toEqual({
      verdict: 'weakened',
      runAt: '2026-04-30T00:00:00Z',
      rationaleMd: 'Margin pressure unresolved.',
    });
  });
});
