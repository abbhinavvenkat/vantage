import { describe, it, expect } from 'vitest';

import { computeRebalanceTrades, type RebalanceTarget } from '@/lib/analytics/rebalance';
import type { OpenPosition } from '@/lib/analytics/fifoHoldings';
import type { LatestPrice } from '@/lib/db/queries/prices';

function pos(symbol: string, qty: number, avgCost: number): OpenPosition {
  return {
    symbol,
    qty,
    costBasis: qty * avgCost,
    avgCost,
    firstBuyDate: '2024-01-01',
    lots: [{ qty, costPerShare: avgCost, date: '2024-01-01' }],
  };
}

function priceMap(entries: Record<string, number>): Map<string, LatestPrice> {
  const m = new Map<string, LatestPrice>();
  for (const [s, p] of Object.entries(entries)) {
    m.set(s, { symbol: s, close: p, date: '2026-04-30' });
  }
  return m;
}

describe('computeRebalanceTrades — symbol mode', () => {
  it('emits BUY when target weight > current weight', () => {
    const positions = [pos('TCS', 10, 3000), pos('HDFCBANK', 20, 1500)];
    const prices = priceMap({ TCS: 3500, HDFCBANK: 1600 });
    const totalMv = 10 * 3500 + 20 * 1600; // 35,000 + 32,000 = 67,000
    const targets: RebalanceTarget[] = [
      { mode: 'symbol', key: 'TCS', targetPct: 60 },
      { mode: 'symbol', key: 'HDFCBANK', targetPct: 40 },
    ];

    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);

    const tcs = actions.find((a) => a.key === 'TCS')!;
    expect(tcs.action).toBe('buy');
    // desired = 0.6 * 67000 = 40200, current = 35000 → delta 5200 / 3500 = 1.48 → 1 share
    expect(tcs.qtyChange).toBe(1);
    expect(tcs.deltaInr).toBeCloseTo(5200, 0);

    const hdfc = actions.find((a) => a.key === 'HDFCBANK')!;
    expect(hdfc.action).toBe('sell');
    // desired = 0.4 * 67000 = 26800, current = 32000 → delta -5200 / 1600 = -3.25 → -3 shares
    expect(hdfc.qtyChange).toBe(-3);
  });

  it('emits HOLD when target equals current', () => {
    const positions = [pos('TCS', 10, 3000), pos('HDFCBANK', 20, 1500)];
    const prices = priceMap({ TCS: 3500, HDFCBANK: 1600 });
    const totalMv = 10 * 3500 + 20 * 1600;
    const tcsPct = ((10 * 3500) / totalMv) * 100;
    const hdfcPct = ((20 * 1600) / totalMv) * 100;
    const targets: RebalanceTarget[] = [
      { mode: 'symbol', key: 'TCS', targetPct: tcsPct },
      { mode: 'symbol', key: 'HDFCBANK', targetPct: hdfcPct },
    ];

    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);
    for (const a of actions) {
      expect(a.action).toBe('hold');
      expect(a.qtyChange).toBe(0);
    }
  });

  it('target=0 with held position emits full SELL', () => {
    const positions = [pos('TCS', 10, 3000), pos('HDFCBANK', 20, 1500)];
    const prices = priceMap({ TCS: 3500, HDFCBANK: 1600 });
    const totalMv = 10 * 3500 + 20 * 1600;
    const targets: RebalanceTarget[] = [
      { mode: 'symbol', key: 'TCS', targetPct: 100 },
      { mode: 'symbol', key: 'HDFCBANK', targetPct: 0 },
    ];

    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);
    const hdfc = actions.find((a) => a.key === 'HDFCBANK')!;
    expect(hdfc.action).toBe('sell');
    expect(hdfc.qtyChange).toBe(-20);
    expect(hdfc.targetPct).toBe(0);
  });

  it('filters out trades with absolute estimated value < ₹500 as noise', () => {
    const positions = [pos('TCS', 10, 3500)];
    const prices = priceMap({ TCS: 3500 });
    const totalMv = 10 * 3500; // 35,000
    // Target 99.5% — desired = 34825, delta = -175 → qty -0.05 → noise
    const targets: RebalanceTarget[] = [{ mode: 'symbol', key: 'TCS', targetPct: 99.5 }];

    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);
    const tcs = actions.find((a) => a.key === 'TCS')!;
    expect(tcs.action).toBe('hold');
  });

  it('marks fractional-shares note when whole-share rounding loses > ₹100', () => {
    const positions = [pos('TCS', 0, 0)];
    const prices = priceMap({ TCS: 3500 });
    const totalMv = 100_000;
    // Target 50% → desired 50,000 → 50,000 / 3,500 = 14.28 → 14 shares, residual 1,000
    const targets: RebalanceTarget[] = [{ mode: 'symbol', key: 'TCS', targetPct: 50 }];
    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);
    const tcs = actions.find((a) => a.key === 'TCS')!;
    expect(tcs.action).toBe('buy');
    expect(tcs.qtyChange).toBe(14);
    expect(tcs.note).toMatch(/fractional/i);
  });

  it('emits a "consider adding" recommendation for a target symbol not currently held', () => {
    const positions = [pos('TCS', 10, 3000)];
    const prices = priceMap({ TCS: 3500, HDFCBANK: 1600 });
    const totalMv = 10 * 3500;
    const targets: RebalanceTarget[] = [
      { mode: 'symbol', key: 'TCS', targetPct: 50 },
      { mode: 'symbol', key: 'HDFCBANK', targetPct: 50 },
    ];
    const actions = computeRebalanceTrades(positions, prices, targets, 'symbol', totalMv);
    const hdfc = actions.find((a) => a.key === 'HDFCBANK')!;
    expect(hdfc.action).toBe('buy');
    expect(hdfc.qtyChange).toBeGreaterThan(0);
    expect(hdfc.currentPct).toBe(0);
  });
});

