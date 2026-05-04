import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { dividends } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type Dividend = typeof dividends.$inferSelect;

export type DividendInput = {
  symbol: string;
  isin?: string | null;
  exDate: string;
  qty: number;
  dividendPerShare: number;
  netAmount: number;
  currency?: string;
  sourceFileHash?: string | null;
};

export type InsertDividendsResult = { inserted: number; skipped: number };

/**
 * Idempotent batch insert. Dedupe key: (portfolioId, symbol, exDate, qty, netAmount).
 * Wrapped in a single transaction.
 */
export function insertDividends(
  db: Db,
  portfolioId: string,
  rows: DividendInput[],
): InsertDividendsResult {
  let inserted = 0;
  let skipped = 0;

  db.transaction((tx) => {
    for (const r of rows) {
      const existing = tx
        .select({ id: dividends.id })
        .from(dividends)
        .where(
          and(
            eq(dividends.portfolioId, portfolioId),
            eq(dividends.symbol, r.symbol),
            eq(dividends.exDate, r.exDate),
            eq(dividends.qty, r.qty),
            eq(dividends.netAmount, r.netAmount),
          ),
        )
        .get();
      if (existing) {
        skipped++;
        continue;
      }
      tx.insert(dividends)
        .values({
          portfolioId,
          symbol: r.symbol,
          isin: r.isin ?? null,
          exDate: r.exDate,
          qty: r.qty,
          dividendPerShare: r.dividendPerShare,
          netAmount: r.netAmount,
          currency: r.currency ?? 'INR',
          sourceFileHash: r.sourceFileHash ?? null,
        })
        .run();
      inserted++;
    }
  });

  return { inserted, skipped };
}

export function listDividendsForPortfolio(db: Db, portfolioId: string): Dividend[] {
  return db
    .select()
    .from(dividends)
    .where(eq(dividends.portfolioId, portfolioId))
    .orderBy(asc(dividends.exDate))
    .all();
}
