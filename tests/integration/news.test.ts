import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { portfolios, users } from '@/lib/db/schema';
import {
  importBatch,
  importNewsFromFiles,
  listNews,
  markRead,
  markUnread,
} from '@/lib/db/queries/news';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let newsDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-news-'));
  const dbPath = resolve(tmpDir, 'test.db');
  newsDir = resolve(tmpDir, 'news');
  mkdirSync(newsDir, { recursive: true });
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
  sqlite.exec('DELETE FROM news_items;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
  rmSync(newsDir, { recursive: true, force: true });
  mkdirSync(newsDir, { recursive: true });
});

function writeFile(symbol: string, body: unknown): string {
  const filePath = resolve(newsDir, `${symbol}.json`);
  writeFileSync(filePath, JSON.stringify(body));
  return filePath;
}

describe('news queries (integration)', () => {
  it('starts empty', () => {
    expect(listNews(db, portfolioId)).toEqual([]);
  });

  it('importBatch inserts rows and is idempotent on (portfolioId, url)', () => {
    const items = [
      {
        symbol: 'ACME-EQ',
        url: 'https://news.example/a',
        title: 'ACME up 10%',
        publishedAt: '2026-04-30T10:00:00Z',
        source: 'ET',
      },
      {
        symbol: 'ACME-EQ',
        url: 'https://news.example/b',
        title: 'ACME wins order',
        publishedAt: '2026-04-29T10:00:00Z',
        source: 'BS',
      },
    ];
    const r1 = importBatch(db, portfolioId, items);
    expect(r1).toEqual({ inserted: 2, updated: 0, skipped: 0 });

    // Re-import → updated, no duplicates.
    const r2 = importBatch(db, portfolioId, items);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(2);
    expect(listNews(db, portfolioId)).toHaveLength(2);
  });

  it('importBatch updates title/source/publishedAt but preserves isRead', () => {
    importBatch(db, portfolioId, [
      {
        symbol: 'BEL',
        url: 'https://x.com/1',
        title: 'old',
        publishedAt: '2026-04-30',
        source: 'old',
      },
    ]);
    const before = listNews(db, portfolioId)[0]!;
    markRead(db, portfolioId, before.id);

    importBatch(db, portfolioId, [
      {
        symbol: 'BEL',
        url: 'https://x.com/1',
        title: 'new title',
        publishedAt: '2026-05-01',
        source: 'new',
      },
    ]);
    const after = listNews(db, portfolioId)[0]!;
    expect(after.title).toBe('new title');
    expect(after.publishedAt).toBe('2026-05-01');
    expect(after.source).toBe('new');
    expect(after.isRead).toBe(1); // sticky
  });

  it('listNews filters by symbol, isRead, and is portfolio-scoped', () => {
    importBatch(db, portfolioId, [
      {
        symbol: 'BEL',
        url: 'https://x.com/1',
        title: 'BEL 1',
        publishedAt: '2026-04-30',
        source: 's',
      },
      {
        symbol: 'HDFCBANK',
        url: 'https://x.com/2',
        title: 'HDFC 1',
        publishedAt: '2026-04-29',
        source: 's',
      },
    ]);
    importBatch(db, otherPortfolioId, [
      {
        symbol: 'BEL',
        url: 'https://x.com/3',
        title: 'leak',
        publishedAt: '2026-04-30',
        source: 's',
      },
    ]);

    expect(listNews(db, portfolioId)).toHaveLength(2);
    expect(listNews(db, portfolioId, { symbol: 'BEL' })).toHaveLength(1);
    expect(listNews(db, otherPortfolioId)).toHaveLength(1);

    const bel = listNews(db, portfolioId, { symbol: 'BEL' })[0]!;
    markRead(db, portfolioId, bel.id);
    expect(listNews(db, portfolioId, { isRead: false })).toHaveLength(1);
    expect(listNews(db, portfolioId, { isRead: true })).toHaveLength(1);
  });

  it('markRead / markUnread are portfolio-scoped', () => {
    importBatch(db, otherPortfolioId, [
      {
        symbol: 'BEL',
        url: 'https://x.com/1',
        title: 'leak',
        publishedAt: '2026-04-30',
        source: 's',
      },
    ]);
    const leak = listNews(db, otherPortfolioId)[0]!;
    expect(markRead(db, portfolioId, leak.id)).toBeNull();
    expect(markUnread(db, portfolioId, leak.id)).toBeNull();
    // Owner can.
    expect(markRead(db, otherPortfolioId, leak.id)).not.toBeNull();
  });
});

