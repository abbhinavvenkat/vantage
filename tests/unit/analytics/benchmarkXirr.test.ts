import { describe, it, expect } from 'vitest';
import { computeBenchmarkXirr } from '@/lib/analytics/benchmarkXirr';
import { xirr } from '@/lib/analytics/xirr';

describe('computeBenchmarkXirr', () => {
  it('returns ~10% when a single rupee buy compounds 10% on the index', () => {
    const niftySeries = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2021-01-01', 11000],
    ]);
    const rate = computeBenchmarkXirr(
      [{ date: '2020-01-01', amount: -1000 }],
      niftySeries,
      11000,
      '2021-01-01',
    );
    // 365-day-year XIRR over a leap-year span returns ~0.0997 not 0.1; 3 decimals tolerance.
    expect(rate).toBeCloseTo(0.1, 3);
  });

  it('mirrors a partial sell proportionally to current MV (units-based)', () => {
    // Buy ₹1000 @ 10000 → 0.1 units. On 2020-07-01 index=12000, MV=1200.
    // Inflow ₹500 sells 500/1200 of units → remaining = 0.1 * (1 - 500/1200) units.
    // At terminal index=13000, residual MV = 0.1 * (700/1200) * 13000 ≈ 758.3333.
    const niftySeries = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2020-07-01', 12000],
      ['2021-01-01', 13000],
    ]);
    const rate = computeBenchmarkXirr(
      [
        { date: '2020-01-01', amount: -1000 },
        { date: '2020-07-01', amount: 500 },
      ],
      niftySeries,
      13000,
      '2021-01-01',
    );
    const expected = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: 500 },
      { date: '2021-01-01', amount: 0.1 * (1 - 500 / 1200) * 13000 },
    ]);
    expect(rate).toBeCloseTo(expected, 4);
  });

  it('falls forward to the next available close if cashflow date is a market holiday', () => {
    // 2020-01-05 is a Sunday; series only has Friday and Monday closes.
    // Buy ₹1010 on Sunday should use Monday close=10100 → 0.1 units.
    // Terminal index 11500 → MV 1150. XIRR over ~1y of 1010→1150 ≈ 13.86%.
    const niftySeries = new Map<string, number>([
      ['2020-01-03', 10000],
      ['2020-01-06', 10100],
      ['2021-01-04', 11500],
    ]);
    const rate = computeBenchmarkXirr(
      [{ date: '2020-01-05', amount: -1010 }],
      niftySeries,
      11500,
      '2021-01-04',
    );
    const expected = xirr([
      { date: '2020-01-05', amount: -1010 },
      { date: '2021-01-04', amount: 1150 },
    ]);
    expect(rate).toBeCloseTo(expected, 4);
  });

  it('throws when the series has no close at or after the first cashflow date', () => {
    const niftySeries = new Map<string, number>([['2019-01-01', 10000]]);
    expect(() =>
      computeBenchmarkXirr(
        [{ date: '2025-01-01', amount: -1000 }],
        niftySeries,
        11000,
        '2026-01-01',
      ),
    ).toThrow();
  });
});
