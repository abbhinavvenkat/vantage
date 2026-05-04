import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { accounts, trades } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type RawHoldingRow = {
  symbol: string;
  currency: string;
  buyQty: number;
  sellQty: number;
  netQty: number;
  buyValue: number;
  sellValue: number;
  tradeCount: number;
  firstTradeDate: string;
  lastTradeDate: string;
};

/**
 * View-style aggregation of trades grouped by (symbol, currency).
 * No FIFO — `lib/analytics/fifo.ts` (other agent) layers on top.
 * Intraday-paired rows are excluded so this matches a delivery-only view.
 */
export function computeHoldings(db: Db, portfolioId: string): RawHoldingRow[] {
  const rows = db
    .select({
      symbol: trades.symbol,
      currency: trades.currency,
      buyQty: sql<number>`coalesce(sum(case when ${trades.side} = 'buy' then ${trades.qty} else 0 end), 0)`,
      sellQty: sql<number>`coalesce(sum(case when ${trades.side} = 'sell' then ${trades.qty} else 0 end), 0)`,
      buyValue: sql<number>`coalesce(sum(case when ${trades.side} = 'buy' then ${trades.qty} * ${trades.price} else 0 end), 0)`,
      sellValue: sql<number>`coalesce(sum(case when ${trades.side} = 'sell' then ${trades.qty} * ${trades.price} else 0 end), 0)`,
      tradeCount: sql<number>`count(*)`,
      firstTradeDate: sql<string>`min(${trades.tradeDate})`,
      lastTradeDate: sql<string>`max(${trades.tradeDate})`,
    })
    .from(trades)
    .innerJoin(accounts, eq(accounts.id, trades.accountId))
    .where(sql`${accounts.portfolioId} = ${portfolioId} and ${trades.isIntradayPairId} is null`)
    .groupBy(trades.symbol, trades.currency)
    .orderBy(trades.symbol)
    .all();

  return rows.map((r) => ({
    symbol: r.symbol,
    currency: r.currency,
    buyQty: r.buyQty,
    sellQty: r.sellQty,
    netQty: r.buyQty - r.sellQty,
    buyValue: r.buyValue,
    sellValue: r.sellValue,
    tradeCount: r.tradeCount,
    firstTradeDate: r.firstTradeDate,
    lastTradeDate: r.lastTradeDate,
  }));
}
