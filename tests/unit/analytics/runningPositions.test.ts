import { describe, it, expect } from 'vitest';
import { qtyOnDate, runningOpenPositionsBySymbol } from '@/lib/analytics/runningPositions';
import type { NormalizedTrade } from '@/lib/parsers/types';

function trade(
  partial: Partial<NormalizedTrade> & {
    symbol: string;
    side: 'buy' | 'sell';
    qty: number;
    price: number;
    tradeDate: string;
    rawRowIdx: number;
  },
): NormalizedTrade {
  return {
    brokerCode: 'zerodha',
    currency: 'INR',
    ...partial,
  };
}

describe('runningOpenPositionsBySymbol', () => {
  it('returns empty map for no trades', () => {
    expect(runningOpenPositionsBySymbol([], []).size).toBe(0);
  });

  it('emits one entry per trade date with running qty', () => {
    const ts: NormalizedTrade[] = [
      trade({
        symbol: 'ACME',
        side: 'buy',
        qty: 10,
        price: 100,
        tradeDate: '2024-01-15',
        rawRowIdx: 0,
      }),
      trade({
        symbol: 'ACME',
        side: 'buy',
        qty: 5,
        price: 110,
        tradeDate: '2024-03-10',
        rawRowIdx: 1,
      }),
      trade({
        symbol: 'ACME',
        side: 'sell',
        qty: 4,
        price: 120,
        tradeDate: '2024-06-01',
        rawRowIdx: 2,
      }),
    ];
    const tl = runningOpenPositionsBySymbol(ts, []);
    const acme = tl.get('ACME')!;
    expect(acme).toEqual([
      { date: '2024-01-15', qty: 10 },
      { date: '2024-03-10', qty: 15 },
      { date: '2024-06-01', qty: 11 },
    ]);
  });

  it('nets same-day intraday buy/sell pairs (excluded from delivery qty)', () => {
    const ts: NormalizedTrade[] = [
      trade({
        symbol: 'ACME',
        side: 'buy',
        qty: 10,
        price: 100,
        tradeDate: '2024-01-15',
        rawRowIdx: 0,
      }),
      // Same-day buy + matching sell of equal qty are netted out → no delivery qty change.
      trade({
        symbol: 'ACME',
        side: 'buy',
        qty: 3,
        price: 102,
        tradeDate: '2024-02-01',
        rawRowIdx: 1,
      }),
      trade({
        symbol: 'ACME',
        side: 'sell',
        qty: 3,
        price: 105,
        tradeDate: '2024-02-01',
        rawRowIdx: 2,
      }),
    ];
    const tl = runningOpenPositionsBySymbol(ts, []);
    const acme = tl.get('ACME')!;
    // Only the 2024-01-15 buy survives; the 2024-02-01 pair is netted away.
    expect(acme).toEqual([{ date: '2024-01-15', qty: 10 }]);
  });

  it('applies bonus actions to running qty (1:1 bonus doubles qty)', () => {
    const ts: NormalizedTrade[] = [
      trade({
        symbol: 'BONUS',
        side: 'buy',
        qty: 100,
        price: 50,
        tradeDate: '2024-01-01',
        rawRowIdx: 0,
      }),
      trade({
        symbol: 'BONUS',
        side: 'buy',
        qty: 20,
        price: 60,
        tradeDate: '2024-12-01',
        rawRowIdx: 1,
      }),
    ];
    // 1:1 bonus on 2024-06-01 → qty held at that time (100) becomes 200.
    const actions = [{ symbol: 'BONUS', exDate: '2024-06-01', type: 'bonus' as const, ratio: 1 }];
    const tl = runningOpenPositionsBySymbol(ts, actions);
    const bn = tl.get('BONUS')!;
    expect(bn).toEqual([
      { date: '2024-01-01', qty: 100 },
      { date: '2024-06-01', qty: 200 },
      { date: '2024-12-01', qty: 220 },
    ]);
  });

  it('applies splits as a multiplier', () => {
    const ts: NormalizedTrade[] = [
      trade({
        symbol: 'SPLIT',
        side: 'buy',
        qty: 10,
        price: 1000,
        tradeDate: '2024-01-01',
        rawRowIdx: 0,
      }),
    ];
    // 1:5 split (ratio 5) → 10 → 50 shares.
    const actions = [{ symbol: 'SPLIT', exDate: '2024-06-01', type: 'split' as const, ratio: 5 }];
    const tl = runningOpenPositionsBySymbol(ts, actions);
    const sp = tl.get('SPLIT')!;
    expect(sp).toEqual([
      { date: '2024-01-01', qty: 10 },
      { date: '2024-06-01', qty: 50 },
    ]);
  });

  it('honours symbol aliases (LTI → LTIM)', () => {
    const ts: NormalizedTrade[] = [
      trade({
        symbol: 'LTI',
        side: 'buy',
        qty: 10,
        price: 5000,
        tradeDate: '2022-01-01',
        rawRowIdx: 0,
      }),
    ];
    const tl = runningOpenPositionsBySymbol(ts, []);
    expect(tl.has('LTI')).toBe(false);
    expect(tl.get('LTIM')).toEqual([{ date: '2022-01-01', qty: 10 }]);
  });
});

describe('qtyOnDate', () => {
  const tl = [
    { date: '2024-01-15', qty: 10 },
    { date: '2024-03-10', qty: 15 },
    { date: '2024-06-01', qty: 11 },
  ];
  it('returns 0 before the first event', () => {
    expect(qtyOnDate(tl, '2023-12-31')).toBe(0);
  });
  it('returns the qty on the exact event date', () => {
    expect(qtyOnDate(tl, '2024-01-15')).toBe(10);
    expect(qtyOnDate(tl, '2024-03-10')).toBe(15);
  });
  it('returns the qty as-of an in-between date', () => {
    expect(qtyOnDate(tl, '2024-02-01')).toBe(10);
    expect(qtyOnDate(tl, '2024-05-31')).toBe(15);
    expect(qtyOnDate(tl, '2025-01-01')).toBe(11);
  });
  it('returns 0 for an empty timeline', () => {
    expect(qtyOnDate([], '2024-01-01')).toBe(0);
  });
});
