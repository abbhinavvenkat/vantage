import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { portfolios, users } from '@/lib/db/schema';
import { listEvents } from '@/lib/db/queries/events';
import { importEventsFromFiles } from '@/lib/events/importFromFiles';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let eventsDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-events-import-'));
  eventsDir = resolve(tmpDir, 'events');
  mkdirSync(eventsDir, { recursive: true });
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
  for (const f of readdirSync(eventsDir)) unlinkSync(resolve(eventsDir, f));
  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  portfolioId = pf.id;
});

function writeEventsFile(symbol: string, events: unknown): void {
  writeFileSync(resolve(eventsDir, `${symbol}.json`), JSON.stringify({ events }), 'utf8');
}

describe('events auto-import from skill files (integration)', () => {
  it('imports a single symbol file and inserts events with source=file', () => {
    writeEventsFile('BEL', [
      { eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27 results' },
      { eventType: 'agm', eventDate: '2026-09-10', title: 'AGM' },
    ]);

    const result = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(result.filesScanned).toBe(1);
    expect(result.filesParsed).toBe(1);
    expect(result.inserted).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.errors).toEqual([]);

    const rows = listEvents(db, portfolioId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.source === 'file')).toBe(true);
    expect(rows.every((r) => r.symbol === 'BEL')).toBe(true);
  });

  it('imports multiple symbol files', () => {
    writeEventsFile('BEL', [{ eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27' }]);
    writeEventsFile('HDFCBANK', [
      { eventType: 'ex_div', eventDate: '2026-07-10', title: 'Ex-div Rs 22' },
      { eventType: 'agm', eventDate: '2026-08-25', title: 'AGM' },
    ]);

    const r = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(r.filesScanned).toBe(2);
    expect(r.filesParsed).toBe(2);
    expect(r.inserted).toBe(3);

    const symbols = listEvents(db, portfolioId)
      .map((e) => e.symbol)
      .sort();
    expect(symbols).toEqual(['BEL', 'HDFCBANK', 'HDFCBANK']);
  });

  it('is idempotent — re-running on the same files does not duplicate', () => {
    writeEventsFile('BEL', [
      { eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27' },
      { eventType: 'agm', eventDate: '2026-09-10', title: 'AGM' },
    ]);

    const r1 = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(r1.inserted).toBe(2);
    expect(r1.skipped).toBe(0);

    const r2 = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(r2.inserted).toBe(0);
    expect(r2.skipped).toBe(2);

    expect(listEvents(db, portfolioId)).toHaveLength(2);
  });

  it('mixes new + existing — re-run with one new event inserts only the new', () => {
    writeEventsFile('BEL', [{ eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27' }]);
    importEventsFromFiles(db, portfolioId, eventsDir);

    writeEventsFile('BEL', [
      { eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27' },
      { eventType: 'ex_div', eventDate: '2026-09-01', title: 'Ex-div Rs 1.50' },
    ]);
    const r = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(r.inserted).toBe(1);
    expect(r.skipped).toBe(1);
    expect(listEvents(db, portfolioId)).toHaveLength(2);
  });

  it('records error for malformed JSON and bad schema, continues with valid files', () => {
    writeFileSync(resolve(eventsDir, 'BAD.json'), '{not json', 'utf8');
    writeFileSync(
      resolve(eventsDir, 'WRONG.json'),
      JSON.stringify({ events: [{ eventType: 'invalid', eventDate: '2026-08-15', title: 'x' }] }),
      'utf8',
    );
    writeEventsFile('BEL', [{ eventType: 'earnings', eventDate: '2026-08-15', title: 'Q1 FY27' }]);

    const r = importEventsFromFiles(db, portfolioId, eventsDir);
    expect(r.filesScanned).toBe(3);
    expect(r.filesParsed).toBe(1);
    expect(r.inserted).toBe(1);
    expect(r.errors).toHaveLength(2);
    expect(r.errors.some((e) => e.reason.startsWith('parse_error'))).toBe(true);
    expect(r.errors.some((e) => e.reason === 'schema_invalid')).toBe(true);
  });

  it('returns zero counts when events dir does not exist', () => {
    const missing = resolve(tmpDir, 'does-not-exist');
    const r = importEventsFromFiles(db, portfolioId, missing);
    expect(r).toEqual({ inserted: 0, skipped: 0, filesScanned: 0, filesParsed: 0, errors: [] });
  });
});
