import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { portfolios, users } from '@/lib/db/schema';
import { importBatch, listFilings, markRead, markUnread } from '@/lib/db/queries/filings';
import { importFilings } from '@/lib/llm/importFilings';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let researchDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-filings-'));
  const dbPath = resolve(tmpDir, 'test.db');
  researchDir = resolve(tmpDir, 'research');
  mkdirSync(researchDir, { recursive: true });
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
  sqlite.exec('DELETE FROM filings;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
  // Wipe research dir between tests.
  rmSync(researchDir, { recursive: true, force: true });
  mkdirSync(researchDir, { recursive: true });
});

function writeBatch(symbol: string, batchId: string, body: unknown): string {
  const dir = resolve(researchDir, symbol, 'filings-triage');
  mkdirSync(dir, { recursive: true });
  const filePath = resolve(dir, `${batchId}.json`);
  writeFileSync(filePath, JSON.stringify(body));
  return filePath;
}

describe('filings queries (integration)', () => {
  it('starts empty', () => {
    expect(listFilings(db, portfolioId)).toEqual([]);
  });

  it('importBatch inserts new rows and is idempotent on (portfolioId, url)', () => {
    const items = [
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/ar25.pdf',
        title: 'Annual Report FY25',
        filingType: 'annual_report' as const,
        triage: 'read_now' as const,
        summaryOneLine: 'Revenue up 18%',
        publishedAt: '2025-08-01',
      },
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/q3.pdf',
        title: 'Q3 results',
        filingType: 'quarterly_results' as const,
        triage: 'skim' as const,
        summaryOneLine: null,
        publishedAt: null,
      },
    ];
    const r1 = importBatch(db, portfolioId, items);
    expect(r1).toEqual({ inserted: 2, updated: 0, skipped: 0 });

    // Re-import same: should update, not duplicate.
    const r2 = importBatch(db, portfolioId, items);
    expect(r2).toEqual({ inserted: 0, updated: 2, skipped: 0 });

    const list = listFilings(db, portfolioId);
    expect(list).toHaveLength(2);
    expect(list.map((f) => f.url).sort()).toEqual(
      ['https://example.com/ar25.pdf', 'https://example.com/q3.pdf'].sort(),
    );
  });

  it('importBatch keeps isRead sticky on re-import', () => {
    const item = {
      symbol: 'ACME-EQ',
      url: 'https://example.com/ar25.pdf',
      title: 'AR FY25',
      filingType: 'annual_report' as const,
      triage: 'read_now' as const,
    };
    importBatch(db, portfolioId, [item]);
    const [row] = listFilings(db, portfolioId);
    expect(row).toBeDefined();
    markRead(db, portfolioId, row!.id);

    // Re-import; isRead must remain 1.
    importBatch(db, portfolioId, [{ ...item, title: 'AR FY25 (revised)' }]);
    const after = listFilings(db, portfolioId);
    expect(after).toHaveLength(1);
    expect(after[0]!.isRead).toBe(1);
    expect(after[0]!.title).toBe('AR FY25 (revised)');
  });

  it('listFilings filters by isRead, triage, and symbol; scoped to portfolio', () => {
    importBatch(db, portfolioId, [
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/a',
        title: 'A',
        filingType: 'annual_report',
        triage: 'read_now',
      },
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/b',
        title: 'B',
        filingType: 'quarterly_results',
        triage: 'skim',
      },
      {
        symbol: 'BRAVO-EQ',
        url: 'https://example.com/c',
        title: 'C',
        filingType: 'announcement',
        triage: 'ignore',
      },
    ]);
    importBatch(db, otherPortfolioId, [
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/a',
        title: 'A (other portfolio)',
        filingType: 'annual_report',
        triage: 'read_now',
      },
    ]);

    expect(listFilings(db, portfolioId)).toHaveLength(3);
    expect(listFilings(db, portfolioId, { triage: 'read_now' }).map((f) => f.title)).toEqual(['A']);
    expect(
      listFilings(db, portfolioId, { symbol: 'ACME-EQ' })
        .map((f) => f.title)
        .sort(),
    ).toEqual(['A', 'B']);
    expect(listFilings(db, portfolioId, { isRead: false })).toHaveLength(3);

    // Mark one read; filter changes accordingly.
    const [first] = listFilings(db, portfolioId, { triage: 'read_now' });
    markRead(db, portfolioId, first!.id);
    expect(listFilings(db, portfolioId, { isRead: true }).map((f) => f.title)).toEqual(['A']);
    expect(listFilings(db, portfolioId, { isRead: false })).toHaveLength(2);
  });

  it('markRead and markUnread are portfolio-scoped', () => {
    importBatch(db, portfolioId, [
      {
        symbol: 'ACME-EQ',
        url: 'https://example.com/a',
        title: 'A',
        filingType: 'annual_report',
      },
    ]);
    const [row] = listFilings(db, portfolioId);
    expect(row).toBeDefined();
    expect(row!.isRead).toBe(0);

    // Wrong portfolio cannot mutate.
    expect(markRead(db, otherPortfolioId, row!.id)).toBeNull();
    expect(listFilings(db, portfolioId)[0]!.isRead).toBe(0);

    // Correct portfolio toggles.
    expect(markRead(db, portfolioId, row!.id)?.isRead).toBe(1);
    expect(markUnread(db, portfolioId, row!.id)?.isRead).toBe(0);
  });
});

