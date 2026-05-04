import { describe, it, expect } from 'vitest';
import {
  aggregateByEntryFy,
  aggregateBySector,
  buildSymbolAggregates,
  fyOf,
  type SymbolAggregate,
} from '@/lib/analytics/cohorts';
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

function agg(partial: Partial<SymbolAggregate> & { symbol: string }): SymbolAggregate {
  return {
    firstBuyDate: '2024-04-01',
    firstBuyFy: 'FY25',
    invested: 0,
    sold: 0,
    realizedPnl: 0,
    openQty: 0,
    openCostBasis: 0,
    marketValue: 0,
    unrealizedPnl: 0,
    ...partial,
  };
}

describe('fyOf', () => {
  it('puts April-onwards in next FY', () => {
    expect(fyOf('2024-04-01')).toBe('FY25');
    expect(fyOf('2024-12-31')).toBe('FY25');
  });
  it('puts Jan-March in same FY suffix as year', () => {
    expect(fyOf('2024-03-31')).toBe('FY24');
    expect(fyOf('2025-01-15')).toBe('FY25');
  });
});

describe('buildSymbolAggregates', () => {
  it('captures invested, realized, open, MV with first-buy FY for each symbol', () => {
    const trades: NormalizedTrade[] = [
      // ACME: buy 10 @ 100 (FY25), buy 5 @ 120 (FY25), sell 8 @ 150 (FY26)
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-05-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-09-01', side: 'buy', qty: 5, price: 120 }, 2),
      trade({ symbol: 'ACME-EQ', tradeDate: '2025-06-01', side: 'sell', qty: 8, price: 150 }, 3),
      // BETA: buy 4 @ 200 in FY24
      trade({ symbol: 'BETA-EQ', tradeDate: '2023-05-01', side: 'buy', qty: 4, price: 200 }, 4),
    ];
    const cmp = new Map<string, number>([
      ['ACME-EQ', 160],
      ['BETA-EQ', 250],
    ]);
    const aggs = buildSymbolAggregates(trades, [], cmp);
    const acme = aggs.find((a) => a.symbol === 'ACME-EQ')!;
    const beta = aggs.find((a) => a.symbol === 'BETA-EQ')!;

    expect(acme.firstBuyFy).toBe('FY25');
    expect(acme.invested).toBeCloseTo(10 * 100 + 5 * 120, 6);
    expect(acme.sold).toBeCloseTo(8 * 150, 6);
    // FIFO: 8 sold from 100-lot → realized = 8 * (150-100) = 400
    expect(acme.realizedPnl).toBeCloseTo(400, 6);
    // Remaining: 2 @ 100 + 5 @ 120 = 7 shares, basis = 200 + 600 = 800
    expect(acme.openQty).toBe(7);
    expect(acme.openCostBasis).toBeCloseTo(800, 6);
    expect(acme.marketValue).toBeCloseTo(7 * 160, 6);
    expect(acme.unrealizedPnl).toBeCloseTo(7 * 160 - 800, 6);

    expect(beta.firstBuyFy).toBe('FY24');
    expect(beta.openQty).toBe(4);
    expect(beta.marketValue).toBeCloseTo(4 * 250, 6);
  });

  it('falls back to cost basis when CMP is missing', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'NOPRICE', tradeDate: '2024-05-01', side: 'buy', qty: 3, price: 50 }, 1),
    ];
    const aggs = buildSymbolAggregates(trades, [], new Map());
    expect(aggs[0]?.marketValue).toBeCloseTo(150, 6);
    expect(aggs[0]?.unrealizedPnl).toBeCloseTo(0, 6);
  });
});

describe('aggregateByEntryFy', () => {
  it('groups symbols by first-buy FY and computes totals + return%', () => {
    const aggs: SymbolAggregate[] = [
      agg({
        symbol: 'A',
        firstBuyFy: 'FY24',
        invested: 1000,
        realizedPnl: 100,
        openCostBasis: 0,
        marketValue: 0,
        unrealizedPnl: 0,
      }),
      agg({
        symbol: 'B',
        firstBuyFy: 'FY25',
        invested: 2000,
        realizedPnl: 0,
        openCostBasis: 2000,
        marketValue: 2400,
        unrealizedPnl: 400,
      }),
      agg({
        symbol: 'C',
        firstBuyFy: 'FY25',
        invested: 500,
        realizedPnl: 50,
        openCostBasis: 0,
        marketValue: 0,
        unrealizedPnl: 0,
      }),
    ];
    const rows = aggregateByEntryFy(aggs);
    expect(rows.map((r) => r.bucket)).toEqual(['FY24', 'FY25']);

    const fy24 = rows.find((r) => r.bucket === 'FY24')!;
    expect(fy24.symbols).toEqual(['A']);
    expect(fy24.invested).toBe(1000);
    expect(fy24.realizedPnl).toBe(100);
    expect(fy24.totalReturnPct).toBeCloseTo(10, 6);

    const fy25 = rows.find((r) => r.bucket === 'FY25')!;
    expect(fy25.symbols).toEqual(['B', 'C']);
    expect(fy25.invested).toBe(2500);
    expect(fy25.realizedPnl).toBe(50);
    expect(fy25.unrealizedPnl).toBe(400);
    // (50 + 400) / 2500 = 18%
    expect(fy25.totalReturnPct).toBeCloseTo(18, 6);
    // weight = MV(2400) / total MV(2400) * 100 = 100 (since A and C have MV 0)
    expect(fy25.weightPct).toBeCloseTo(100, 6);
  });

  it('handles zero invested gracefully', () => {
    const aggs: SymbolAggregate[] = [
      agg({ symbol: 'X', firstBuyFy: 'FY25', invested: 0, realizedPnl: 0 }),
    ];
    const rows = aggregateByEntryFy(aggs);
    expect(rows[0]?.totalReturnPct).toBe(0);
  });
});

describe('aggregateBySector', () => {
  it('uses SECTOR_MAP and falls back to Unclassified', () => {
    const aggs: SymbolAggregate[] = [
      agg({ symbol: 'TCS', invested: 1000, marketValue: 1200, unrealizedPnl: 200 }),
      agg({ symbol: 'HCLTECH', invested: 500, marketValue: 600, unrealizedPnl: 100 }),
      agg({ symbol: 'HDFCBANK', invested: 800, marketValue: 900, unrealizedPnl: 100 }),
      agg({ symbol: 'UNKNOWN-EQ', invested: 100, marketValue: 110, unrealizedPnl: 10 }),
    ];
    const rows = aggregateBySector(aggs);
    const buckets = rows.map((r) => r.bucket);
    expect(buckets).toContain('Software Services');
    expect(buckets).toContain('Financial Services');
    expect(buckets).toContain('Unclassified');

    const sw = rows.find((r) => r.bucket === 'Software Services')!;
    expect(sw.symbols).toEqual(['HCLTECH', 'TCS']);
    expect(sw.invested).toBe(1500);
    expect(sw.marketValue).toBe(1800);

    // Sorted by MV desc → Software Services (1800) first, Financial (900), Unclassified (110)
    expect(rows[0]?.bucket).toBe('Software Services');
    expect(rows[rows.length - 1]?.bucket).toBe('Unclassified');

    // Weights sum to ~100
    const totalWeight = rows.reduce((s, r) => s + r.weightPct, 0);
    expect(totalWeight).toBeCloseTo(100, 6);
  });
});
