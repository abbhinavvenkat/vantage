/**
 * Per-symbol money-weighted XIRR over 1Y / 3Y / 5Y windows, weighted by
 * current MV to surface drivers and drags of portfolio outperformance.
 *
 * Inputs that the (naive) per-stock CAGR misses are all handled here:
 *   - splits / bonuses → qty timelines + back-adjusted close history
 *   - HDFC → HDFCBANK merger → applySymbolAliases
 *   - dividends → folded into the per-symbol cashflow stream
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
import { runningOpenPositionsBySymbol, qtyOnDate } from '@/lib/analytics/runningPositions';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { tradesToCashflowsForSymbol } from '@/lib/analytics/symbolCashflows';
import { windowXirr } from '@/lib/analytics/windowXirr';
import { type Cashflow } from '@/lib/analytics/xirr';
import type { NormalizedTrade } from '@/lib/parsers/types';

function isoMonthsBefore(iso: string, months: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

function priceOnOrBefore(hist: { date: string; close: number }[], date: string): number | null {
  let best: number | null = null;
  for (const r of hist) {
    if (r.date <= date) best = r.close;
    else break;
  }
  return best;
}

function fmtPp(n: number | null): string {
  if (n == null) return '   —  ';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2).padStart(5)}pp`;
}

async function main(): Promise<void> {
  const sqlite = new Database(resolve('./data/app.db'));
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const portfolio = db.select().from(portfolios).all()[0]!;
  console.log(`Portfolio: ${portfolio.name}\n`);

  const trades = getTradesForPortfolio(db, portfolio.id);
  const dividends = listDividendsForPortfolio(db, portfolio.id);
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
  const symbols = positions.map((p) => p.symbol);
  const prices = getLatestPrices(db, symbols);
  const today = new Date().toISOString().slice(0, 10);

  let totalMv = 0;
  for (const p of positions) {
    const cmp = prices.get(p.symbol)?.close ?? 0;
    totalMv += cmp * p.qty;
  }

  // Qty timelines (corp-action-aware) + close history (Yahoo close is already
  // back-adjusted for splits/bonuses in this DB — verified empirically).
  const qtyTimelines = runningOpenPositionsBySymbol(normalized, KNOWN_CORPORATE_ACTIONS);
  const earliestTrade = normalized.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    normalized[0]!.tradeDate,
  );
  const closeHist = getCloseHistory(db, symbols, earliestTrade, today);
  const histBySym = new Map<string, { date: string; close: number }[]>();
  for (const [sym, rows] of closeHist) {
    histBySym.set(
      sym,
      [...rows].sort((a, b) => a.date.localeCompare(b.date)),
    );
  }

  // Index dividends by post-alias symbol (dividends table uses original
  // ticker; user-symbol HDFC dividends should be attributed to HDFCBANK after
  // the merger).
  const aliasMap = new Map<string, string>();
  for (const t of normalized) {
    const aliased = applySymbolAliases([t])[0]!;
    aliasMap.set(t.symbol, aliased.symbol);
  }
  const divsBySymbol = new Map<string, { date: string; amount: number }[]>();
  for (const d of dividends) {
    const target = aliasMap.get(d.symbol) ?? d.symbol;
    const arr = divsBySymbol.get(target) ?? [];
    arr.push({ date: d.exDate, amount: d.netAmount });
    divsBySymbol.set(target, arr);
  }

  const windows: { id: string; months: number }[] = [
    { id: '1Y', months: 12 },
    { id: '3Y', months: 36 },
    { id: '5Y', months: 60 },
  ];
  // Reference: portfolio XIRR for each window (from the prior diag).
  const portfolioXirrRef: Record<string, number> = { '1Y': 0.2335, '3Y': 0.2117, '5Y': 0.1142 };
  const benchRef: Record<string, number> = { '1Y': 0.0363, '3Y': 0.1198, '5Y': 0.1104 };

  for (const w of windows) {
    const startDate = isoMonthsBefore(today, w.months);
    console.log(
      `\n══ ${w.id} window (start ${startDate}) — Portfolio ${(portfolioXirrRef[w.id]! * 100).toFixed(2)}% / Nifty 500 ${(benchRef[w.id]! * 100).toFixed(2)}% ══`,
    );
    console.log(
      `${'Symbol'.padEnd(14)}${'Held since'.padEnd(13)}${'StartMV'.padStart(11)}${'EndMV'.padStart(11)}${'Divs in win'.padStart(13)}${'Sym XIRR'.padStart(11)}${'Weight'.padStart(8)}${'Contrib'.padStart(10)}${'vs Nifty'.padStart(10)}`,
    );
    console.log('─'.repeat(102));

    type Row = {
      symbol: string;
      heldFrom: string;
      startMv: number;
      endMv: number;
      divsInWin: number;
      xirr: number | null;
      weight: number;
      contrib: number | null;
      alphaPp: number | null;
    };
    const rows: Row[] = [];

    for (const p of positions) {
      const hist = histBySym.get(p.symbol) ?? [];
      const cmp = prices.get(p.symbol)?.close;
      if (cmp == null || cmp <= 0) continue;
      const endMv = cmp * p.qty;
      const weight = totalMv > 0 ? endMv / totalMv : 0;

      const heldFrom = p.firstBuyDate > startDate ? p.firstBuyDate : startDate;

      // Opening MV at window start = qty_at(startDate) × price_at(startDate).
      const timeline = qtyTimelines.get(p.symbol);
      const qtyAtStart = timeline ? qtyOnDate(timeline, startDate) : 0;
      const pxAtStart = priceOnOrBefore(hist, startDate);
      const startMv =
        qtyAtStart > 0 && pxAtStart != null && pxAtStart > 0 ? qtyAtStart * pxAtStart : 0;

      // Per-symbol cashflows: trades (alias-resolved, intraday-excluded) + divs,
      // restricted to the window.
      const tradeCfs = tradesToCashflowsForSymbol(deliveryTrades, p.symbol, 0, today);
      const symDivs = divsBySymbol.get(p.symbol) ?? [];
      const divCfs: Cashflow[] = symDivs.map((d) => ({ date: d.date, amount: d.amount }));
      const divsInWin = symDivs
        .filter((d) => d.date > startDate && d.date <= today)
        .reduce((s, d) => s + d.amount, 0);

      const allCfs: Cashflow[] = [...tradeCfs, ...divCfs];
      const r = windowXirr({
        cashflows: allCfs,
        startDate,
        startMv,
        endDate: today,
        endMv,
      });
      const contrib = r != null ? r * weight : null;
      const alphaPp = r != null ? (r - benchRef[w.id]!) * weight : null;
      rows.push({
        symbol: p.symbol,
        heldFrom,
        startMv,
        endMv,
        divsInWin,
        xirr: r,
        weight,
        contrib,
        alphaPp,
      });
    }

    rows.sort((a, b) => (b.contrib ?? -Infinity) - (a.contrib ?? -Infinity));

    let totalContrib = 0;
    let totalAlpha = 0;
    for (const r of rows) {
      const xirrStr = r.xirr != null ? `${(r.xirr * 100).toFixed(2)}%` : '—';
      console.log(
        `${r.symbol.padEnd(14)}${r.heldFrom.padEnd(13)}${('₹' + Math.round(r.startMv).toLocaleString('en-IN')).padStart(11)}${('₹' + Math.round(r.endMv).toLocaleString('en-IN')).padStart(11)}${('₹' + Math.round(r.divsInWin).toLocaleString('en-IN')).padStart(13)}${xirrStr.padStart(11)}${(r.weight * 100).toFixed(1).padStart(6)}%${fmtPp(r.contrib).padStart(10)}${fmtPp(r.alphaPp).padStart(10)}`,
      );
      if (r.contrib != null) totalContrib += r.contrib;
      if (r.alphaPp != null) totalAlpha += r.alphaPp;
    }
    console.log('─'.repeat(102));
    console.log(
      `Sum of weighted contributions: ${(totalContrib * 100).toFixed(2)}%   |   Sum of weighted alpha: ${(totalAlpha * 100).toFixed(2)}pp`,
    );
  }

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