describe('importFilings (filesystem JSON reader)', () => {
  it('reads valid JSON files under data/research/<symbol>/filings-triage and upserts', () => {
    writeBatch('ACME-EQ', 'b1', {
      symbol: 'ACME-EQ',
      batch_id: 'b1',
      scanned_at: '2026-05-03T00:00:00Z',
      filings: [
        {
          url: 'https://example.com/ar25.pdf',
          title: 'Annual Report FY25',
          type: 'annual_report',
          triage: 'read_now',
          summary_one_line: 'Revenue up 18%',
          published_at: '2025-08-01',
        },
        {
          url: 'https://example.com/q3.pdf',
          title: 'Q3 results',
          type: 'Quarterly Results',
          triage: 'skim',
        },
      ],
    });

    writeBatch('BRAVO-EQ', 'b1', {
      symbol: 'BRAVO-EQ',
      batch_id: 'b1',
      filings: [
        {
          url: 'https://example.com/bravo-pres.pdf',
          title: 'Investor Presentation',
          type: 'investor_presentation',
          triage: 'skim',
        },
      ],
    });

    const r = importFilings(db, portfolioId, { researchDir });
    expect(r.filesScanned).toBe(2);
    expect(r.filesParsed).toBe(2);
    expect(r.filesInvalid).toBe(0);
    expect(r.inserted).toBe(3);

    const list = listFilings(db, portfolioId);
    expect(list).toHaveLength(3);
    expect(list.find((f) => f.url === 'https://example.com/q3.pdf')?.filingType).toBe(
      'quarterly_results',
    );
  });

  it('idempotency: running importFilings twice does not duplicate rows', () => {
    writeBatch('ACME-EQ', 'b1', {
      symbol: 'ACME-EQ',
      batch_id: 'b1',
      filings: [
        {
          url: 'https://example.com/ar25.pdf',
          title: 'AR FY25',
          type: 'annual_report',
          triage: 'read_now',
        },
      ],
    });

    const r1 = importFilings(db, portfolioId, { researchDir });
    expect(r1.inserted).toBe(1);
    expect(listFilings(db, portfolioId)).toHaveLength(1);

    const r2 = importFilings(db, portfolioId, { researchDir });
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(1);
    expect(listFilings(db, portfolioId)).toHaveLength(1);
  });

  it('invalid JSON files are counted but do not abort the batch', () => {
    writeBatch('ACME-EQ', 'good', {
      symbol: 'ACME-EQ',
      batch_id: 'good',
      filings: [
        {
          url: 'https://example.com/good.pdf',
          title: 'Good',
          type: 'announcement',
        },
      ],
    });
    // Garbage JSON
    const badDir = resolve(researchDir, 'BRAVO-EQ', 'filings-triage');
    mkdirSync(badDir, { recursive: true });
    writeFileSync(resolve(badDir, 'bad.json'), '{not-json');
    // Schema-invalid JSON
    writeBatch('CHARLIE-EQ', 'wrong', { foo: 'bar' });

    const r = importFilings(db, portfolioId, { researchDir });
    expect(r.filesScanned).toBe(3);
    expect(r.filesParsed).toBe(1);
    expect(r.filesInvalid).toBe(2);
    expect(r.inserted).toBe(1);
    expect(listFilings(db, portfolioId)).toHaveLength(1);
  });

  it('returns zero counts when researchDir does not exist', () => {
    const r = importFilings(db, portfolioId, {
      researchDir: resolve(tmpDir, 'nonexistent'),
    });
    expect(r.filesScanned).toBe(0);
    expect(r.inserted).toBe(0);
  });
});
