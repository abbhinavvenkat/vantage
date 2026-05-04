import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureZerodhaFixture,
  SAMPLE_FIXTURE_PATH,
  SYNTHETIC_TRADES,
} from '@/tests/fixtures/zerodhaSample';
import { zerodhaParser } from '@/lib/parsers/zerodha';

let fixtureBytes: Buffer;
let fixtureName: string;

beforeAll(() => {
  ensureZerodhaFixture(SAMPLE_FIXTURE_PATH);
  fixtureBytes = readFileSync(SAMPLE_FIXTURE_PATH);
  fixtureName = basename(SAMPLE_FIXTURE_PATH);
});

function hashTrades(trades: unknown): string {
  return createHash('sha256').update(JSON.stringify(trades)).digest('hex');
}

describe('zerodhaParser', () => {
  it('parses exactly the expected number of trades from the synthetic fixture', () => {
    const trades = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    expect(trades).toHaveLength(SYNTHETIC_TRADES.length);
  });

  it('marks every trade as INR currency and zerodha brokerCode', () => {
    const trades = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    for (const t of trades) {
      expect(t.currency).toBe('INR');
      expect(t.brokerCode).toBe('zerodha');
      expect(['buy', 'sell']).toContain(t.side);
    }
  });

  it('emits ISO yyyy-mm-dd trade dates', () => {
    const trades = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    for (const t of trades) {
      expect(t.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('strips broker client IDs from output', () => {
    const trades = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    const blob = JSON.stringify(trades);
    expect(blob).not.toMatch(/UL\d{4}/);
    expect(blob).not.toMatch(/CDSL/i);
    for (const t of trades) {
      expect(Object.keys(t)).not.toContain('clientId');
      expect(Object.keys(t)).not.toContain('client_id');
    }
  });

  it('is idempotent on re-parse (deterministic output for same input)', () => {
    const a = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    const b = zerodhaParser.parse({
      name: fixtureName,
      bytes: Buffer.from(fixtureBytes),
    });
    expect(hashTrades(a)).toBe(hashTrades(b));
  });

  it('detect() returns true on the fixture', () => {
    expect(zerodhaParser.detect({ name: fixtureName, bytes: fixtureBytes })).toBe(true);
  });

  it('detect() returns false on a CSV string', () => {
    const csv = Buffer.from('symbol,trade_date,side,qty,price\nFOO,2024-01-01,buy,1,100\n', 'utf8');
    expect(zerodhaParser.detect({ name: 'something.csv', bytes: csv })).toBe(false);
  });

  it('preserves rawRowIdx and assigns it to the spreadsheet row', () => {
    const trades = zerodhaParser.parse({ name: fixtureName, bytes: fixtureBytes });
    for (const t of trades) {
      expect(t.rawRowIdx).toBeGreaterThanOrEqual(15);
    }
    const idxs = trades.map((t) => t.rawRowIdx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });
});
