import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { accounts, brokers, portfolios, pricesEod, trades, users } from '@/lib/db/schema';
import { generateMonthlySnapshotPdf } from '@/lib/pdf/monthlySnapshot';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-pdf-'));
  const dbPath = resolve(tmpDir, 'test.db');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });

  // Seed: user, portfolio, broker, account, trades, prices.
  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Test Portfolio' }).returning().get();
  portfolioId = pf.id;

  const broker = db.insert(brokers).values({ code: 'zerodha' }).returning().get();
  const acct = db
    .insert(accounts)
    .values({ portfolioId, brokerId: broker.id, alias: 'Primary' })
    .returning()
    .get();

  // Two open positions and one fully-realized round trip.
  db.insert(trades)
    .values([
      {
        accountId: acct.id,
        symbol: 'ACME-EQ',
        tradeDate: '2024-01-15',
        side: 'buy',
        qty: 100,
        price: 100,
        currency: 'INR',
      },
      {
        accountId: acct.id,
        symbol: 'WIDGET-EQ',
        tradeDate: '2024-03-20',
        side: 'buy',
        qty: 50,
        price: 200,
        currency: 'INR',
      },
      {
        accountId: acct.id,
        symbol: 'ROUNDTRIP-EQ',
        tradeDate: '2024-02-01',
        side: 'buy',
        qty: 10,
        price: 500,
        currency: 'INR',
      },
      {
        accountId: acct.id,
        symbol: 'ROUNDTRIP-EQ',
        tradeDate: '2024-06-01',
        side: 'sell',
        qty: 10,
        price: 700,
        currency: 'INR',
      },
    ])
    .run();

  db.insert(pricesEod)
    .values([
      {
        symbol: 'ACME-EQ',
        date: '2024-12-31',
        open: 110,
        high: 115,
        low: 108,
        close: 120,
        adjClose: 120,
        volume: 1000,
        source: 'yahoo',
      },
      {
        symbol: 'WIDGET-EQ',
        date: '2024-12-31',
        open: 240,
        high: 245,
        low: 235,
        close: 250,
        adjClose: 250,
        volume: 500,
        source: 'yahoo',
      },
    ])
    .run();
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    /* ignore */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateMonthlySnapshotPdf', () => {
  it('returns a non-empty PDF buffer with %PDF magic header', async () => {
    const buf = await generateMonthlySnapshotPdf(db, portfolioId, '2024-12-31');
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(1000);
    // PDF magic bytes: %PDF-
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('throws when portfolio does not exist', async () => {
    await expect(generateMonthlySnapshotPdf(db, 'no-such-pf', '2024-12-31')).rejects.toThrow();
  });
});
