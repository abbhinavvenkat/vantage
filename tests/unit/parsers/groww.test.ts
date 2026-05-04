import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { createHash } from 'node:crypto';
import {
  ensureGrowwXlsxFixture,
  GROWW_XLSX_FIXTURE_PATH,
  GROWW_SYNTHETIC_TRADES,
  buildGrowwCsv,
} from '@/tests/fixtures/growwSample';
import { growwParser } from '@/lib/parsers/groww';
import { detectParser } from '@/lib/parsers/registry';

let xlsxBytes: Buffer;
let xlsxName: string;
let csvBytes: Buffer;

beforeAll(() => {
  ensureGrowwXlsxFixture(GROWW_XLSX_FIXTURE_PATH);
  xlsxBytes = readFileSync(GROWW_XLSX_FIXTURE_PATH);
  xlsxName = basename(GROWW_XLSX_FIXTURE_PATH);
  csvBytes = Buffer.from(buildGrowwCsv(), 'utf8');
});

function hashTrades(trades: unknown): string {
  return createHash('sha256').update(JSON.stringify(trades)).digest('hex');
}

describe('growwParser', () => {
  it('exposes broker code "groww"', () => {
    expect(growwParser.code).toBe('groww');
  });

  it('detect() returns true on the synthetic xlsx fixture', () => {
    expect(growwParser.detect({ name: xlsxName, bytes: xlsxBytes })).toBe(true);
  });

  it('detect() returns true on the synthetic csv fixture', () => {
    expect(growwParser.detect({ name: 'tradebook.csv', bytes: csvBytes })).toBe(true);
  });

  it('detect() returns false on an unrelated csv', () => {
    const csv = Buffer.from('symbol,date,side,qty,price\nFOO,2024-01-01,buy,1,100\n', 'utf8');
    expect(growwParser.detect({ name: 'something.csv', bytes: csv })).toBe(false);
  });

  it('parses exactly the expected number of trades from the xlsx fixture', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    expect(trades).toHaveLength(GROWW_SYNTHETIC_TRADES.length);
  });

  it('parses exactly the expected number of trades from the csv fixture', () => {
    const trades = growwParser.parse({ name: 'tradebook.csv', bytes: csvBytes });
    expect(trades).toHaveLength(GROWW_SYNTHETIC_TRADES.length);
  });

  it('marks every trade as INR currency and groww brokerCode', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    for (const t of trades) {
      expect(t.currency).toBe('INR');
      expect(t.brokerCode).toBe('groww');
      expect(['buy', 'sell']).toContain(t.side);
    }
  });

  it('emits ISO yyyy-mm-dd trade dates', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    for (const t of trades) {
      expect(t.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('captures dedup keys (tradeId, symbol, qty, price, side, execTime)', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    for (const t of trades) {
      expect(typeof t.tradeId).toBe('string');
      expect(t.tradeId && t.tradeId.length).toBeGreaterThan(0);
      expect(typeof t.symbol).toBe('string');
      expect(typeof t.qty).toBe('number');
      expect(typeof t.price).toBe('number');
      expect(typeof t.execTime).toBe('string');
    }
    const tradeIds = trades.map((t) => t.tradeId!);
    expect(new Set(tradeIds).size).toBe(tradeIds.length);
  });

  it('strips broker client IDs from output', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    const blob = JSON.stringify(trades);
    expect(blob).not.toMatch(/UL\d{4}/);
    expect(blob).not.toMatch(/CDSL/i);
    for (const t of trades) {
      expect(Object.keys(t)).not.toContain('clientId');
      expect(Object.keys(t)).not.toContain('client_id');
    }
  });

  it('is idempotent on re-parse (deterministic output for same input)', () => {
    const a = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    const b = growwParser.parse({ name: xlsxName, bytes: Buffer.from(xlsxBytes) });
    expect(hashTrades(a)).toBe(hashTrades(b));
  });

  it('xlsx and csv variants produce the same trade rows (ignoring rawRowIdx)', () => {
    const xlsxTrades = growwParser
      .parse({ name: xlsxName, bytes: xlsxBytes })
      .map(({ rawRowIdx: _r, ...rest }) => rest);
    const csvTrades = growwParser
      .parse({ name: 'tradebook.csv', bytes: csvBytes })
      .map(({ rawRowIdx: _r, ...rest }) => rest);
    expect(hashTrades(xlsxTrades)).toBe(hashTrades(csvTrades));
  });

  it('preserves rawRowIdx and assigns it uniquely', () => {
    const trades = growwParser.parse({ name: xlsxName, bytes: xlsxBytes });
    const idxs = trades.map((t) => t.rawRowIdx);
    expect(new Set(idxs).size).toBe(idxs.length);
    for (const i of idxs) expect(i).toBeGreaterThanOrEqual(2);
  });
});

describe('registry: detectParser picks growwParser for groww files', () => {
  it('routes xlsx fixture to growwParser', () => {
    const p = detectParser({ name: xlsxName, bytes: xlsxBytes });
    expect(p?.code).toBe('groww');
  });

  it('routes csv fixture to growwParser', () => {
    const p = detectParser({ name: 'tradebook.csv', bytes: csvBytes });
    expect(p?.code).toBe('groww');
  });
});
