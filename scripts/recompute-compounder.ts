/**
 * Re-compute the Compounder Thesis profile for every symbol in the user's
 * portfolio + watchlist. Prints a per-symbol summary of pass/partial/fail/
 * unknown counts so we can verify the resolver chain actually closes the
 * "?" gaps the user complained about.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import type { NormalizedTrade } from '@/lib/parsers/types';

async function main(): Promise<void> {
  const portfolioName = process.argv[2] ?? process.env.PORTFOLIO_NAME ?? '';
  const dbPath = resolve('./data/app.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const ps = db.select().from(portfolios).all();
  const target = ps.find((p) => p.name.toLowerCase() === portfolioName.toLowerCase()) ?? ps[0];
  if (!target) {
    console.error('No portfolio found.');
    process.exit(1);
  }

  // Holdings (FIFO, alias-aware).
  const trades = getTradesForPortfolio(db, target.id);
  const delivery = trades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = delivery.map((t, i) => ({
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency === 'USD' ? 'USD' : 'INR',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
  const holdings = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS).map((p) => p.symbol);
  const watchlist = listWatchlist(db, target.id).map((w) => w.symbol);
  const symbols = [...new Set([...holdings, ...watchlist])].sort();

  console.log(`Compounder re-evaluation for ${target.name} (${symbols.length} symbols)\n`);
  console.log(
    `${'Symbol'.padEnd(14)} ${'Class'.padEnd(20)} ${'Score'.padEnd(7)} ${'10y'.padEnd(6)} ${'P/Pa/F/U'.padEnd(12)} top failing`,
  );
  console.log('─'.repeat(96));

  let totalUnknown = 0;
  let symbolsWithUnknowns = 0;
  const classCounts: Record<string, number> = {};

  const today = new Date().toISOString().slice(0, 10);
  for (const sym of symbols) {
    const fund = loadFundamentals(sym);
    const sector = getSector(sym) ?? 'Unknown';
    const valctx = buildValuationContext({
      db,
      symbol: sym,
      fund,
      sectorMedian: getSectorMedian(sector),
      endDate: today,
    });
    const profile = computeCompounderProfile({
      symbol: sym,
      sector,
      fundamentals: fund,
      firedRules: [],
      valuation: {
        pe: valctx.pe,
        peg: valctx.peg,
        peVsSectorMedian: valctx.peVsSectorMedian,
        peSectorMedian: valctx.peSectorMedian,
        pe5yMedian: valctx.pe5yMedian,
        pe10yPercentile: valctx.pe10yPercentile,
        earningsYieldMinusGsec: valctx.earningsYieldMinusGsec,
      },
    });
    const failing = profile.factors
      .filter((f) => f.verdict.status === 'fail' || f.verdict.status === 'unknown')
      .map((f) => f.factor.label)
      .slice(0, 3)
      .join(', ');
    classCounts[profile.classification] = (classCounts[profile.classification] ?? 0) + 1;
    totalUnknown += profile.unknownCount;
    if (profile.unknownCount > 0) symbolsWithUnknowns++;
    const pPaFU = `${profile.passCount}/${profile.partialCount}/${profile.failCount}/${profile.unknownCount}`;
    console.log(
      `${sym.padEnd(14)} ${profile.classification.padEnd(20)} ${profile.weightedScore.toFixed(2).padEnd(7)} ${profile.estimatedTenYearReturn.toFixed(1).padEnd(6)}× ${pPaFU.padEnd(11)} ${failing}`,
    );
  }

  console.log('\nClass distribution:');
  for (const [c, n] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${c.padEnd(20)} ${n}`);
  }
  console.log(
    `\nTotal unknown verdicts across all symbols: ${totalUnknown} (${symbolsWithUnknowns} symbols affected)`,
  );

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
