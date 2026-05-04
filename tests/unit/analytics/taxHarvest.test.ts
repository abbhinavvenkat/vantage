import { describe, it, expect } from 'vitest';
import {
  classifyLot,
  computeOpenLotsBySymbol,
  computeTaxHarvest,
} from '@/lib/analytics/taxHarvest';
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

describe('classifyLot', () => {
  it('marks a lot held >=365d at a loss as LTCL', () => {
    const lot = { qty: 10, costPerShare: 100, date: '2023-01-01' };
    const r = classifyLot(lot, 80, '2024-06-01');
    expect(r.eligibility).toBe('LTCL');
    expect(r.daysHeld).toBeGreaterThanOrEqual(365);
    expect(r.potentialLoss).toBeCloseTo(10 * (80 - 100), 6);
  });

  it('marks a lot held <365d at a loss as STCL', () => {
    const lot = { qty: 5, costPerShare: 200, date: '2024-03-01' };
    const r = classifyLot(lot, 150, '2024-06-01');
    expect(r.eligibility).toBe('STCL');
    expect(r.daysHeld).toBeLessThan(365);
    expect(r.potentialLoss).toBeCloseTo(5 * (150 - 200), 6);
  });

  it('returns none when current price is at or above cost (no loss)', () => {
    const lot = { qty: 10, costPerShare: 100, date: '2023-01-01' };
    const a = classifyLot(lot, 100, '2024-06-01');
    const b = classifyLot(lot, 120, '2024-06-01');
    expect(a.eligibility).toBe('none');
    expect(b.eligibility).toBe('none');
    expect(a.potentialLoss).toBe(0);
  });

  it('returns none when there is no last price', () => {
    const lot = { qty: 10, costPerShare: 100, date: '2023-01-01' };
    const r = classifyLot(lot, null, '2024-06-01');
    expect(r.eligibility).toBe('none');
    expect(r.potentialLoss).toBe(0);
  });

  it('treats exactly 365 days as long-term', () => {
    const lot = { qty: 1, costPerShare: 100, date: '2023-06-01' };
    const r = classifyLot(lot, 50, '2024-05-31'); // 365 days exactly
    expect(r.daysHeld).toBe(365);
    expect(r.eligibility).toBe('LTCL');
  });
});

describe('computeOpenLotsBySymbol', () => {
  it('keeps lots grouped by symbol after FIFO matching', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'BETA-EQ', tradeDate: '2023-02-01', side: 'buy', qty: 20, price: 50 }, 2),
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-06-01', side: 'sell', qty: 4, price: 110 }, 3),
    ];
    const map = computeOpenLotsBySymbol(trades, []);
    expect(map.get('ACME-EQ')?.[0]?.qty).toBe(6);
    expect(map.get('BETA-EQ')?.[0]?.qty).toBe(20);
  });
});

describe('computeTaxHarvest', () => {
  it('emits per-lot rows with classification and aggregates per-symbol totals', () => {
    const trades: NormalizedTrade[] = [
      // ACME: two open lots — old (LTCL eligible) + recent (STCL eligible).
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-04-01', side: 'buy', qty: 5, price: 120 }, 2),
      // BETA: open lot, currently profitable → none.
      trade({ symbol: 'BETA-EQ', tradeDate: '2024-01-01', side: 'buy', qty: 4, price: 50 }, 3),
    ];
    const prices = new Map<string, number>([
      ['ACME-EQ', 80],
      ['BETA-EQ', 90],
    ]);
    const { rows, totals } = computeTaxHarvest(trades, [], prices, '2024-06-01');

    // 2 ACME lots + 1 BETA lot
    expect(rows).toHaveLength(3);

    const acmeLtcl = rows.find((r) => r.symbol === 'ACME-EQ' && r.eligibility === 'LTCL');
    const acmeStcl = rows.find((r) => r.symbol === 'ACME-EQ' && r.eligibility === 'STCL');
    const beta = rows.find((r) => r.symbol === 'BETA-EQ');

    expect(acmeLtcl?.potentialLoss).toBeCloseTo(10 * (80 - 100), 6);
    expect(acmeStcl?.potentialLoss).toBeCloseTo(5 * (80 - 120), 6);
    expect(beta?.eligibility).toBe('none');
    expect(beta?.potentialLoss).toBe(0);

    expect(totals.totalLtcl).toBeCloseTo(10 * (80 - 100), 6);
    expect(totals.totalStcl).toBeCloseTo(5 * (80 - 120), 6);
    expect(totals.ltclLotCount).toBe(1);
    expect(totals.stclLotCount).toBe(1);
  });

  it('skips symbols whose open qty is fully realized (no open lots)', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-03-01', side: 'sell', qty: 10, price: 90 }, 2),
    ];
    const prices = new Map<string, number>([['ACME-EQ', 80]]);
    const { rows, totals } = computeTaxHarvest(trades, [], prices, '2024-06-01');
    expect(rows).toHaveLength(0);
    expect(totals.totalLtcl).toBe(0);
    expect(totals.totalStcl).toBe(0);
  });

  it('rolls up per-symbol summaries (sum of loss across both LTCL+STCL lots of same symbol)', () => {
    const trades: NormalizedTrade[] = [
      trade({ symbol: 'ACME-EQ', tradeDate: '2023-01-01', side: 'buy', qty: 10, price: 100 }, 1),
      trade({ symbol: 'ACME-EQ', tradeDate: '2024-04-01', side: 'buy', qty: 5, price: 120 }, 2),
    ];
    const prices = new Map<string, number>([['ACME-EQ', 80]]);
    const { bySymbol } = computeTaxHarvest(trades, [], prices, '2024-06-01');
    const acme = bySymbol.find((s) => s.symbol === 'ACME-EQ');
    expect(acme?.totalLoss).toBeCloseTo(10 * (80 - 100) + 5 * (80 - 120), 6);
    expect(acme?.ltclLoss).toBeCloseTo(10 * (80 - 100), 6);
    expect(acme?.stclLoss).toBeCloseTo(5 * (80 - 120), 6);
  });
});
