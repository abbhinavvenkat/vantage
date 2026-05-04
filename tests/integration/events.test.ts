import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { events, portfolios, users } from '@/lib/db/schema';
import {
  addEvent,
  bulkImportEvents,
  getEvent,
  listEvents,
  removeEvent,
} from '@/lib/db/queries/events';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-events-'));
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
  sqlite.exec('DELETE FROM events;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
});

describe('events queries (integration)', () => {
  it('starts empty', () => {
    expect(listEvents(db, portfolioId)).toEqual([]);
  });

  it('adds 3 events across 2 symbols, lists in date-asc order, scoped to portfolio', () => {
    addEvent(db, portfolioId, {
      symbol: 'ACME-EQ',
      eventType: 'earnings',
      eventDate: '2026-08-15',
      title: 'Q1 FY27 results',
    });
    addEvent(db, portfolioId, {
      symbol: 'ACME-EQ',
      eventType: 'agm',
      eventDate: '2026-06-30',
      title: 'AGM',
    });
    addEvent(db, portfolioId, {
      symbol: 'BRAVO-EQ',
      eventType: 'ex_div',
      eventDate: '2026-07-10',
      title: 'Ex-dividend ₹5',
    });

    // Other portfolio — must not appear.
    addEvent(db, otherPortfolioId, {
      symbol: 'ACME-EQ',
      eventType: 'earnings',
      eventDate: '2026-08-15',
      title: 'Q1 FY27 results',
    });

    const list = listEvents(db, portfolioId);
    expect(list).toHaveLength(3);
    expect(list.map((e) => e.eventDate)).toEqual(['2026-06-30', '2026-07-10', '2026-08-15']);
    expect(list[0]?.symbol).toBe('ACME-EQ');
    expect(list[0]?.eventType).toBe('agm');
    expect(list[2]?.eventType).toBe('earnings');
  });

  it('filters by date range', () => {
    addEvent(db, portfolioId, {
      symbol: 'A',
      eventType: 'earnings',
      eventDate: '2026-06-01',
      title: 'A earnings',
    });
    addEvent(db, portfolioId, {
      symbol: 'B',
      eventType: 'agm',
      eventDate: '2026-07-15',
      title: 'B AGM',
    });
    addEvent(db, portfolioId, {
      symbol: 'C',
      eventType: 'ex_div',
      eventDate: '2026-09-01',
      title: 'C ex-div',
    });

    const inRange = listEvents(db, portfolioId, {
      fromDate: '2026-06-15',
      toDate: '2026-08-15',
    });
    expect(inRange.map((e) => e.symbol)).toEqual(['B']);
  });

  it('returns descending order on request', () => {
    addEvent(db, portfolioId, {
      symbol: 'A',
      eventType: 'earnings',
      eventDate: '2026-06-01',
      title: 'A',
    });
    addEvent(db, portfolioId, {
      symbol: 'B',
      eventType: 'agm',
      eventDate: '2026-07-01',
      title: 'B',
    });
    const desc = listEvents(db, portfolioId, { order: 'desc' });
    expect(desc.map((e) => e.symbol)).toEqual(['B', 'A']);
  });

  it("get/remove are portfolio-scoped — cannot reach other portfolio's row", () => {
    const e = addEvent(db, otherPortfolioId, {
      symbol: 'ACME',
      eventType: 'earnings',
      eventDate: '2026-08-15',
      title: 'x',
    });
    expect(getEvent(db, portfolioId, e.id)).toBeNull();
    expect(removeEvent(db, portfolioId, e.id)).toBeNull();
    // Still there for the owner.
    expect(getEvent(db, otherPortfolioId, e.id)).not.toBeNull();
  });

  it('removes an event; second remove is null', () => {
    const e = addEvent(db, portfolioId, {
      symbol: 'ACME',
      eventType: 'earnings',
      eventDate: '2026-08-15',
      title: 'x',
    });
    const removed = removeEvent(db, portfolioId, e.id);
    expect(removed?.id).toBe(e.id);
    expect(listEvents(db, portfolioId)).toEqual([]);
    expect(removeEvent(db, portfolioId, e.id)).toBeNull();
  });

  it('rejects exact-duplicate (portfolioId, symbol, eventType, eventDate, title)', () => {
    addEvent(db, portfolioId, {
      symbol: 'ACME',
      eventType: 'earnings',
      eventDate: '2026-08-15',
      title: 'Q1 FY27 results',
    });
    expect(() =>
      addEvent(db, portfolioId, {
        symbol: 'ACME',
        eventType: 'earnings',
        eventDate: '2026-08-15',
        title: 'Q1 FY27 results',
      }),
    ).toThrow();
  });

  it('bulkImportEvents is idempotent on the dedupe key', () => {
    const rows = [
      {
        symbol: 'ACME',
        eventType: 'earnings' as const,
        eventDate: '2026-08-15',
        title: 'Q1 results',
      },
      {
        symbol: 'ACME',
        eventType: 'agm' as const,
        eventDate: '2026-06-30',
        title: 'AGM',
      },
    ];
    const r1 = bulkImportEvents(db, portfolioId, rows);
    expect(r1).toEqual({ inserted: 2, skipped: 0 });

    // Re-run with same rows + 1 new row — only the new one inserts.
    const r2 = bulkImportEvents(db, portfolioId, [
      ...rows,
      {
        symbol: 'BRAVO',
        eventType: 'ex_div' as const,
        eventDate: '2026-07-01',
        title: 'Ex-div',
      },
    ]);
    expect(r2).toEqual({ inserted: 1, skipped: 2 });

    // Total rows in this portfolio = 3.
    const all = listEvents(db, portfolioId);
    expect(all).toHaveLength(3);
  });

  it('full lifecycle: add 3, list, delete one, list again', () => {
    const a = addEvent(db, portfolioId, {
      symbol: 'A',
      eventType: 'earnings',
      eventDate: '2026-07-01',
      title: 'A',
    });
    addEvent(db, portfolioId, {
      symbol: 'B',
      eventType: 'agm',
      eventDate: '2026-08-01',
      title: 'B',
    });
    addEvent(db, portfolioId, {
      symbol: 'C',
      eventType: 'ex_div',
      eventDate: '2026-09-01',
      title: 'C',
    });
    expect(listEvents(db, portfolioId)).toHaveLength(3);
    removeEvent(db, portfolioId, a.id);
    const final = listEvents(db, portfolioId);
    expect(final).toHaveLength(2);
    expect(final.map((e) => e.symbol).sort()).toEqual(['B', 'C']);
    // Schema export is real.
    expect(events).toBeDefined();
  });
});
