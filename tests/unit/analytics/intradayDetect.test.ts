import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ensureZerodhaFixture, SAMPLE_FIXTURE_PATH } from '@/tests/fixtures/zerodhaSample';
import { zerodhaParser } from '@/lib/parsers/zerodha';
import { detectIntradayPairs } from '@/lib/analytics/intradayDetect';
import type { NormalizedTrade } from '@/lib/parsers/types';

let trades: NormalizedTrade[];

beforeAll(() => {
  ensureZerodhaFixture(SAMPLE_FIXTURE_PATH);
  const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
  trades = zerodhaParser.parse({ name: basename(SAMPLE_FIXTURE_PATH), bytes });
});

describe('detectIntradayPairs', () => {
  it('groups exactly the 3 known same-day pairs from the synthetic fixture', () => {
    const { pairs, delivery } = detectIntradayPairs(trades);
    expect(pairs).toHaveLength(3);
    for (const [buy, sell] of pairs) {
      expect(buy.symbol).toBe(sell.symbol);
      expect(buy.tradeDate).toBe(sell.tradeDate);
      expect(buy.qty).toBe(sell.qty);
      expect(buy.side).toBe('buy');
      expect(sell.side).toBe('sell');
    }
    expect(delivery).toHaveLength(trades.length - 6);
  });

  it('excludes the paired same-day trades from the delivery list', () => {
    const { pairs, delivery } = detectIntradayPairs(trades);
    const pairedKeys = new Set<string>();
    for (const [b, s] of pairs) {
      pairedKeys.add(`${b.symbol}|${b.tradeDate}|${b.side}|${b.qty}|${b.execTime ?? ''}`);
      pairedKeys.add(`${s.symbol}|${s.tradeDate}|${s.side}|${s.qty}|${s.execTime ?? ''}`);
    }
    for (const t of delivery) {
      const k = `${t.symbol}|${t.tradeDate}|${t.side}|${t.qty}|${t.execTime ?? ''}`;
      expect(pairedKeys.has(k)).toBe(false);
    }
  });

  it('finds the GAMMA-EQ 2024-06-05, DELTA-EQ 2024-07-15, EPSILON-EQ 2024-08-08 pairs', () => {
    const { pairs } = detectIntradayPairs(trades);
    const keys = pairs.map(([b]) => `${b.symbol}|${b.tradeDate}`).sort();
    expect(keys).toEqual(['DELTA-EQ|2024-07-15', 'EPSILON-EQ|2024-08-08', 'GAMMA-EQ|2024-06-05']);
  });
});