describe('importNewsFromFiles', () => {
  it('returns empty report when dir missing', () => {
    const missing = resolve(tmpDir, 'does-not-exist');
    const r = importNewsFromFiles(db, portfolioId, missing);
    expect(r.filesScanned).toBe(0);
    expect(r.inserted).toBe(0);
  });

  it('imports a single symbol file, then is idempotent on re-run', () => {
    writeFile('BEL', {
      items: [
        {
          title: 'BEL wins ₹2k cr order',
          url: 'https://news.example/bel/1',
          publishedAt: '2026-04-30T10:00:00Z',
          source: 'Economic Times',
        },
        {
          title: 'BEL Q4 results',
          url: 'https://news.example/bel/2',
          publishedAt: '2026-04-29T10:00:00Z',
          source: 'Mint',
        },
      ],
    });

    const r1 = importNewsFromFiles(db, portfolioId, newsDir);
    expect(r1.filesScanned).toBe(1);
    expect(r1.filesParsed).toBe(1);
    expect(r1.inserted).toBe(2);
    expect(r1.updated).toBe(0);
    expect(listNews(db, portfolioId)).toHaveLength(2);

    const r2 = importNewsFromFiles(db, portfolioId, newsDir);
    expect(r2.inserted).toBe(0);
    expect(r2.updated).toBe(2);
    expect(listNews(db, portfolioId)).toHaveLength(2);
  });

  it('imports multiple symbol files', () => {
    writeFile('BEL', {
      items: [
        {
          title: 'BEL news',
          url: 'https://x.com/bel',
          publishedAt: '2026-04-30',
          source: 's',
        },
      ],
    });
    writeFile('HDFCBANK', {
      items: [
        {
          title: 'HDFC news',
          url: 'https://x.com/hdfc',
          publishedAt: '2026-04-29',
          source: 's',
        },
      ],
    });

    const r = importNewsFromFiles(db, portfolioId, newsDir);
    expect(r.filesScanned).toBe(2);
    expect(r.inserted).toBe(2);
    const symbols = listNews(db, portfolioId)
      .map((n) => n.symbol)
      .sort();
    expect(symbols).toEqual(['BEL', 'HDFCBANK']);
  });

  it('skips invalid JSON / schema-failing files but continues', () => {
    writeFile('BEL', {
      items: [
        {
          title: 'BEL news',
          url: 'https://x.com/bel',
          publishedAt: '2026-04-30',
          source: 's',
        },
      ],
    });
    // bad: no items array
    writeFileSync(resolve(newsDir, 'BAD.json'), '{ "garbage": true }');
    // bad: not JSON
    writeFileSync(resolve(newsDir, 'WORSE.json'), '{ not json');

    const r = importNewsFromFiles(db, portfolioId, newsDir);
    expect(r.filesScanned).toBe(3);
    expect(r.filesParsed).toBe(1);
    expect(r.filesInvalid).toBe(2);
    expect(r.inserted).toBe(1);
  });

  it('imports are scoped to portfolioId — other portfolio sees nothing', () => {
    writeFile('BEL', {
      items: [
        {
          title: 'BEL news',
          url: 'https://x.com/bel',
          publishedAt: '2026-04-30',
          source: 's',
        },
      ],
    });
    importNewsFromFiles(db, portfolioId, newsDir);
    expect(listNews(db, portfolioId)).toHaveLength(1);
    expect(listNews(db, otherPortfolioId)).toHaveLength(0);
  });

  it('ignores files with malformed symbol filename', () => {
    writeFileSync(
      resolve(newsDir, 'has spaces.json'),
      JSON.stringify({
        items: [
          {
            title: 't',
            url: 'https://x.com/1',
            publishedAt: '2026-04-30',
            source: 's',
          },
        ],
      }),
    );
    const r = importNewsFromFiles(db, portfolioId, newsDir);
    expect(r.filesInvalid).toBe(1);
    expect(r.inserted).toBe(0);
  });
});
