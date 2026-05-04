import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { users, portfolios, watchlist } from '@/lib/db/schema';
import {
  addWatchlistEntry,
  getWatchlistEntry,
  listWatchlist,
  removeWatchlistEntry,
  updateWatchlistEntry,
} from '@/lib/db/queries/watchlist';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-watchlist-'));
  const dbPath = resolve(tmpDir, 'test.db');
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
  // Wipe portfolio + watchlist + users for each test, then re-seed.
  sqlite.exec('DELETE FROM watchlist;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
});

describe('watchlist queries (integration)', () => {
  it('starts empty', () => {
    expect(listWatchlist(db, portfolioId)).toEqual([]);
  });

  it('adds three entries, lists them in newest-first order, scoped to portfolio', () => {
    const a = addWatchlistEntry(db, portfolioId, {
      symbol: 'ACME-EQ',
      thesis: 'cheap moat',
      targetBuyPrice: 100,
      conviction: 'high',
    });
    // Tiny pause-equivalent: bump createdAt manually so ordering is deterministic.
    sqlite.prepare('UPDATE watchlist SET created_at = ? WHERE id = ?').run(1000, a.id);

    const b = addWatchlistEntry(db, portfolioId, {
      symbol: 'BRAVO-EQ',
      targetSellPrice: 250,
      conviction: 'low',
    });
    sqlite.prepare('UPDATE watchlist SET created_at = ? WHERE id = ?').run(2000, b.id);

    const c = addWatchlistEntry(db, portfolioId, { symbol: 'CHARLIE-EQ' });
    sqlite.prepare('UPDATE watchlist SET created_at = ? WHERE id = ?').run(3000, c.id);

    // Belongs to a different portfolio — must NOT appear in `portfolioId` list.
    addWatchlistEntry(db, otherPortfolioId, { symbol: 'ACME-EQ' });

    const list = listWatchlist(db, portfolioId);
    expect(list.map((e) => e.symbol)).toEqual(['CHARLIE-EQ', 'BRAVO-EQ', 'ACME-EQ']);

    expect(list[0]?.conviction).toBe('medium'); // default
    const acme = list.find((e) => e.symbol === 'ACME-EQ');
    expect(acme?.thesis).toBe('cheap moat');
    expect(acme?.targetBuyPrice).toBe(100);
    expect(acme?.conviction).toBe('high');
  });

  it('rejects duplicate (portfolioId, symbol)', () => {
    addWatchlistEntry(db, portfolioId, { symbol: 'ACME-EQ' });
    expect(() => addWatchlistEntry(db, portfolioId, { symbol: 'ACME-EQ' })).toThrow();
  });

  it('updates an entry and bumps updatedAt', () => {
    const e = addWatchlistEntry(db, portfolioId, {
      symbol: 'ACME-EQ',
      conviction: 'medium',
    });
    // Force created/updated timestamps to a known past value.
    sqlite.prepare('UPDATE watchlist SET created_at = 1, updated_at = 1 WHERE id = ?').run(e.id);

    const updated = updateWatchlistEntry(db, portfolioId, e.id, {
      thesis: 'new thesis',
      conviction: 'high',
      targetBuyPrice: 50,
    });
    expect(updated).not.toBeNull();
    expect(updated!.thesis).toBe('new thesis');
    expect(updated!.conviction).toBe('high');
    expect(updated!.targetBuyPrice).toBe(50);
    expect(updated!.updatedAt).toBeGreaterThan(1);
  });

  it("update is portfolio-scoped — cannot update another portfolio's entry", () => {
    const e = addWatchlistEntry(db, otherPortfolioId, { symbol: 'ACME-EQ' });
    const updated = updateWatchlistEntry(db, portfolioId, e.id, { conviction: 'low' });
    expect(updated).toBeNull();

    const stillThere = getWatchlistEntry(db, otherPortfolioId, e.id);
    expect(stillThere?.conviction).toBe('medium');
  });

  it('removes an entry; second remove is null', () => {
    const e = addWatchlistEntry(db, portfolioId, { symbol: 'ACME-EQ' });
    const removed = removeWatchlistEntry(db, portfolioId, e.id);
    expect(removed?.id).toBe(e.id);
    expect(listWatchlist(db, portfolioId)).toEqual([]);
    expect(removeWatchlistEntry(db, portfolioId, e.id)).toBeNull();
  });

  it('full lifecycle: add 3, update one, delete one, assert state', () => {
    const a = addWatchlistEntry(db, portfolioId, { symbol: 'ACME-EQ', conviction: 'high' });
    const b = addWatchlistEntry(db, portfolioId, { symbol: 'BRAVO-EQ', conviction: 'low' });
    const c = addWatchlistEntry(db, portfolioId, { symbol: 'CHARLIE-EQ' });

    expect(listWatchlist(db, portfolioId)).toHaveLength(3);

    updateWatchlistEntry(db, portfolioId, b.id, {
      conviction: 'high',
      targetBuyPrice: 75,
    });

    removeWatchlistEntry(db, portfolioId, c.id);

    const final = listWatchlist(db, portfolioId);
    expect(final).toHaveLength(2);
    const symbols = final.map((e) => e.symbol).sort();
    expect(symbols).toEqual(['ACME-EQ', 'BRAVO-EQ']);

    const bravo = final.find((e) => e.symbol === 'BRAVO-EQ')!;
    expect(bravo.conviction).toBe('high');
    expect(bravo.targetBuyPrice).toBe(75);

    const acme = final.find((e) => e.symbol === 'ACME-EQ')!;
    expect(acme.id).toBe(a.id);
    expect(acme.conviction).toBe('high');

    expect(getWatchlistEntry(db, portfolioId, c.id)).toBeNull();
    // Sanity that watchlist table reflects underlying state.
    const rowCount = sqlite
      .prepare('SELECT count(*) as n FROM watchlist WHERE portfolio_id = ?')
      .get(portfolioId) as { n: number };
    expect(rowCount.n).toBe(2);
    // Make sure the schema export matches reality.
    expect(watchlist).toBeDefined();
  });
});
