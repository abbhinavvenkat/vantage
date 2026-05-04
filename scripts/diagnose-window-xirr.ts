/**
 * Independently re-compute the Holdings page's Window XIRR table for sanity
 * checking. Prints portfolio + every benchmark XIRR for 1M, 3M, 6M, 1Y, 3Y,
 * 5Y, ALL — then cross-checks against what the page should be showing.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { listDividendsForPortfolio } from '@/lib/db/queries/dividends';
import { getCloseHistory, getLatestPrices } from '@/lib/db/queries/prices';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { runningOpenPositionsBySymbol } from '@/lib/analytics/runningPositions';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { tradesAndDividendsToCashflows } from '@/lib/analytics/portfolioCashflows';
import { portfolioMvOnDate } from '@/lib/analytics/benchmarkSeries';
import { computeBenchmarkWindowXirr } from '@/lib/analytics/benchmarkXirr';
import { windowXirr } from '@/lib/analytics/windowXirr';
import {
  BENCHMARKS,
  fetchBenchmarkClose,
  getBenchmarkSeriesCached,
} from '@/lib/pricing/benchmarks';
import { MF_BENCHMARKS, getMfNavSeriesCached } from '@/lib/pricing/mfBenchmarks';
import type { NormalizedTrade } from '@/lib/parsers/types';

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(2)}%`;
}

function isoMonthsBefore(iso: string, months: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function latestNav(series: Map<string, number>): number {
  let key = '';
  let v = 0;
  for (const [k, val] of series)
    if (k > key) {
      key = k;
      v = val;
    }
  return v;
}

async function main(): Promise<void> {
  const sqlite = new Database(resolve('./data/app.db'));
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const ps = db.select().from(portfolios).all();
  const portfolio = ps[0]!;
  console.log(`Portfolio: ${portfolio.name} (${portfolio.id})`);

  const trades = getTradesForPortfolio(db, portfolio.id);
  const dividends = listDividendsForPortfolio(db, portfolio.id);
  const cashflows = tradesAndDividendsToCashflows(trades, dividends);

  const deliveryTrades = trades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryTrades.map((t: Trade, i) => ({
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

  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const prices = getLatestPrices(
    db,
    positions.map((h) => h.symbol),
  );

  let portfolioMv = 0;
  for (const p of positions) {
    const cmp = prices.get(p.symbol)?.close;
    if (cmp == null) {
      console.log(`Missing CMP for ${p.symbol} — bailing`);
      sqlite.close();
      return;
    }
    portfolioMv += cmp * p.qty;
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = cashflows[0]!.date;

  // Build qty timelines + price histories the same way BenchmarkCard does.
  const qtyTimelines = runningOpenPositionsBySymbol(normalized, KNOWN_CORPORATE_ACTIONS);
  const allSymbols = [...qtyTimelines.keys()];
  const aliasedTrades = applySymbolAliases(normalized);
  const earliestTradeDate = aliasedTrades.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    aliasedTrades[0]?.tradeDate ?? startDate,
  );
  const closeHist = getCloseHistory(db, allSymbols, earliestTradeDate, today);
  const priceHistories = new Map<string, Map<string, number>>();
  for (const [sym, rows] of closeHist) {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.date, r.close);
    priceHistories.set(sym, m);
  }

  // Pre-fetch benchmark + MF series.
  console.log(`Fetching benchmark series...`);
  const seriesList = await Promise.all(
    BENCHMARKS.map((b) => getBenchmarkSeriesCached(b.id, startDate, today)),
  );
  const closeList = await Promise.all(BENCHMARKS.map((b) => fetchBenchmarkClose(b.id, today)));
  const mfSeriesList = await Promise.all(
    MF_BENCHMARKS.map((b) => getMfNavSeriesCached(b.id, startDate, today)),
  );

  const benchSpecs: {
    id: string;
    label: string;
    series: Map<string, number>;
    currentClose: number;
  }[] = [];
  BENCHMARKS.forEach((b, i) => {
    benchSpecs.push({
      id: b.id,
      label: b.label,
      series: seriesList[i] ?? new Map(),
      currentClose: closeList[i] ?? 0,
    });
  });
  MF_BENCHMARKS.forEach((b, i) => {
    const s = mfSeriesList[i] ?? new Map();
    benchSpecs.push({ id: b.id, label: b.label, series: s, currentClose: latestNav(s) });
  });

  const windows: { id: string; label: string; months: number | null }[] = [
    { id: '1M', label: '1M', months: 1 },
    { id: '3M', label: '3M', months: 3 },
    { id: '6M', label: '6M', months: 6 },
    { id: '1Y', label: '1Y', months: 12 },
    { id: '3Y', label: '3Y', months: 36 },
    { id: '5Y', label: '5Y', months: 60 },
    { id: 'ALL', label: 'All', months: null },
  ];

  console.log(
    `\nToday: ${today}    Portfolio MV: ₹${portfolioMv.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
  );
  console.log(`First cashflow: ${startDate}    Total cashflows: ${cashflows.length}\n`);

  // Header
  const colWidth = 12;
  const labelWidth = 26;
  const head = [
    'Series'.padEnd(labelWidth),
    ...windows.map((w) => w.label.padStart(colWidth)),
  ].join('');
  console.log(head);
  console.log('─'.repeat(head.length));

  // Portfolio row
  const portfolioRow: string[] = ['Portfolio'.padEnd(labelWidth)];
  const portfolioRates: (number | null)[] = [];
  for (const w of windows) {
    const sd = w.months == null ? startDate : isoMonthsBefore(today, w.months);
    const startMv =
      w.months == null ? 0 : (portfolioMvOnDate(sd, qtyTimelines, priceHistories) ?? 0);
    const r = windowXirr({ cashflows, startDate: sd, startMv, endDate: today, endMv: portfolioMv });
    portfolioRates.push(r);
    portfolioRow.push(pct(r).padStart(colWidth));
  }
  console.log(portfolioRow.join(''));

  // Benchmarks
  for (const spec of benchSpecs) {
    const row: string[] = [spec.label.padEnd(labelWidth)];
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]!;
      const sd = w.months == null ? startDate : isoMonthsBefore(today, w.months);
      let r: number | null = null;
      if (spec.currentClose > 0) {
        r = computeBenchmarkWindowXirr({
          cashflows,
          series: spec.series,
          startDate: sd,
          endDate: today,
          currentClose: spec.currentClose,
        });
      }
      const delta = r != null && portfolioRates[i] != null ? portfolioRates[i]! - r : null;
      const cell = `${pct(r)}${delta != null ? ' (' + (delta >= 0 ? '+' : '') + (delta * 100).toFixed(1) + ')' : ''}`;
      row.push(cell.padStart(colWidth));
    }
    console.log(row.join(''));
  }

  console.log(`\nFormat: XIRR (gap vs portfolio in pp). Positive gap = portfolio beats benchmark.`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
