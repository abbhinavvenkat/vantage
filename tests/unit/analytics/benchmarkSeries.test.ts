import { describe, it, expect } from 'vitest';
import {
  buildBenchmarkReturnSeries,
  buildPortfolioReturnSeries,
} from '@/lib/analytics/benchmarkSeries';
import type { QtyTimeline } from '@/lib/analytics/runningPositions';

describe('buildPortfolioReturnSeries', () => {
  it('returns empty for no cashflows', () => {
    expect(buildPortfolioReturnSeries([], 0, '2024-01-01')).toEqual([]);
  });

  it('emits a point per cashflow date plus a terminal point with real MV', () => {
    const cfs = [
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: 500 },
    ];
    const points = buildPortfolioReturnSeries(cfs, 700, '2021-01-01');
    expect(points).toHaveLength(3);
    expect(points[0]!.date).toBe('2020-01-01');
    expect(points[1]!.date).toBe('2020-07-01');
    expect(points[2]!.date).toBe('2021-01-01');
    // First point: only an outflow → 0% (approx MV = outflows; ret = 0).
    expect(points[0]!.returnPct).toBeCloseTo(0, 6);
    // Second point: outflows=1000, inflows=500, approxMv=500; ret = (500+500)/1000 − 1 = 0.
    expect(points[1]!.returnPct).toBeCloseTo(0, 6);
    // Terminal: outflows=1000, inflows=500, currentMv=700; ret = (700+500)/1000 − 1 = 0.2.
    expect(points[2]!.returnPct).toBeCloseTo(0.2, 6);
  });

  it('handles a single buy with no sells (terminal-only return signal)', () => {
    const points = buildPortfolioReturnSeries(
      [{ date: '2020-01-01', amount: -1000 }],
      1500,
      '2021-01-01',
      { monthlySamples: false },
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.returnPct).toBeCloseTo(0, 6);
    expect(points[1]!.date).toBe('2021-01-01');
    expect(points[1]!.returnPct).toBeCloseTo(0.5, 6);
  });

  it('produces a non-flat curve when price histories + qty timelines are supplied', () => {
    // Buy 10 ACME @ 100 = 1000 outflow on 2020-01-01.
    // ACME prices double linearly to 200 by 2021-01-01.
    // Mid-period MV(2020-07-01) = 10 × 150 = 1500 → return = (1500 + 0)/1000 - 1 = 0.5.
    // Terminal MV passed in = 2000 → return 1.0.
    const cashflows = [{ date: '2020-01-01', amount: -1000 }];
    const priceHistories = new Map<string, Map<string, number>>([
      [
        'ACME',
        new Map<string, number>([
          ['2020-01-01', 100],
          ['2020-07-01', 150],
          ['2021-01-01', 200],
        ]),
      ],
    ]);
    const qtyTimelines: QtyTimeline = new Map([['ACME', [{ date: '2020-01-01', qty: 10 }]]]);
    const points = buildPortfolioReturnSeries(cashflows, 2000, '2021-01-01', {
      priceHistories,
      qtyTimelines,
      monthlySamples: false,
    });

    // We expect: 2020-01-01 (cf), 2021-01-01 (terminal). Add a synthetic 2020-07-01
    // by passing it in via monthlySamples and verifying separately.
    expect(points.length).toBeGreaterThanOrEqual(2);
    const start = points.find((p) => p.date === '2020-01-01')!;
    const end = points.find((p) => p.date === '2021-01-01')!;
    expect(start.returnPct).toBeCloseTo(0, 6); // 1000 deployed at 100 → MV = 1000
    expect(end.returnPct).toBeCloseTo(1.0, 6); // currentMv 2000 / 1000 outflow − 1
  });

  it('emits monthly samples that are NOT flat between cashflows when histories supplied', () => {
    // Same setup; check that monthly samples reflect rising MV (not 0%).
    const cashflows = [{ date: '2020-01-01', amount: -1000 }];
    const priceHistories = new Map<string, Map<string, number>>([
      [
        'ACME',
        new Map<string, number>([
          ['2020-01-01', 100],
          ['2020-04-01', 130],
          ['2020-07-01', 160],
          ['2020-10-01', 180],
          ['2021-01-01', 200],
        ]),
      ],
    ]);
    const qtyTimelines: QtyTimeline = new Map([['ACME', [{ date: '2020-01-01', qty: 10 }]]]);
    const points = buildPortfolioReturnSeries(cashflows, 2000, '2021-01-01', {
      priceHistories,
      qtyTimelines,
      monthlySamples: true,
    });

    // We should see at least one point with returnPct > 0 BEFORE the terminal date.
    const intermediate = points.filter((p) => p.date !== '2020-01-01' && p.date !== '2021-01-01');
    expect(intermediate.length).toBeGreaterThan(0);
    expect(intermediate.some((p) => p.returnPct > 0.05)).toBe(true);

    // Returns should be monotonically increasing in this contrived linear-up market.
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.returnPct).toBeGreaterThanOrEqual(sorted[i - 1]!.returnPct - 1e-9);
    }
  });

  it('forward-fills missing closes (uses last known price on or before the date)', () => {
    const cashflows = [{ date: '2020-01-01', amount: -1000 }];
    const priceHistories = new Map<string, Map<string, number>>([
      [
        'ACME',
        new Map<string, number>([
          ['2020-01-01', 100],
          // gap — no May/June prices
          ['2020-08-01', 200],
        ]),
      ],
    ]);
    const qtyTimelines: QtyTimeline = new Map([['ACME', [{ date: '2020-01-01', qty: 10 }]]]);
    const points = buildPortfolioReturnSeries(cashflows, 2000, '2020-09-01', {
      priceHistories,
      qtyTimelines,
      monthlySamples: true,
    });
    // For samples between Jan and Aug, MV should be 10 × 100 = 1000 → return 0.
    const may = points.find((p) => p.date === '2020-05-01');
    const june = points.find((p) => p.date === '2020-06-01');
    expect(may?.returnPct).toBeCloseTo(0, 6);
    expect(june?.returnPct).toBeCloseTo(0, 6);
  });
});

