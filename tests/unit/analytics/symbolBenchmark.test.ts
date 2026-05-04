import { describe, it, expect } from 'vitest';
import { compareSymbolToNifty } from '@/lib/analytics/symbolBenchmark';
import { xirr } from '@/lib/analytics/xirr';
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

describe('compareSymbolToNifty', () => {
  it('open position: computes actualXirr, niftyXirr and alpha to 1e-4', () => {
    // Buy 10 @ 100 on 2020-01-01, hold to 2021-01-01 with MV 1500.
    // Nifty: 10000 → 11000 over the same year.
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2020-01-01', side: 'buy', qty: 10, price: 100 }),
    ];
    const niftySeries = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2021-01-01', 11000],
    ]);

    const result = compareSymbolToNifty(trades, 'ACME-EQ', 1500, niftySeries, 11000, '2021-01-01');

    const expectedActual = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1500 },
    ]);
    const expectedNifty = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 }, // 0.1 units * 11000
    ]);

    expect(result.actualXirr).toBeCloseTo(expectedActual, 4);
    expect(result.niftyXirr).toBeCloseTo(expectedNifty, 4);
    expect(result.alpha).toBeCloseTo(expectedActual - expectedNifty, 4);
    expect(result.actualEndValue).toBe(1500);
    expect(result.niftyEndValue).toBeCloseTo(0.1 * 11000, 6);
    expect(result.totalInvested).toBe(1000);
  });

  it('closed position: terminal MV = 0, XIRR uses realised cashflows only', () => {
    // Buy 10 @ 100 on 2020-01-01, sell 10 @ 200 on 2021-01-01 (full exit).
    // Nifty: 10000 → 11000. Mirror sells all units (sellFraction capped at 1).
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2020-01-01', side: 'buy', qty: 10, price: 100 }),
      mkTrade({ id: '2', tradeDate: '2021-01-01', side: 'sell', qty: 10, price: 200 }),
    ];
    const niftySeries = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2021-01-01', 11000],
    ]);

    const result = compareSymbolToNifty(trades, 'ACME-EQ', 0, niftySeries, 11000, '2021-01-01');

    const expectedActual = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 2000 },
    ]);
    // Mirror: 0.1 units bought, currentMv on 2021-01-01 = 1100, sellFraction =
    // min(1, 2000/1100)=1 → sell 1100, residual units 0 → niftyEndValue=0.
    const expectedNifty = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2021-01-01', amount: 1100 },
    ]);

    expect(result.actualXirr).toBeCloseTo(expectedActual, 4);
    expect(result.niftyXirr).toBeCloseTo(expectedNifty, 4);
    expect(result.actualEndValue).toBe(0);
    expect(result.niftyEndValue).toBe(0);
    expect(result.totalInvested).toBe(1000);
  });

  it('returns null XIRRs (not throws) when there are zero buy cashflows', () => {
    const niftySeries = new Map<string, number>([['2020-01-01', 10000]]);
    const result = compareSymbolToNifty([], 'ACME-EQ', 0, niftySeries, 11000, '2021-01-01');

    expect(result.actualXirr).toBeNull();
    expect(result.niftyXirr).toBeNull();
    expect(result.alpha).toBeNull();
    expect(result.totalInvested).toBe(0);
    expect(result.niftyEndValue).toBe(0);
  });

  it('handles partial sell + still-held position (mid-period exit)', () => {
    // Buy 10 @ 100 on 2020-01-01 (₹1000 outflow).
    // Sell 5 @ 150 on 2020-07-01 (₹750 inflow) — actually realises part of the gain.
    // Hold 5 to 2021-01-01 with MV 5*180=900.
    const trades: Trade[] = [
      mkTrade({ id: '1', tradeDate: '2020-01-01', side: 'buy', qty: 10, price: 100 }),
      mkTrade({ id: '2', tradeDate: '2020-07-01', side: 'sell', qty: 5, price: 150 }),
    ];
    const niftySeries = new Map<string, number>([
      ['2020-01-01', 10000],
      ['2020-07-01', 12000],
      ['2021-01-01', 13000],
    ]);

    const result = compareSymbolToNifty(trades, 'ACME-EQ', 900, niftySeries, 13000, '2021-01-01');

    const expectedActual = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: 750 },
      { date: '2021-01-01', amount: 900 },
    ]);
    // Mirror: 0.1 units bought; on 2020-07-01 MV=1200; sellFraction=750/1200=0.625
    // → sell 750, residual units = 0.1 * (1-0.625) = 0.0375. Terminal MV = 0.0375*13000 = 487.5.
    const expectedNifty = xirr([
      { date: '2020-01-01', amount: -1000 },
      { date: '2020-07-01', amount: 750 },
      { date: '2021-01-01', amount: 0.0375 * 13000 },
    ]);

    expect(result.actualXirr).toBeCloseTo(expectedActual, 4);
    expect(result.niftyXirr).toBeCloseTo(expectedNifty, 4);
    expect(result.niftyEndValue).toBeCloseTo(0.0375 * 13000, 4);
    expect(result.alpha).toBeCloseTo(expectedActual - expectedNifty, 4);
  });
});
