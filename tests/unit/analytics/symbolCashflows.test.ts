import { describe, it, expect } from 'vitest';
import { tradesToCashflowsForSymbol } from '@/lib/analytics/symbolCashflows';
import type { Trade } from '@/lib/db/queries/trades';

function mkTrade(overrides: Partial<Trade>): Trade {
  return {
    id: 't1',
    accountId: 'a1',
    symbol: 'ACME-EQ',
    isin: null,
    tradeDate: '2024-01-01',
    side: 'buy',
    qty: 10,
    price: 100,
    currency: 'INR',
    exchange: null,
    segment: null,
    series: null,
    tradeId: null,
    orderId: null,
    execTime: null,
    sourceFileHash: null,
    sourceRowIdx: 0,
    isIntradayPairId: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...overrides,
  } as Trade;
}

describe('tradesToCashflowsForSymbol', () => {
  it('returns symbol-scoped buy/sell cashflows + terminal MV', () => {
    const trades: Trade[] = [
      mkTrade({
        id: '1',
        symbol: 'ACME-EQ',
        tradeDate: '2024-01-01',
        side: 'buy',
        qty: 10,
        price: 100,
      }),
      mkTrade({
        id: '2',
        symbol: 'OTHER-EQ',
        tradeDate: '2024-02-01',
        side: 'buy',
        qty: 5,
        price: 200,
      }),
      mkTrade({
        id: '3',
        symbol: 'ACME-EQ',
        tradeDate: '2024-06-01',
        side: 'sell',
        qty: 4,
        price: 130,
      }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'ACME-EQ', 6 * 150, '2025-01-01');

    expect(cf).toEqual([
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-06-01', amount: 520 },
      { date: '2025-01-01', amount: 900 },
    ]);
  });

  it('excludes intraday-paired rows', () => {
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 100 }),
      mkTrade({
        id: '2',
        tradeDate: '2024-03-01',
        side: 'buy',
        qty: 5,
        price: 110,
        isIntradayPairId: 'pair-1',
      }),
      mkTrade({
        id: '3',
        tradeDate: '2024-03-01',
        side: 'sell',
        qty: 5,
        price: 115,
        isIntradayPairId: 'pair-1',
      }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'ACME-EQ', 0, '2025-01-01');

    expect(cf).toEqual([{ date: '2024-01-01', amount: -1000 }]);
  });

  it('omits the terminal MV cashflow for closed positions (currentMv = 0)', () => {
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 100 }),
      mkTrade({ id: '2', tradeDate: '2024-12-01', side: 'sell', qty: 10, price: 150 }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'ACME-EQ', 0, '2025-01-01');

    expect(cf).toEqual([
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-12-01', amount: 1500 },
    ]);
  });

  it('nets multiple same-date trades into a single cashflow row', () => {
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2024-01-01', side: 'buy', qty: 5, price: 100 }),
      mkTrade({
        id: '2',
        tradeDate: '2024-01-01',
        side: 'buy',
        qty: 5,
        price: 120,
        sourceRowIdx: 1,
      }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'ACME-EQ', 0, '2025-01-01');

    expect(cf).toEqual([{ date: '2024-01-01', amount: -1100 }]);
  });

  it('applies symbol aliases (HDFC → HDFCBANK at 42/25 ratio)', () => {
    // Buy 25 HDFC @ 1680 → after alias: 42 HDFCBANK @ 1000 → outflow ₹42,000.
    const trades: Trade[] = [
      mkTrade({
        id: '1',
        symbol: 'HDFC',
        tradeDate: '2023-06-01',
        side: 'buy',
        qty: 25,
        price: 1680,
      }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'HDFCBANK', 0, '2025-01-01');

    expect(cf).toHaveLength(1);
    expect(cf[0]!.date).toBe('2023-06-01');
    expect(cf[0]!.amount).toBeCloseTo(-25 * 1680, 6);
  });

  it('netted same-date buys/sells produce a single row with the net amount', () => {
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2024-01-01', side: 'buy', qty: 10, price: 100 }),
      mkTrade({
        id: '2',
        tradeDate: '2024-06-01',
        side: 'buy',
        qty: 5,
        price: 120,
        sourceRowIdx: 1,
      }),
      mkTrade({
        id: '3',
        tradeDate: '2024-06-01',
        side: 'sell',
        qty: 3,
        price: 130,
        sourceRowIdx: 2,
      }),
    ];

    const cf = tradesToCashflowsForSymbol(trades, 'ACME-EQ', 0, '2025-01-01');

    // 2024-06-01: -5*120 + 3*130 = -600 + 390 = -210
    expect(cf).toEqual([
      { date: '2024-01-01', amount: -1000 },
      { date: '2024-06-01', amount: -210 },
    ]);
  });
});