describe('buildBenchmarkReturnSeries', () => {
  it('returns empty for no cashflows', () => {
    expect(buildBenchmarkReturnSeries([], new Map(), '2024-01-01', 100)).toEqual([]);
  });

  it('mirrors a single buy onto the index — terminal return matches index return', () => {
    // Buy ₹1000 at index=10000 → 0.1 units.
    // Terminal index 11000 → MV 1100 → return 10%.
    const series = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2021-01-01', 11000],
    ]);
    const points = buildBenchmarkReturnSeries(
      [{ date: '2020-01-01', amount: -1000 }],
      series,
      '2021-01-01',
      11000,
    );
    expect(points).toHaveLength(2);
    expect(points[0]!.date).toBe('2020-01-01');
    expect(points[0]!.returnPct).toBeCloseTo(0, 6); // mv=units*10000=1000; ret=0
    expect(points[1]!.date).toBe('2021-01-01');
    expect(points[1]!.returnPct).toBeCloseTo(0.1, 6);
  });

  it('handles a partial sell proportionally (units-based)', () => {
    // Buy ₹1000 @ 10000 → 0.1 units. On 2020-07-01 idx=12000, MV=1200.
    // Inflow ₹500 sells 500/1200 of units → remaining = 0.1 * (700/1200) units.
    // Terminal idx=13000 → mv = 0.1 * (700/1200) * 13000 ≈ 758.3333.
    // Return at terminal: (758.3333 + 500)/1000 − 1 = 0.258333.
    const series = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2020-07-01', 12000],
      ['2021-01-01', 13000],
    ]);
    const points = buildBenchmarkReturnSeries(
      [
        { date: '2020-01-01', amount: -1000 },
        { date: '2020-07-01', amount: 500 },
      ],
      series,
      '2021-01-01',
      13000,
    );
    expect(points).toHaveLength(3);
    // After the partial sell, intermediate point: mv = remaining units * 12000;
    //   remaining = 0.1*(700/1200) = 0.058333..., mv = 700; ret = (700+500)/1000−1 = 0.2
    expect(points[1]!.returnPct).toBeCloseTo(0.2, 6);
    // Terminal:
    expect(points[2]!.returnPct).toBeCloseTo((0.1 * (700 / 1200) * 13000 + 500) / 1000 - 1, 6);
  });

  it('forward-fills weekend cashflow dates to the next available close', () => {
    // 2020-01-05 is Sunday; only Friday and Monday closes.
    const series = new Map<string, number>([
      ['2020-01-03', 10000],
      ['2020-01-06', 10100],
      ['2021-01-04', 11500],
    ]);
    const points = buildBenchmarkReturnSeries(
      [{ date: '2020-01-05', amount: -1010 }],
      series,
      '2021-01-04',
      11500,
    );
    expect(points).toHaveLength(2);
    // Buy uses Monday close 10100 → 0.1 units. Terminal mv = 1150.
    expect(points[1]!.returnPct).toBeCloseTo((1150 - 1010) / 1010, 6);
  });

  it('throws if no close on or after the first cashflow date', () => {
    const series = new Map<string, number>([['2019-01-01', 10000]]);
    expect(() =>
      buildBenchmarkReturnSeries(
        [{ date: '2025-01-01', amount: -1000 }],
        series,
        '2026-01-01',
        11000,
      ),
    ).toThrow();
  });
});
