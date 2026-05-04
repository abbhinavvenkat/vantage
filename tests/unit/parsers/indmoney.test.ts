import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { indmoneyParser } from '@/lib/parsers/indmoney';
import { detectParser } from '@/lib/parsers/registry';

// Real IndMoney US-equities order report (gitignored under data/indmoney_data/).
// Filenames embed a broker client ID (`XX<digits>`) — the parser must strip
// every trace of that ID from output.
const FIXTURE_DIR = resolve(process.env.INDMONEY_DATA_DIR ?? './data/indmoney_data');
const ORDER_REPORT_RE = /^IND-ORDER_REPORT.*\.xlsx?$/i;

const fixtureName = existsSync(FIXTURE_DIR)
  ? (readdirSync(FIXTURE_DIR).find((f) => ORDER_REPORT_RE.test(f)) ?? null)
  : null;
const REAL_FIXTURE_PATH = fixtureName ? resolve(FIXTURE_DIR, fixtureName) : null;

// Broker-client-ID patterns in IndMoney exports: filename encodes "XX" followed
// by digits, and the metadata block contains a numeric `Broker Account` value.
// Neither must appear in parsed output.
const CLIENT_ID_FILENAME_RE = /XX\d{6,}/;
const BROKER_ACCOUNT_RE = /\d{9}/; // generic 9-digit numeric broker account

let fixtureBytes: Buffer;
const fixtureAvailable = REAL_FIXTURE_PATH != null && existsSync(REAL_FIXTURE_PATH);
// Non-null aliases safe to use inside describeWithFixture blocks (run only when fixtureAvailable).
const fixtureFile = (fixtureName ?? '') as string;

beforeAll(() => {
  if (fixtureAvailable && REAL_FIXTURE_PATH) {
    fixtureBytes = readFileSync(REAL_FIXTURE_PATH);
  }
});

function hashTrades(trades: unknown): string {
  return createHash('sha256').update(JSON.stringify(trades)).digest('hex');
}

const describeWithFixture = fixtureAvailable ? describe : describe.skip;

describe('indmoneyParser (unit)', () => {
  it('exposes broker code "indmoney"', () => {
    expect(indmoneyParser.code).toBe('indmoney');
  });

  it('detect() returns false on a CSV string', () => {
    const csv = Buffer.from('symbol,date,side,qty,price\nFOO,2024-01-01,buy,1,100\n', 'utf8');
    expect(indmoneyParser.detect({ name: 'something.csv', bytes: csv })).toBe(false);
  });

  it('detect() returns false on an empty buffer', () => {
    expect(indmoneyParser.detect({ name: 'x.xls', bytes: Buffer.alloc(0) })).toBe(false);
  });
});

describeWithFixture('indmoneyParser against the real fixture', () => {
  it('detect() returns true on the real fixture', () => {
    expect(indmoneyParser.detect({ name: fixtureFile, bytes: fixtureBytes })).toBe(true);
  });

  it('parses a non-zero number of trades', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    expect(trades.length).toBeGreaterThan(0);
  });

  it('marks every trade as USD currency and indmoney brokerCode', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    for (const t of trades) {
      expect(t.currency).toBe('USD');
      expect(t.brokerCode).toBe('indmoney');
      expect(['buy', 'sell']).toContain(t.side);
    }
  });

  it('every trade has a non-empty symbol and positive qty/price', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    for (const t of trades) {
      expect(typeof t.symbol).toBe('string');
      expect(t.symbol.length).toBeGreaterThan(0);
      expect(typeof t.qty).toBe('number');
      expect(t.qty).toBeGreaterThan(0);
      expect(typeof t.price).toBe('number');
      expect(t.price).toBeGreaterThan(0);
    }
  });

  it('emits ISO yyyy-mm-dd trade dates', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    for (const t of trades) {
      expect(t.tradeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('captures dedup keys (orderId, symbol, qty, price, side, execTime)', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    for (const t of trades) {
      expect(typeof t.orderId).toBe('string');
      expect(t.orderId && t.orderId.length).toBeGreaterThan(0);
      expect(typeof t.execTime).toBe('string');
      expect(t.execTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    }
    const orderIds = trades.map((t) => t.orderId!);
    expect(new Set(orderIds).size).toBe(orderIds.length);
  });

  it('rawRowIdx is unique per parsed trade', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    const idxs = trades.map((t) => t.rawRowIdx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });

  it('strips broker client IDs from output (filename pattern + Broker Account)', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    const blob = JSON.stringify(trades);
    // Sanity: the patterns we test for actually exist somewhere related to the
    // fixture (defends against a no-op assertion).
    expect(CLIENT_ID_FILENAME_RE.test(fixtureFile)).toBe(true);
    // Output must not leak either pattern.
    expect(blob).not.toMatch(CLIENT_ID_FILENAME_RE);
    expect(blob).not.toMatch(BROKER_ACCOUNT_RE);
    for (const t of trades) {
      expect(Object.keys(t)).not.toContain('clientId');
      expect(Object.keys(t)).not.toContain('client_id');
      expect(Object.keys(t)).not.toContain('brokerAccount');
    }
  });

  it('is idempotent on re-parse (deterministic output for same input)', () => {
    const a = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    const b = indmoneyParser.parse({ name: fixtureFile, bytes: Buffer.from(fixtureBytes) });
    expect(hashTrades(a)).toBe(hashTrades(b));
  });

  it('supports fractional quantities (IndMoney fractional-share invariant)', () => {
    const trades = indmoneyParser.parse({ name: fixtureFile, bytes: fixtureBytes });
    const fractional = trades.filter((t) => !Number.isInteger(t.qty));
    expect(fractional.length).toBeGreaterThan(0);
  });
});

describeWithFixture('registry: detectParser routes IndMoney files to indmoneyParser', () => {
  it('routes the real fixture to indmoneyParser', () => {
    const p = detectParser({ name: fixtureFile, bytes: fixtureBytes });
    expect(p?.code).toBe('indmoney');
  });
});
