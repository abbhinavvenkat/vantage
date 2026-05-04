import { describe, it, expect } from 'vitest';

import type { Fundamentals } from '@/lib/decisions/growthForecast';
import { buildFundamentalsTable } from '@/lib/fundamentals/buildTable';

const sample: Fundamentals = {
  symbol: 'ACME',
  annual: {
    FY2020: {
      sales_cr: 100,
      pat_cr: 10,
      ebitda_cr: 25,
      roce_pct: 25,
      roe_pct: 22,
      debt_to_equity: 0.1,
      cfo_cr: 9,
      capex_cr: -2,
      equity_bv_cr: 50,
    },
    FY2021: {
      sales_cr: 115,
      pat_cr: 12,
      ebitda_cr: 30,
      roce_pct: 26,
      roe_pct: 23,
      debt_to_equity: 0.1,
      cfo_cr: 11,
      capex_cr: -2,
      equity_bv_cr: 58,
    },
    FY2022: {
      sales_cr: 132,
      pat_cr: 15,
      ebitda_cr: 36,
      roce_pct: 28,
      roe_pct: 24,
      debt_to_equity: 0.1,
      cfo_cr: 14,
      capex_cr: -3,
      equity_bv_cr: 70,
    },
    FY2023: {
      sales_cr: 152,
      pat_cr: 18,
      ebitda_cr: 42,
      roce_pct: 30,
      roe_pct: 25,
      debt_to_equity: 0.1,
      cfo_cr: 17,
      capex_cr: -3,
      equity_bv_cr: 86,
    },
    FY2024: {
      sales_cr: 174,
      pat_cr: 22,
      ebitda_cr: 50,
      roce_pct: 32,
      roe_pct: 26,
      debt_to_equity: 0.1,
      cfo_cr: 21,
      capex_cr: -4,
      equity_bv_cr: 105,
    },
    FY2025: {
      sales_cr: 200,
      pat_cr: 27,
      ebitda_cr: 60,
      roce_pct: 33,
      roe_pct: 27,
      debt_to_equity: 0.1,
      cfo_cr: 26,
      capex_cr: -4,
      equity_bv_cr: 130,
    },
  },
  current: { pe: 30, price: 1000, market_cap_cr: 27000, book_value_per_share: 500 },
};

describe('buildFundamentalsTable', () => {
  it('returns a row per metric with latest, threeYearAvg, fiveYearCagr, verdict', () => {
    const t = buildFundamentalsTable(sample);
    expect(t.rows.length).toBe(10);
    const ids = t.rows.map((r) => r.metricId);
    expect(ids).toContain('roce');
    expect(ids).toContain('pe');
    expect(ids).toContain('debt_to_equity');
  });

  it('marks ROCE as green for a 30%+ business', () => {
    const t = buildFundamentalsTable(sample);
    const roce = t.rows.find((r) => r.metricId === 'roce');
    expect(roce!.verdict).toBe('green');
    expect(roce!.commentary?.investor).toBeTruthy();
  });

  it('marks Debt/Equity 0.1 as green', () => {
    const t = buildFundamentalsTable(sample);
    const de = t.rows.find((r) => r.metricId === 'debt_to_equity');
    expect(de!.verdict).toBe('green');
  });

  it('marks PE 30 as amber', () => {
    const t = buildFundamentalsTable(sample);
    const pe = t.rows.find((r) => r.metricId === 'pe');
    expect(pe!.verdict).toBe('amber');
  });

  it('handles null fundamentals gracefully (all rows unknown)', () => {
    const t = buildFundamentalsTable(null);
    expect(t.rows.length).toBe(10);
    for (const r of t.rows) expect(r.verdict).toBe('unknown');
  });

  it('computes 5y revenue CAGR from earliest and latest years (≈14.9% for sample)', () => {
    const t = buildFundamentalsTable(sample);
    const rev = t.rows.find((r) => r.metricId === 'revenue')!;
    expect(rev.fiveYearCagr).not.toBeNull();
    expect(rev.fiveYearCagr! * 100).toBeGreaterThan(10);
  });
});
