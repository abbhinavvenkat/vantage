/**
 * Diagnose the live XIRR computation for a portfolio in app.db.
 * Prints the cashflow stream, terminal MV, and the resulting XIRR side-by-side
 * with what Zerodha's P&L analyzer typically reports.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { netSameDayIntraday } from '@/lib/analytics/fifo';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { fetchEodQuotes } from '@/lib/pricing/yahoo';
import { upsertPrices } from '@/lib/db/queries/prices';
import { listDividendsForPortfolio } from '@/lib/db/queries/dividends';
import type { NormalizedTrade } from '@/lib/parsers/types';

function fmtINR(n: number): string {
  return `${n < 0 ? '-' : ''}₹${Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const dbPath = resolve('./data/app.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const ps = db.select().from(portfolios).all();
  const portfolio =
    ps.find((p) => p.name.toLowerCase() === (process.env.PORTFOLIO_NAME ?? '')) ?? ps[0]!;
  console.log(`Portfolio: ${portfolio.name} (${portfolio.id})`);

  // Load trades
  const allDbTrades = getTradesForPortfolio(db, portfolio.id);
  const deliveryDb = allDbTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryDb.map((t: Trade, i) => ({
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

  // Open positions (FIFO + aliases + corp actions)
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  console.log(`Open positions: ${positions.length}`);

  // Refresh prices for all aliased symbols (forces fresh CMP)
  const symbols = positions.map((p) => p.symbol);
  console.log(`Fetching live CMPs for ${symbols.length} aliased symbols...`);
  const fresh = await fetchEodQuotes(symbols);
  upsertPrices(db, [...fresh.values()]);
  const prices = getLatestPrices(db, symbols);

  let totalMv = 0;
  let unpriced: string[] = [];
  for (const p of positions) {
    const px = prices.get(p.symbol)?.close;
    if (px != null) totalMv += px * p.qty;
    else unpriced.push(p.symbol);
  }
  console.log(`Terminal MV (all positions × CMP): ${fmtINR(totalMv)}`);
  if (unpriced.length > 0) console.log(`  unpriced symbols: ${unpriced.join(', ')}`);

  // Build cashflows the SAME way the BenchmarkCard does:
  // delivery trades → -buys / +sells, plus terminal MV inflow today.
  // Use aliased + intraday-netted trades so cashflows match the FIFO MV math.
  const aliased = applySymbolAliases(normalized);
  const netted = netSameDayIntraday(aliased);

  let totalBought = 0;
  let totalSold = 0;
  const cashflows: Cashflow[] = [];
  for (const t of netted) {
    const amt = (t.side === 'buy' ? -1 : 1) * t.qty * t.price;
    cashflows.push({ date: t.tradeDate, amount: amt });
    if (t.side === 'buy') totalBought += t.qty * t.price;
    else totalSold += t.qty * t.price;
  }
  // Fold in dividends (Tax P&L sheet)
  const divs = listDividendsForPortfolio(db, portfolio.id);
  let totalDivs = 0;
  for (const d of divs) {
    cashflows.push({ date: d.exDate, amount: d.netAmount });
    totalDivs += d.netAmount;
  }
  const today = new Date().toISOString().slice(0, 10);
  cashflows.push({ date: today, amount: totalMv });

  console.log(`\n── Cashflow summary ─────────────────────────────`);
  console.log(`  Total bought:      ${fmtINR(totalBought)}`);
  console.log(`  Total sold:        ${fmtINR(totalSold)}`);
  console.log(`  Net deployed:      ${fmtINR(totalBought - totalSold)}`);
  console.log(`  Dividends received: ${fmtINR(totalDivs)} (${divs.length} payments)`);
  console.log(`  Terminal MV:       ${fmtINR(totalMv)}`);
  console.log(`  Total return:      ${fmtINR(totalMv + totalDivs - (totalBought - totalSold))}`);
  console.log(`  Date span:         ${cashflows[0]!.date} → ${today}`);

  let rate: number | null;
  try {
    rate = xirr(cashflows);
  } catch {
    rate = null;
  }
  console.log(`\nOur XIRR (all delivery + dividends):       ${pct(rate)}`);

  // Zerodha's documented Portfolio XIRR formula (per support.zerodha.com):
  //   "Combines your current holdings... It does not take into account historical
  //    buy and sell trades."
  // Implementation: per-lot outflow (qty × costPerShare on lot date) for each
  // currently-open lot, plus dividends received while holding, plus terminal MV.
  const heldOnlyCfs: Cashflow[] = [];
  for (const p of positions) {
    for (const lot of p.lots) {
      heldOnlyCfs.push({ date: lot.date, amount: -lot.qty * lot.costPerShare });
    }
  }
  // Dividends — include only those received AFTER the symbol's first open-lot date
  // (i.e., we still owned at least some shares when the dividend was paid).
  for (const d of divs) {
    const pos = positions.find((p) => p.symbol === d.symbol);
    if (pos && d.exDate >= pos.firstBuyDate) {
      heldOnlyCfs.push({ date: d.exDate, amount: d.netAmount });
    }
  }
  heldOnlyCfs.push({ date: today, amount: totalMv });
  let heldOnlyRate: number | null;
  try {
    heldOnlyRate = xirr(heldOnlyCfs);
  } catch {
    heldOnlyRate = null;
  }
  console.log(`Zerodha-style XIRR (per-lot, held-only):   ${pct(heldOnlyRate)}`);

  // Hypothesis 3: position-weighted CAGR — for each open position, take
  // (current_mv / cost_basis)^(1/years_since_first_buy) - 1, then weight by MV.
  // This is what Zerodha Coin labels "Annualised return" on the holdings screen.
  let weightedCagrNum = 0;
  let weightedCagrDen = 0;
  for (const p of positions) {
    const px = prices.get(p.symbol)?.close;
    if (px == null) continue;
    const mv = px * p.qty;
    const yearsHeld = Math.max(
      0.05,
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${p.firstBuyDate}T00:00:00Z`)) /
        (365 * 86_400_000),
    );
    if (p.costBasis <= 0) continue;
    const lotCagr = Math.pow(mv / p.costBasis, 1 / yearsHeld) - 1;
    weightedCagrNum += lotCagr * mv;
    weightedCagrDen += mv;
  }
  const weightedCagr = weightedCagrDen > 0 ? weightedCagrNum / weightedCagrDen : null;
  console.log(`Position-weighted CAGR (held-only):        ${pct(weightedCagr)}`);
  console.log(`Zerodha reported XIRR:                     13.87%`);
  console.log(
    `Gap (all):    ${rate != null ? ((rate - 0.1387) * 100).toFixed(2) : '—'}%   |   Gap (held): ${heldOnlyRate != null ? ((heldOnlyRate - 0.1387) * 100).toFixed(2) : '—'}%`,
  );

  console.log(`\n── Notes ───────────────────────────────────────`);
  console.log(
    `  1. DIVIDENDS not ingested. Zerodha P&L includes div cashflows; our tradebook has only orders.`,
  );
  console.log(
    `     Indian equities you hold (HDFCBANK, BAJAJ-AUTO, ITC*, BEL, EICHERMOT, KOTAKBANK)`,
  );
  console.log(`     yield ~1-3% combined → likely +3-5% on XIRR. Closes most of the gap.`);
  console.log(`  2. Buyback/special dividend cashflows similarly missing.`);
  console.log(
    `  3. Cash-equivalent realized gains from intraday pairs (excluded as delivery-only).`,
  );
  console.log(`  4. Brokerage/STT/exchange charges — would push XIRR DOWN, not up.`);

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
