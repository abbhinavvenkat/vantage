import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { watchlist } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type Conviction = 'high' | 'medium' | 'low';

export type WatchlistEntry = typeof watchlist.$inferSelect;

export type NewWatchlistInput = {
  symbol: string;
  thesis?: string | null;
  targetBuyPrice?: number | null;
  targetSellPrice?: number | null;
  conviction?: Conviction;
};

export type UpdateWatchlistInput = {
  thesis?: string | null;
  targetBuyPrice?: number | null;
  targetSellPrice?: number | null;
  conviction?: Conviction;
};

export function listWatchlist(db: Db, portfolioId: string): WatchlistEntry[] {
  return db
    .select()
    .from(watchlist)
    .where(eq(watchlist.portfolioId, portfolioId))
    .orderBy(desc(watchlist.createdAt))
    .all();
}

export function getWatchlistEntry(db: Db, portfolioId: string, id: string): WatchlistEntry | null {
  const row = db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.portfolioId, portfolioId), eq(watchlist.id, id)))
    .get();
  return row ?? null;
}

export function addWatchlistEntry(
  db: Db,
  portfolioId: string,
  input: NewWatchlistInput,
): WatchlistEntry {
  const now = Date.now();
  const inserted = db
    .insert(watchlist)
    .values({
      portfolioId,
      symbol: input.symbol,
      thesis: input.thesis ?? null,
      targetBuyPrice: input.targetBuyPrice ?? null,
      targetSellPrice: input.targetSellPrice ?? null,
      conviction: input.conviction ?? 'medium',
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return inserted;
}

export function updateWatchlistEntry(
  db: Db,
  portfolioId: string,
  id: string,
  input: UpdateWatchlistInput,
): WatchlistEntry | null {
  const patch: Partial<WatchlistEntry> = { updatedAt: Date.now() };
  if (input.thesis !== undefined) patch.thesis = input.thesis;
  if (input.targetBuyPrice !== undefined) patch.targetBuyPrice = input.targetBuyPrice;
  if (input.targetSellPrice !== undefined) patch.targetSellPrice = input.targetSellPrice;
  if (input.conviction !== undefined) patch.conviction = input.conviction;

  const updated = db
    .update(watchlist)
    .set(patch)
    .where(and(eq(watchlist.portfolioId, portfolioId), eq(watchlist.id, id)))
    .returning()
    .get();
  return updated ?? null;
}

export function removeWatchlistEntry(
  db: Db,
  portfolioId: string,
  id: string,
): WatchlistEntry | null {
  const removed = db
    .delete(watchlist)
    .where(and(eq(watchlist.portfolioId, portfolioId), eq(watchlist.id, id)))
    .returning()
    .get();
  return removed ?? null;
}
