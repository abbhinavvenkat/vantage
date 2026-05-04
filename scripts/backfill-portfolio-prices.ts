/**
 * CLI: backfill historical EOD price history for every symbol the user has
 * ever traded (per portfolio). Idempotent — symbols whose date range is
 * already covered in `prices_eod` are skipped.
 *
 * Usage:
 *   npx tsx scripts/backfill-portfolio-prices.ts [portfolio-id]
 *   (omit portfolio-id to backfill all portfolios)
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db/client';
import { portfolios } from '@/lib/db/schema';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { backfillPriceHistory } from '@/lib/pricing/backfill';
import type { NormalizedTrade } from '@/lib/parsers/types';

function tradesToNormalized(trades: Trade[]): NormalizedTrade[] {
  return trades.map((t, i) => ({
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency as 'INR' | 'USD',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
}

async function backfillForPortfolio(portfolioId: string, name: string): Promise<void> {
  const db = getDb();
  const trades = getTradesForPortfolio(db, portfolioId);
  if (trades.length === 0) {
    console.log(`[${name}] no trades — skipping`);
    return;
  }

  // Union of all symbols ever held — both currently-open and historically-sold matter
  // for a complete return-series timeline. We apply aliases so we resolve to the
  // canonical Yahoo-fetchable ticker (HDFC → HDFCBANK, LTI → LTIM, AMARAJABAT → ARE&M).
  const normalized = tradesToNormalized(trades.filter((t) => t.isIntradayPairId === null));
  const aliased = applySymbolAliases(normalized);
  const symbolSet = new Set<string>();
  for (const t of aliased) symbolSet.add(t.symbol);
  const symbols = [...symbolSet].sort();

  const startDate = trades.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    trades[0]!.tradeDate,
  );
  const endDate = new Date().toISOString().slice(0, 10);

  console.log(`[${name}] backfilling ${symbols.length} symbols from ${startDate} to ${endDate}`);

  const t0 = Date.now();
  const results = await backfillPriceHistory(db, symbols, startDate, endDate, {
    onProgress: (r) => {
      const tag =
        r.status === 'fetched'
          ? `fetched ${r.fetched} closes`
          : r.status === 'cache_hit'
            ? 'cache hit'
            : `fetch error: ${r.message ?? ''}`;
      console.log(`  ${r.symbol.padEnd(16)} ${tag}`);
    },
  });

  const fetched = results.filter((r) => r.status === 'fetched').length;
  const cached = results.filter((r) => r.status === 'cache_hit').length;
  const errored = results.filter((r) => r.status === 'fetch_error').length;
  const totalRows = results.reduce((s, r) => s + r.fetched, 0);
  console.log(
    `[${name}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
      `${fetched} fetched (${totalRows} rows), ${cached} cached, ${errored} errored`,
  );
}

async function main(): Promise<void> {
  const argId = process.argv[2];
  const db = getDb();
  let pfs;
  if (argId) {
    pfs = db
      .select()
      .from(portfolios)
      .where(sql`${portfolios.id} = ${argId}`)
      .all();
  } else {
    pfs = db
      .select()
      .from(portfolios)
      .where(sql`${portfolios.archivedAt} is null`)
      .all();
  }
  if (pfs.length === 0) {
    console.error('no portfolios found');
    process.exit(1);
  }

  for (const pf of pfs) {
    await backfillForPortfolio(pf.id, pf.name);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
