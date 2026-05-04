import { inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { pricesEod } from '@/lib/db/schema';
import type { EodQuote } from '@/lib/pricing/yahoo';

type Db = BetterSQLite3Database<typeof schema>;

export type PriceRow = typeof pricesEod.$inferSelect;

export type LatestPrice = {
  symbol: string;
  close: number;
  date: string;
};

/** Upsert a batch of EOD quotes. Conflict on (symbol, date) → update close/adj_close. */
export function upsertPrices(db: Db, quotes: EodQuote[]): void {
  if (quotes.length === 0) return;

  db.transaction((tx) => {
    for (const q of quotes) {
      tx.insert(pricesEod)
        .values({
          symbol: q.symbol,
          date: q.date,
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
          adjClose: q.adjClose,
          volume: q.volume,
          source: q.source,
        })
        .onConflictDoUpdate({
          target: [pricesEod.symbol, pricesEod.date],
          set: {
            close: sql`excluded.close`,
            adjClose: sql`excluded.adj_close`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            volume: sql`excluded.volume`,
            source: sql`excluded.source`,
          },
        })
        .run();
    }
  });
}

/** Latest close price per symbol from the prices_eod table. */
export function getLatestPrices(db: Db, symbols: string[]): Map<string, LatestPrice> {
  if (symbols.length === 0) return new Map();

  const rows = db
    .select({
      symbol: pricesEod.symbol,
      close: pricesEod.close,
      date: pricesEod.date,
    })
    .from(pricesEod)
    .where(
      sql`(${pricesEod.symbol}, ${pricesEod.date}) in (
        select symbol, max(date) from ${pricesEod}
        where ${inArray(pricesEod.symbol, symbols)}
        group by symbol
      )`,
    )
    .all();

  const map = new Map<string, LatestPrice>();
  for (const r of rows) {
    map.set(r.symbol, { symbol: r.symbol, close: r.close!, date: r.date });
  }
  return map;
}

export type SymbolStats = {
  high52w: number | null;
  low52w: number | null;
  avgVolume30d: number | null;
};

/**
 * Returns 52w high/low (close) and 30d avg volume for each symbol, derived from
 * `prices_eod`. Symbols with no history map to all-null fields.
 */
export function getSymbolStats(
  db: Db,
  symbols: string[],
  asOfIsoDate: string,
): Map<string, SymbolStats> {
  const out = new Map<string, SymbolStats>();
  if (symbols.length === 0) return out;

  const rows = db
    .select({
      symbol: pricesEod.symbol,
      high52w: sql<
        number | null
      >`max(case when ${pricesEod.date} >= date(${asOfIsoDate}, '-365 days') then ${pricesEod.close} end)`,
      low52w: sql<
        number | null
      >`min(case when ${pricesEod.date} >= date(${asOfIsoDate}, '-365 days') then ${pricesEod.close} end)`,
      avgVolume30d: sql<
        number | null
      >`avg(case when ${pricesEod.date} >= date(${asOfIsoDate}, '-30 days') then ${pricesEod.volume} end)`,
    })
    .from(pricesEod)
    .where(sql`${inArray(pricesEod.symbol, symbols)} and ${pricesEod.date} <= ${asOfIsoDate}`)
    .groupBy(pricesEod.symbol)
    .all();

  for (const r of rows) {
    out.set(r.symbol, {
      high52w: r.high52w ?? null,
      low52w: r.low52w ?? null,
      avgVolume30d: r.avgVolume30d ?? null,
    });
  }
  return out;
}

/**
 * Returns each symbol's chronological close history within [startIso, endIso].
 * Rows whose `close` is null are dropped. Used by risk analytics to compute
 * trailing beta against a benchmark series.
 */
export function getCloseHistory(
  db: Db,
  symbols: string[],
  startIso: string,
  endIso: string,
): Map<string, { date: string; close: number }[]> {
  const out = new Map<string, { date: string; close: number }[]>();
  if (symbols.length === 0) return out;

  const rows = db
    .select({
      symbol: pricesEod.symbol,
      date: pricesEod.date,
      close: pricesEod.close,
    })
    .from(pricesEod)
    .where(
      sql`${inArray(pricesEod.symbol, symbols)} and ${pricesEod.date} between ${startIso} and ${endIso}`,
    )
    .orderBy(pricesEod.symbol, pricesEod.date)
    .all();

  for (const r of rows) {
    if (r.close == null) continue;
    const arr = out.get(r.symbol) ?? [];
    arr.push({ date: r.date, close: r.close });
    out.set(r.symbol, arr);
  }
  return out;
}
