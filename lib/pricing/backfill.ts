/**
 * Bulk historical-price backfill.
 *
 * For each symbol, ensures `prices_eod` has daily closes covering [startDate, endDate].
 * Skips symbols where coverage is already wide enough. Otherwise hits Yahoo (one bulk
 * request per symbol, rate-limited to 1 req/s shared with the rest of the Yahoo
 * adapters) and upserts via `upsertPrices`.
 */

import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { pricesEod } from '@/lib/db/schema';
import { upsertPrices } from '@/lib/db/queries/prices';
import { fetchPriceHistory } from '@/lib/pricing/yahooHistory';

type Db = BetterSQLite3Database<typeof schema>;

export type BackfillStatus = 'fetched' | 'cache_hit' | 'fetch_error';

export type BackfillResult = {
  symbol: string;
  status: BackfillStatus;
  fetched: number;
  message?: string;
};

export type BackfillOptions = {
  /** Skip the network call if existing rows already cover the requested range. */
  forceRefetch?: boolean;
  /** Per-symbol progress callback. */
  onProgress?: (r: BackfillResult) => void;
};

/**
 * Returns the existing (min, max) date covered for `symbol` in `prices_eod`.
 * Null when the symbol has no rows yet.
 */
function getCoverage(db: Db, symbol: string): { min: string; max: string; count: number } | null {
  const row = db
    .select({
      min: sql<string | null>`min(${pricesEod.date})`,
      max: sql<string | null>`max(${pricesEod.date})`,
      cnt: sql<number>`count(*)`,
    })
    .from(pricesEod)
    .where(sql`${pricesEod.symbol} = ${symbol}`)
    .get();
  if (!row || !row.min || !row.max) return null;
  return { min: row.min, max: row.max, count: Number(row.cnt ?? 0) };
}

/**
 * Backfill price history for `symbols` between `startDate` and `endDate` (inclusive).
 * One bulk request per symbol, sequenced via the shared Yahoo rate limiter.
 */
export async function backfillPriceHistory(
  db: Db,
  symbols: string[],
  startDate: string,
  endDate: string,
  opts: BackfillOptions = {},
): Promise<BackfillResult[]> {
  const out: BackfillResult[] = [];
  for (const symbol of symbols) {
    if (!opts.forceRefetch) {
      const cov = getCoverage(db, symbol);
      // Treat as cached if the existing window covers the requested span and has
      // at least ~150 rows (a year of trading days). Pure sentinel rows from
      // the latest-only fetcher would have count 1.
      if (cov && cov.min <= startDate && cov.max >= endDate && cov.count > 150) {
        const r: BackfillResult = { symbol, status: 'cache_hit', fetched: 0 };
        out.push(r);
        opts.onProgress?.(r);
        continue;
      }
    }

    try {
      const quotes = await fetchPriceHistory(symbol, startDate, endDate);
      if (quotes.length === 0) {
        const r: BackfillResult = {
          symbol,
          status: 'fetch_error',
          fetched: 0,
          message: 'no rows returned',
        };
        out.push(r);
        opts.onProgress?.(r);
        continue;
      }
      upsertPrices(db, quotes);
      const r: BackfillResult = { symbol, status: 'fetched', fetched: quotes.length };
      out.push(r);
      opts.onProgress?.(r);
    } catch (e) {
      const r: BackfillResult = {
        symbol,
        status: 'fetch_error',
        fetched: 0,
        message: e instanceof Error ? e.message : String(e),
      };
      out.push(r);
      opts.onProgress?.(r);
    }
  }
  return out;
}
