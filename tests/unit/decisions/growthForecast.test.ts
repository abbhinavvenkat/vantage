import { describe, it, expect } from 'vitest';

import { forecastGrowth, type Fundamentals } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';

const baseFund: Fundamentals = {
  symbol: 'ACME',
  annual: {
    FY2020: { sales_cr: 100, pat_cr: 10, roce_pct: 25, equity_bv_cr: 50 },
    FY2021: { sales_cr: 115, pat_cr: 12, roce_pct: 26, equity_bv_cr: 58 },
    FY2022: { sales_cr: 132, pat_cr: 15, roce_pct: 28, equity_bv_cr: 70 },
    FY2023: { sales_cr: 152, pat_cr: 18, roce_pct: 30, equity_bv_cr: 86 },
    FY2024: { sales_cr: 174, pat_cr: 22, roce_pct: 32, equity_bv_cr: 105 },
    FY2025: { sales_cr: 200, pat_cr: 27, roce_pct: 33, equity_bv_cr: 130 },
  },
  current: { pe: 30, price: 1000, market_cap_cr: 27000 },
};

function fired(
  action: FiredRule['action'],
  weight: number,
  tags: string[],
): FiredRule & {
  tags?: string[];
} {
  return {
    ruleId: `r.${action}.${Math.random()}`,
    action,
    weight,
    baseWeight: weight,
    styleScale: 1,
    tags,
  } as FiredRule & { tags: string[] };
}

describe('forecastGrowth', () => {
  it('produces a positive 1y/3y/5y forecast for a quality compounder', () => {
    const r = forecastGrowth({
      symbol: 'ACME',
      fundamentals: baseFund,
      firedRules: [fired('add', 0.8, ['quality', 'compounder'])],
      currentPrice: 1000,
      priceHistory: [],
    });
    expect(r.yearOne).toBeGreaterThan(0);
    expect(r.yearThree).toBeGreaterThan(r.yearOne);
    expect(r.yearFive).toBeGreaterThan(r.yearOne);
    expect(['low', 'medium', 'high']).toContain(r.confidence);
    expect(r.basis.length).toBeGreaterThan(0);
  });

  it('applies a mean-reversion drag when current PE is far above historical median', () => {
    const expensive: Fundamentals = {
      ...baseFund,
      current: { ...baseFund.current, pe: 90 },
    };
    const cheap: Fundamentals = {
      ...baseFund,
      current: { ...baseFund.current, pe: 18 },
    };
    const fr = [fired('hold', 0.6, ['quality'])];
    const a = forecastGrowth({
      symbol: 'ACME',
      fundamentals: expensive,
      firedRules: fr,
      currentPrice: 1000,
      priceHistory: [],
    });
    const b = forecastGrowth({
      symbol: 'ACME',
      fundamentals: cheap,
      firedRules: fr,
      currentPrice: 1000,
      priceHistory: [],
    });
    expect(a.yearFive).toBeLessThan(b.yearFive);
  });

  it('lowers confidence when fundamentals are missing', () => {
    const r = forecastGrowth({
      symbol: 'NA',
      fundamentals: null,
      firedRules: [],
      currentPrice: 100,
      priceHistory: [],
    });
    expect(r.confidence).toBe('low');
  });
});
