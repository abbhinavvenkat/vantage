import { and, asc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { accounts, brokers, trades } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type Trade = typeof trades.$inferSelect;

/**
 * Caller passes already-normalized rows (NormalizedTrade-shaped, but DB-keyed).
 * Currency required (matches the multi-broker future contract).
 */
export type NormalizedTradeInput = {
  symbol: string;
  isin?: string | null;
  tradeDate: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  currency: string;
  exchange?: string | null;
  segment?: string | null;
  series?: string | null;
  tradeId?: string | null;
  orderId?: string | null;
  execTime?: string | null;
  sourceFileHash?: string | null;
  sourceRowIdx?: number | null;
};

export type InsertTradesResult = {
  inserted: number;
  skipped: number;
};

/**
 * Idempotent upsert.
 * Primary dedupe: (account_id, trade_id) when trade_id is present.
 * Fallback dedupe: (account_id, symbol, exec_time, qty, price, side) when trade_id is null.
 *
 * Wrapped in a single transaction so a failed batch leaves no partial rows.
 */
export function insertTrades(
  db: Db,
  accountId: string,
  rows: NormalizedTradeInput[],
): InsertTradesResult {
  let inserted = 0;
  let skipped = 0;

  db.transaction((tx) => {
    for (const r of rows) {
      if (r.tradeId != null && r.tradeId !== '') {
        const existing = tx
          .select({ id: trades.id })
          .from(trades)
          .where(and(eq(trades.accountId, accountId), eq(trades.tradeId, r.tradeId)))
          .get();
        if (existing) {
          skipped++;
          continue;
        }
      } else {
        // Fallback dedupe on natural key
        const existing = tx
          .select({ id: trades.id })
          .from(trades)
          .where(
            and(
              eq(trades.accountId, accountId),
              eq(trades.symbol, r.symbol),
              eq(trades.side, r.side),
              eq(trades.qty, r.qty),
              eq(trades.price, r.price),
              r.execTime != null
                ? eq(trades.execTime, r.execTime)
                : eq(trades.tradeDate, r.tradeDate),
            ),
          )
          .get();
        if (existing) {
          skipped++;
          continue;
        }
      }

      tx.insert(trades)
        .values({
          accountId,
          symbol: r.symbol,
          isin: r.isin ?? null,
          tradeDate: r.tradeDate,
          side: r.side,
          qty: r.qty,
          price: r.price,
          currency: r.currency,
          exchange: r.exchange ?? null,
          segment: r.segment ?? null,
          series: r.series ?? null,
          tradeId: r.tradeId ?? null,
          orderId: r.orderId ?? null,
          execTime: r.execTime ?? null,
          sourceFileHash: r.sourceFileHash ?? null,
          sourceRowIdx: r.sourceRowIdx ?? null,
        })
        .run();
      inserted++;
    }
  });

  return { inserted, skipped };
}

export type TradeWithBroker = Trade & { brokerCode: string; accountAlias: string };

/**
 * Same selection as `getTradesForPortfolio` plus the broker code and account alias
 * for export rendering. Kept as a separate function so the existing call sites are
 * untouched.
 */
export function getTradesWithBrokerForPortfolio(db: Db, portfolioId: string): TradeWithBroker[] {
  return db
    .select({
      id: trades.id,
      accountId: trades.accountId,
      symbol: trades.symbol,
      isin: trades.isin,
      tradeDate: trades.tradeDate,
      side: trades.side,
      qty: trades.qty,
      price: trades.price,
      currency: trades.currency,
      exchange: trades.exchange,
      segment: trades.segment,
      series: trades.series,
      tradeId: trades.tradeId,
      orderId: trades.orderId,
      execTime: trades.execTime,
      sourceFileHash: trades.sourceFileHash,
      sourceRowIdx: trades.sourceRowIdx,
      isIntradayPairId: trades.isIntradayPairId,
      createdAt: trades.createdAt,
      brokerCode: brokers.code,
      accountAlias: accounts.alias,
    })
    .from(trades)
    .innerJoin(accounts, eq(accounts.id, trades.accountId))
    .innerJoin(brokers, eq(brokers.id, accounts.brokerId))
    .where(eq(accounts.portfolioId, portfolioId))
    .orderBy(asc(trades.tradeDate), asc(trades.execTime))
    .all();
}

export function getTradesForPortfolio(db: Db, portfolioId: string): Trade[] {
  return db
    .select({
      id: trades.id,
      accountId: trades.accountId,
      symbol: trades.symbol,
      isin: trades.isin,
      tradeDate: trades.tradeDate,
      side: trades.side,
      qty: trades.qty,
      price: trades.price,
      currency: trades.currency,
      exchange: trades.exchange,
      segment: trades.segment,
      series: trades.series,
      tradeId: trades.tradeId,
      orderId: trades.orderId,
      execTime: trades.execTime,
      sourceFileHash: trades.sourceFileHash,
      sourceRowIdx: trades.sourceRowIdx,
      isIntradayPairId: trades.isIntradayPairId,
      createdAt: trades.createdAt,
    })
    .from(trades)
    .innerJoin(accounts, eq(accounts.id, trades.accountId))
    .where(eq(accounts.portfolioId, portfolioId))
    .orderBy(asc(trades.tradeDate), asc(trades.execTime))
    .all();
}
