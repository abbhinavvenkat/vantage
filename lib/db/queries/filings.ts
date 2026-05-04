import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { filings, type FilingTriage, type FilingType } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type FilingRow = typeof filings.$inferSelect;

export type ListFilingsFilter = {
  isRead?: boolean;
  triage?: FilingTriage;
  symbol?: string;
};

export function listFilings(
  db: Db,
  portfolioId: string,
  filter: ListFilingsFilter = {},
): FilingRow[] {
  const conds = [eq(filings.portfolioId, portfolioId)];
  if (filter.isRead !== undefined) {
    conds.push(eq(filings.isRead, filter.isRead ? 1 : 0));
  }
  if (filter.triage !== undefined) {
    conds.push(eq(filings.triage, filter.triage));
  }
  if (filter.symbol !== undefined) {
    conds.push(eq(filings.symbol, filter.symbol));
  }
  return db
    .select()
    .from(filings)
    .where(and(...conds))
    .orderBy(desc(filings.createdAt))
    .all();
}

export function getFiling(db: Db, portfolioId: string, id: string): FilingRow | null {
  const row = db
    .select()
    .from(filings)
    .where(and(eq(filings.portfolioId, portfolioId), eq(filings.id, id)))
    .get();
  return row ?? null;
}

export function markRead(db: Db, portfolioId: string, id: string): FilingRow | null {
  const row = db
    .update(filings)
    .set({ isRead: 1 })
    .where(and(eq(filings.portfolioId, portfolioId), eq(filings.id, id)))
    .returning()
    .get();
  return row ?? null;
}

export function markUnread(db: Db, portfolioId: string, id: string): FilingRow | null {
  const row = db
    .update(filings)
    .set({ isRead: 0 })
    .where(and(eq(filings.portfolioId, portfolioId), eq(filings.id, id)))
    .returning()
    .get();
  return row ?? null;
}

export type ImportFilingInput = {
  symbol: string;
  url: string;
  title: string;
  filingType: FilingType;
  triage?: FilingTriage | null;
  summaryOneLine?: string | null;
  publishedAt?: string | null;
};

export type ImportBatchResult = {
  inserted: number;
  updated: number;
  skipped: number;
};

/**
 * Idempotent upsert on (portfolioId, url).
 *
 * - Inserts new rows preserving `isRead = 0` and `createdAt = now`.
 * - Updates triage/summary/title/publishedAt/filingType for existing rows
 *   without flipping `isRead` (the user's read state is sticky).
 */
export function importBatch(
  db: Db,
  portfolioId: string,
  items: ImportFilingInput[],
): ImportBatchResult {
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
      .from(filings)
      .where(and(eq(filings.portfolioId, portfolioId), eq(filings.url, item.url)))
      .get();

    if (existing) {
      db.update(filings)
        .set({
          symbol: item.symbol,
          title: item.title,
          filingType: item.filingType,
          triage: item.triage ?? existing.triage,
          summaryOneLine: item.summaryOneLine ?? existing.summaryOneLine,
          publishedAt: item.publishedAt ?? existing.publishedAt,
        })
        .where(eq(filings.id, existing.id))
        .run();
      updated += 1;
    } else {
      db.insert(filings)
        .values({
          portfolioId,
          symbol: item.symbol,
          url: item.url,
          title: item.title,
          filingType: item.filingType,
          triage: item.triage ?? null,
          summaryOneLine: item.summaryOneLine ?? null,
          publishedAt: item.publishedAt ?? null,
          isRead: 0,
        })
        .run();
      inserted += 1;
    }
  }

  return { inserted, updated, skipped };
}
