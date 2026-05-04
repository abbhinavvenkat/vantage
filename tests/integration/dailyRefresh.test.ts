import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as schema from '@/lib/db/schema';
import { users, portfolios, brokers, accounts, trades, pricesEod } from '@/lib/db/schema';
import * as yahoo from '@/lib/pricing/yahoo';
import * as nifty from '@/lib/pricing/nifty50';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let dbPath: string;
let logsDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let accountId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-daily-refresh-'));
  dbPath = resolve(tmpDir, 'app.db');
  logsDir = resolve(tmpDir, 'logs');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    /* ignore */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  sqlite.exec('DELETE FROM prices_eod;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM accounts;');
  sqlite.exec('DELETE FROM brokers;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  portfolioId = pf.id;
  const broker = db.insert(brokers).values({ code: 'zerodha' }).returning().get();
  const acc = db
    .insert(accounts)
    .values({ portfolioId, brokerId: broker.id, alias: 'zerodha' })
    .returning()
    .get();
  accountId = acc.id;

  // Two open positions: ACME-EQ (5 shares) and BRAVO-EQ (10 shares)
  db.insert(trades)
    .values([
      {
        accountId,
        symbol: 'ACME-EQ',
        tradeDate: '2025-01-01',
        side: 'buy',
        qty: 5,
        price: 100,
        currency: 'INR',
      },
      {
        accountId,
        symbol: 'BRAVO-EQ',
        tradeDate: '2025-01-02',
        side: 'buy',
        qty: 10,
        price: 50,
        currency: 'INR',
      },
    ])
    .run();
});

describe('daily-refresh script', () => {
  it('fetches EOD quotes for open-position symbols and upserts into prices_eod', async () => {
    const fakeQuotes = new Map([
      [
        'ACME-EQ',
        {
          symbol: 'ACME-EQ',
          yahooSymbol: 'ACME-EQ.NS',
          date: '2026-05-03',
          open: 110,
          high: 115,
          low: 108,
          close: 112,
          adjClose: 112,
          volume: 100,
          source: 'yahoo' as const,
        },
      ],
      [
        'BRAVO-EQ',
        {
          symbol: 'BRAVO-EQ',
          yahooSymbol: 'BRAVO-EQ.NS',
          date: '2026-05-03',
          open: 55,
          high: 56,
          low: 54,
          close: 55,
          adjClose: 55,
          volume: 200,
          source: 'yahoo' as const,
        },
      ],
    ]);

    const fetchSpy = vi.spyOn(yahoo, 'fetchEodQuotes').mockResolvedValue(fakeQuotes);
    const niftySpy = vi
      .spyOn(nifty, 'getNifty50SeriesCached')
      .mockResolvedValue(new Map([['2026-05-03', 24500]]));

    const { runDailyRefresh } = await import('@/scripts/daily-refresh');
    const result = await runDailyRefresh({ dbPath, logsDir, today: '2026-05-03' });

    expect(result.exitCode).toBe(0);
    expect(result.portfoliosRefreshed).toBe(1);
    expect(result.totalSymbolsRefreshed).toBe(2);

    // Validate prices were upserted
    const rows = db.select().from(pricesEod).all();
    const symbols = rows.map((r) => r.symbol).sort();
    expect(symbols).toEqual(['ACME-EQ', 'BRAVO-EQ']);

    // Validate the log file was written
    expect(existsSync(result.logFile)).toBe(true);
    const logBody = readFileSync(result.logFile, 'utf8');
    expect(logBody).toContain('Primary');
    expect(logBody).toContain('refreshed=2');
    expect(logBody).toContain('Nifty 50');

    // Validate Yahoo + Nifty were called once each
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(niftySpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
    niftySpy.mockRestore();
  });

  it('exits non-zero when no portfolios refresh cleanly', async () => {
    sqlite.exec('DELETE FROM trades;');
    sqlite.exec('DELETE FROM accounts;');
    sqlite.exec('DELETE FROM portfolios;');

    const fetchSpy = vi.spyOn(yahoo, 'fetchEodQuotes').mockResolvedValue(new Map());
    const niftySpy = vi.spyOn(nifty, 'getNifty50SeriesCached').mockResolvedValue(new Map());

    const { runDailyRefresh } = await import('@/scripts/daily-refresh');
    const result = await runDailyRefresh({ dbPath, logsDir, today: '2026-05-03' });

    expect(result.exitCode).not.toBe(0);
    expect(result.portfoliosRefreshed).toBe(0);

    fetchSpy.mockRestore();
    niftySpy.mockRestore();
  });
});
