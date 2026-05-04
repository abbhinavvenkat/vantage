import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { newsItems } from '@/lib/db/schema';
import { NewsFileSchema, NewsSymbolSchema } from '@/lib/validation/news';

type Db = BetterSQLite3Database<typeof schema>;

export type NewsRow = typeof newsItems.$inferSelect;

export type ListNewsFilter = {
  symbol?: string;
  symbols?: string[];
  isRead?: boolean;
  limit?: number;
};

export function listNews(db: Db, portfolioId: string, filter: ListNewsFilter = {}): NewsRow[] {
  const conds = [eq(newsItems.portfolioId, portfolioId)];
  if (filter.isRead !== undefined) {
    conds.push(eq(newsItems.isRead, filter.isRead ? 1 : 0));
  }
  if (filter.symbol !== undefined) {
    conds.push(eq(newsItems.symbol, filter.symbol));
  }
  const baseQuery = db
    .select()
    .from(newsItems)
    .where(and(...conds))
    .orderBy(desc(newsItems.publishedAt), desc(newsItems.createdAt));
  let rows = filter.limit ? baseQuery.limit(filter.limit).all() : baseQuery.all();
  if (filter.symbols && filter.symbols.length > 0) {
    const set = new Set(filter.symbols);
    rows = rows.filter((r) => set.has(r.symbol));
  }
  return rows;
}

export function markRead(db: Db, portfolioId: string, id: string): NewsRow | null {
  const row = db
    .update(newsItems)
    .set({ isRead: 1 })
    .where(and(eq(newsItems.portfolioId, portfolioId), eq(newsItems.id, id)))
    .returning()
    .get();
  return row ?? null;
}

export function markUnread(db: Db, portfolioId: string, id: string): NewsRow | null {
  const row = db
    .update(newsItems)
    .set({ isRead: 0 })
    .where(and(eq(newsItems.portfolioId, portfolioId), eq(newsItems.id, id)))
    .returning()
    .get();
  return row ?? null;
}

export type ImportNewsInput = {
  symbol: string;
  url: string;
  title: string;
  publishedAt?: string | null;
  source?: string | null;
};

export type ImportNewsResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Idempotent upsert on (portfolioId, url). Read state is sticky.
 */
export function importBatch(
  db: Db,
  portfolioId: string,
  items: ImportNewsInput[],
): ImportNewsResult {
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    if (!item.url || !item.title || !item.symbol) {
      skipped += 1;
      continue;
    }
    const existing = db
      .select()
      .from(newsItems)
      .where(and(eq(newsItems.portfolioId, portfolioId), eq(newsItems.url, item.url)))
      .get();

    if (existing) {
      db.update(newsItems)
        .set({
          symbol: item.symbol,
          title: item.title,
          publishedAt: item.publishedAt ?? existing.publishedAt,
          source: item.source ?? existing.source,
        })
        .where(eq(newsItems.id, existing.id))
        .run();
      updated += 1;
    } else {
      db.insert(newsItems)
        .values({
          portfolioId,
          symbol: item.symbol,
          url: item.url,
          title: item.title,
          publishedAt: item.publishedAt ?? null,
          source: item.source ?? null,
          isRead: 0,
        })
        .run();
      inserted += 1;
    }
  }

  return { inserted, updated, skipped };
}

export type ImportFromFilesReport = ImportNewsResult & {
  filesScanned: number;
  filesParsed: number;
  filesInvalid: number;
  invalidPaths: string[];
};

/**
 * Scans `data/news/<SYMBOL>.json`, validates each against `NewsFileSchema`,
 * and upserts into `news_items` for the given portfolio. Idempotent on
 * (portfolioId, url). Never makes network calls.
 */
export function importNewsFromFiles(
  db: Db,
  portfolioId: string,
  baseDir: string = resolve(process.cwd(), 'data', 'news'),
): ImportFromFilesReport {
  const report: ImportFromFilesReport = {
    inserted: 0,
    updated: 0,
    skipped: 0,
    filesScanned: 0,
    filesParsed: 0,
    filesInvalid: 0,
    invalidPaths: [],
  };
  if (!existsSync(baseDir)) return report;

  const files = readdirSync(baseDir).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    report.filesScanned += 1;
    const filePath = resolve(baseDir, f);
    const symbolRaw = f.replace(/\.json$/, '');
    const symbolParsed = NewsSymbolSchema.safeParse(symbolRaw);
    if (!symbolParsed.success) {
      report.filesInvalid += 1;
      report.invalidPaths.push(filePath);
      continue;
    }
    const symbol = symbolParsed.data;

    let raw: string;
    try {
      raw = readFileSync(filePath, 'utf8');
    } catch {
      report.filesInvalid += 1;
      report.invalidPaths.push(filePath);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      report.filesInvalid += 1;
      report.invalidPaths.push(filePath);
      continue;
    }
    const valid = NewsFileSchema.safeParse(json);
    if (!valid.success) {
      report.filesInvalid += 1;
      report.invalidPaths.push(filePath);
      continue;
    }
    report.filesParsed += 1;

    const items: ImportNewsInput[] = valid.data.items.map((it) => ({
      symbol,
      url: it.url,
      title: it.title,
      publishedAt: it.publishedAt,
      source: it.source,
    }));

    const r = importBatch(db, portfolioId, items);
    report.inserted += r.inserted;
    report.updated += r.updated;
    report.skipped += r.skipped;
  }

  return report;
}
