import { describe, it, expect } from 'vitest';
import { computeFifo } from '@/lib/analytics/fifo';
import type { NormalizedTrade } from '@/lib/parsers/types';

function trade(
  partial: Partial<NormalizedTrade> & {
    symbol: string;
    tradeDate: string;
    side: 'buy' | 'sell';
    qty: number;
    price: number;
  },
  rawRowIdx = 1,
): NormalizedTrade {
  return {
    brokerCode: 'zerodha',
    currency: 'INR',
    rawRowIdx,
    ...partial,
  };
}

describe('computeFifo — plain delivery sequence', () => {
  it('matches a sell against the oldest lots first', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-02-01', side: 'buy', qty: 5, price: 120 }, 2),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-03-01', side: 'sell', qty: 8, price: 150 }, 3),
    ];
    const { lots, realized } = computeFifo(trades, []);
    const totalRealized = realized.reduce((a, r) => a + r.pnl, 0);
    expect(totalRealized).toBeCloseTo(8 * (150 - 100), 6);

    expect(lots).toHaveLength(2);
    expect(lots[0]?.qty).toBe(2);
    expect(lots[0]?.costPerShare).toBeCloseTo(100, 6);
    expect(lots[1]?.qty).toBe(5);
    expect(lots[1]?.costPerShare).toBeCloseTo(120, 6);
  });
});

describe('computeFifo — same-day intraday netting', () => {
  it('cancels equal same-day buy/sell qty before FIFO (no realized, no lot)', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'buy', qty: 600, price: 197.1 }, 1),
      trade(
        { symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 129, price: 197.25 },
        2,
      ),
      trade(
        { symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 85, price: 197.25 },
        3,
      ),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 5, price: 197.25 }, 4),
      trade(
        { symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 381, price: 197.25 },
        5,
      ),
    ];
    const { lots, realized } = computeFifo(trades, []);
    expect(realized).toHaveLength(0);
    expect(lots).toHaveLength(0);
  });

  it('keeps the residue when same-day buys exceed same-day sells', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'buy', qty: 100, price: 50 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 60, price: 55 }, 2),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-07-01', side: 'sell', qty: 40, price: 70 }, 3),
    ];
    const { lots, realized } = computeFifo(trades, []);
    expect(realized).toHaveLength(1);
    expect(realized[0]?.qty).toBe(40);
    expect(realized[0]?.pnl).toBeCloseTo(40 * (70 - 50), 6);
    expect(lots).toHaveLength(0);
  });

  it('preserves time order so prior buy lots match against same-day sell residue', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'buy', qty: 50, price: 200 }, 2),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-06-25', side: 'sell', qty: 55, price: 210 }, 3),
    ];
    // Same-day pairs: 50 cancel; residue: 5 sell.
    // FIFO matches the 5 sell against the 10@100 lot.
    const { lots, realized } = computeFifo(trades, []);
    expect(realized).toHaveLength(1);
    expect(realized[0]?.qty).toBe(5);
    expect(realized[0]?.pnl).toBeCloseTo(5 * (210 - 100), 6);
    expect(lots).toHaveLength(1);
    expect(lots[0]?.qty).toBe(5);
    expect(lots[0]?.costPerShare).toBeCloseTo(100, 6);
  });
});

describe('computeFifo — split applied to historical lots', () => {
  it('applies a 1:2 split BEFORE matching sells', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 200 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-04-01', side: 'sell', qty: 5, price: 110 }, 2),
    ];
    const corpActions = [
      { symbol: 'ACME-EQ', exDate: '2024-03-01', type: 'split' as const, ratio: 2 },
    ];
    const { lots, realized } = computeFifo(trades, corpActions);
    const totalRealized = realized.reduce((a, r) => a + r.pnl, 0);
    expect(totalRealized).toBeCloseTo(5 * (110 - 100), 6);

    expect(lots).toHaveLength(1);
    expect(lots[0]?.qty).toBe(15);
    expect(lots[0]?.costPerShare).toBeCloseTo(100, 6);
  });
});
