import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { portfolios, theses, users } from '@/lib/db/schema';
import {
  getThesis,
  listTheses,
  markReviewed,
  reviewStatus,
  upsertThesis,
} from '@/lib/db/queries/theses';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-theses-'));
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
  sqlite.exec('DELETE FROM theses;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
});

describe('theses queries (integration)', () => {
  it('starts empty', () => {
    expect(listTheses(db, portfolioId)).toEqual([]);
    expect(getThesis(db, portfolioId, 'ACME-EQ')).toBeNull();
  });

  it('upsert creates a thesis with default targetReviewDate when entryDate set', () => {
    const t = upsertThesis(db, portfolioId, 'ACME-EQ', {
      thesisMd: '## Thesis\n\nMoat.',
      checklist: [{ item: 'ROCE>15%', expected: 'pass' }],
      entryDate: '2026-01-01',
    });
    expect(t.symbol).toBe('ACME-EQ');
    expect(t.thesisMd).toContain('Thesis');
    expect(t.checklistJson).toEqual([{ item: 'ROCE>15%', expected: 'pass' }]);
    expect(t.entryDate).toBe('2026-01-01');
    expect(t.targetReviewDate).toBe('2026-04-01'); // +90 days
    expect(t.lastReviewedAt).toBeNull();
  });

  it('upsert updates existing on (portfolioId, symbol) — same row', () => {
    const a = upsertThesis(db, portfolioId, 'ACME-EQ', {
      thesisMd: 'v1',
      checklist: [],
      entryDate: '2026-01-01',
    });
    const b = upsertThesis(db, portfolioId, 'ACME-EQ', {
      thesisMd: 'v2',
      checklist: [{ item: 'x', expected: 'unknown' }],
    });
    expect(b.id).toBe(a.id);
    expect(b.thesisMd).toBe('v2');
    expect(b.entryDate).toBe('2026-01-01');
    expect(b.checklistJson).toHaveLength(1);

    expect(listTheses(db, portfolioId)).toHaveLength(1);
  });

  it('scope isolation: same symbol in two portfolios are separate rows', () => {
    upsertThesis(db, portfolioId, 'ACME-EQ', {
      thesisMd: 'pf1',
      checklist: [],
    });
    upsertThesis(db, otherPortfolioId, 'ACME-EQ', {
      thesisMd: 'pf2',
      checklist: [],
    });

    expect(getThesis(db, portfolioId, 'ACME-EQ')?.thesisMd).toBe('pf1');
    expect(getThesis(db, otherPortfolioId, 'ACME-EQ')?.thesisMd).toBe('pf2');
    expect(listTheses(db, portfolioId)).toHaveLength(1);
    expect(listTheses(db, otherPortfolioId)).toHaveLength(1);
  });

  it('markReviewed bumps lastReviewedAt and pushes targetReviewDate +90', () => {
    upsertThesis(db, portfolioId, 'ACME-EQ', {
      thesisMd: 'x',
      checklist: [],
      entryDate: '2026-01-01',
    });
    const reviewed = markReviewed(db, portfolioId, 'ACME-EQ', '2026-05-01');
    expect(reviewed).not.toBeNull();
    expect(reviewed!.lastReviewedAt).toBe('2026-05-01');
    expect(reviewed!.targetReviewDate).toBe('2026-07-30');
  });

  it("markReviewed returns null when thesis doesn't exist", () => {
    expect(markReviewed(db, portfolioId, 'NOPE-EQ', '2026-05-01')).toBeNull();
  });

  it("markReviewed is portfolio-scoped — won't touch other portfolio", () => {
    upsertThesis(db, otherPortfolioId, 'ACME-EQ', {
      thesisMd: 'x',
      checklist: [],
      entryDate: '2026-01-01',
    });
    const result = markReviewed(db, portfolioId, 'ACME-EQ', '2026-05-01');
    expect(result).toBeNull();

    const stillThere = getThesis(db, otherPortfolioId, 'ACME-EQ');
    expect(stillThere?.lastReviewedAt).toBeNull();
  });

  it('uniqueness on (portfolioId, symbol) is enforced at the DB level', () => {
    db.insert(theses)
      .values({
        portfolioId,
        symbol: 'ACME-EQ',
        thesisMd: 'x',
        checklistJson: [],
        createdAt: 1,
        updatedAt: 1,
      })
      .run();
    expect(() =>
      db
        .insert(theses)
        .values({
          portfolioId,
          symbol: 'ACME-EQ',
          thesisMd: 'y',
          checklistJson: [],
          createdAt: 2,
          updatedAt: 2,
        })
        .run(),
    ).toThrow();
  });
});

describe('reviewStatus()', () => {
  it('overdue when target < today', () => {
    expect(
      reviewStatus({ targetReviewDate: '2026-01-01', lastReviewedAt: null }, '2026-05-03'),
    ).toMatchObject({ status: 'overdue' });
  });
  it('due_soon when target within 14d', () => {
    expect(
      reviewStatus({ targetReviewDate: '2026-05-10', lastReviewedAt: null }, '2026-05-03'),
    ).toMatchObject({ status: 'due_soon' });
  });
  it('up_to_date when target far in future', () => {
    expect(
      reviewStatus({ targetReviewDate: '2026-08-01', lastReviewedAt: null }, '2026-05-03'),
    ).toMatchObject({ status: 'up_to_date' });
  });
  it('unscheduled when no targetReviewDate', () => {
    expect(
      reviewStatus({ targetReviewDate: null, lastReviewedAt: null }, '2026-05-03'),
    ).toMatchObject({ status: 'unscheduled' });
  });
});