describe('computeRebalanceTrades — sector mode', () => {
  // Use real sectors from SECTOR_MAP
  // TCS, HCLTECH, TATAELXSI → 'Software Services'
  // HDFCBANK, KOTAKBANK → 'Financial Services'
  // BEL → 'Defence'
  it('pro-rates sector under-allocation across symbols by current MV weight', () => {
    const positions = [
      pos('TCS', 10, 3000), // mv 35000
      pos('HCLTECH', 5, 1400), // mv 7500
      pos('HDFCBANK', 20, 1500), // mv 32000
    ];
    const prices = priceMap({ TCS: 3500, HCLTECH: 1500, HDFCBANK: 1600 });
    const totalMv = 35000 + 7500 + 32000; // 74500
    // current Software Services pct = 42500/74500 = 57.05%
    // current Financial Services pct = 32000/74500 = 42.95%
    const targets: RebalanceTarget[] = [
      { mode: 'sector', key: 'Software Services', targetPct: 70 },
      { mode: 'sector', key: 'Financial Services', targetPct: 30 },
    ];

    const actions = computeRebalanceTrades(positions, prices, targets, 'sector', totalMv);
    const sw = actions.find((a) => a.key === 'Software Services')!;
    const fin = actions.find((a) => a.key === 'Financial Services')!;
    expect(sw.action).toBe('buy');
    expect(fin.action).toBe('sell');

    // Per-symbol child rows for sw should sum to ~+9650 (delta)
    const swChildren = actions.filter((a) => a.parentSector === 'Software Services');
    expect(swChildren.length).toBe(2);
    const totalSwDelta = swChildren.reduce((s, a) => s + a.deltaInr, 0);
    expect(totalSwDelta).toBeCloseTo(sw.deltaInr, 0);

    // TCS should get the larger share (35000/42500 of delta) vs HCLTECH (7500/42500)
    const tcsChild = swChildren.find((a) => a.key === 'TCS')!;
    const hclChild = swChildren.find((a) => a.key === 'HCLTECH')!;
    expect(tcsChild.deltaInr).toBeGreaterThan(hclChild.deltaInr);
  });

  it('emits a "consider adding sector" recommendation for an unallocated target sector', () => {
    const positions = [pos('TCS', 10, 3000)];
    const prices = priceMap({ TCS: 3500 });
    const totalMv = 35000;
    const targets: RebalanceTarget[] = [
      { mode: 'sector', key: 'Software Services', targetPct: 60 },
      { mode: 'sector', key: 'Healthcare', targetPct: 40 },
    ];

    const actions = computeRebalanceTrades(positions, prices, targets, 'sector', totalMv);
    const hc = actions.find((a) => a.key === 'Healthcare')!;
    expect(hc.action).toBe('buy');
    expect(hc.qtyChange).toBe(0);
    expect(hc.note).toMatch(/consider adding/i);
  });

  it('hold when sector target equals current sector weight', () => {
    const positions = [pos('TCS', 10, 3000), pos('HDFCBANK', 20, 1500)];
    const prices = priceMap({ TCS: 3500, HDFCBANK: 1600 });
    const totalMv = 10 * 3500 + 20 * 1600;
    const swPct = ((10 * 3500) / totalMv) * 100;
    const finPct = ((20 * 1600) / totalMv) * 100;
    const targets: RebalanceTarget[] = [
      { mode: 'sector', key: 'Software Services', targetPct: swPct },
      { mode: 'sector', key: 'Financial Services', targetPct: finPct },
    ];
    const actions = computeRebalanceTrades(positions, prices, targets, 'sector', totalMv);
    const sectorRows = actions.filter((a) => !a.parentSector);
    for (const a of sectorRows) {
      expect(a.action).toBe('hold');
    }
  });
});
