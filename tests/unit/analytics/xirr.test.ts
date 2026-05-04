import { describe, it, expect } from 'vitest';
import { xirr } from '@/lib/analytics/xirr';

describe('xirr', () => {
  it('returns ~10% for a one-year 10% return', () => {
    const rate = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 },
    ]);
    expect(rate).toBeCloseTo(0.1, 3);
  });

  it('returns ~0 for a flat round-trip', () => {
    const rate = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1000 },
    ]);
    expect(Math.abs(rate)).toBeLessThan(1e-3);
  });

  it('handles multiple cashflows', () => {
    const rate = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: -500 },
      { date: '2021-01-01', amount: 1650 },
    ]);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThan(1);
  });

  it('throws when not converging on pathological input', () => {
    expect(() =>
      xirr([
        { date: '2020-01-01', amount: -1000 },
        { date: '2021-01-01', amount: -1000 },
      ]),
    ).toThrow(/did not converge/);
  });
});
