import { describe, it, expect } from 'vitest';
import { cagr, portfolioCagr } from '@/lib/analytics/cagr';

describe('cagr', () => {
  it('returns +100% when an investment doubles in 1 year', () => {
    expect(cagr(100, 200, 1)).toBeCloseTo(1.0, 6);
  });

  it('returns -50% when an investment halves in 1 year', () => {
    expect(cagr(200, 100, 1)).toBeCloseTo(-0.5, 6);
  });

  it('returns ~10% when ₹1 grows to ₹1.21 in 2 years', () => {
    expect(cagr(1, 1.21, 2)).toBeCloseTo(0.1, 6);
  });

  it('returns null for non-positive startValue', () => {
    expect(cagr(0, 100, 1)).toBeNull();
    expect(cagr(-10, 100, 1)).toBeNull();
  });

  it('returns null for non-positive years', () => {
    expect(cagr(100, 200, 0)).toBeNull();
    expect(cagr(100, 200, -1)).toBeNull();
  });

  it('returns null for non-positive endValue', () => {
    expect(cagr(100, 0, 1)).toBeNull();
    expect(cagr(100, -10, 1)).toBeNull();
  });
});

describe('portfolioCagr', () => {
  it('returns null when there are no outflows', () => {
    expect(portfolioCagr([], 0)).toBeNull();
    expect(portfolioCagr([{ date: '2020-01-01', amount: 100 }], 0)).toBeNull();
  });

  it('computes CAGR when MV doubles after a single buy ~1y ago', () => {
    const today = new Date();
    const oneYearAgo = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const rate = portfolioCagr([{ date: oneYearAgo, amount: -1000 }], 2000);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(1.0, 2);
  });

  it('treats sells as capital returned (reduces netDeployed)', () => {
    // Buy ₹1000 ~2y ago, sold ₹500 some time later; current MV ₹720.
    // netDeployed = 1000 − 500 = 500; end = 720; (720/500)^(1/2) − 1 = 20%
    const today = new Date();
    const twoYearsAgo = new Date(today.getTime() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
    const oneYearAgo = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const rate = portfolioCagr(
      [
        { date: twoYearsAgo, amount: -1000 },
        { date: oneYearAgo, amount: 500 },
      ],
      720,
    );
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.2, 2);
  });

  it('treats dividend inflows as income (adds to terminal, not netDeployed)', () => {
    // Buy ₹1000 2y ago, received ₹50 dividend 1y ago; MV ₹1100 now.
    // netDeployed = 1000 (dividends are NOT capital returned).
    // end = 1100 + 50 = 1150. (1150/1000)^(1/2) − 1 ≈ 7.24%
    const today = new Date();
    const twoYearsAgo = new Date(today.getTime() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
    const oneYearAgo = new Date(today.getTime() - 365 * 86_400_000).toISOString().slice(0, 10);
    const rate = portfolioCagr(
      [
        { date: twoYearsAgo, amount: -1000 },
        { date: oneYearAgo, amount: 50 },
      ],
      1100,
      50, // dividendInflowsTotal
    );
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0.0724, 2);
  });
});
