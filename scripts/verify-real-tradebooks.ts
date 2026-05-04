/**
 * End-to-end verification of the user's real Zerodha tradebooks.
 *
 * What it does:
 *   1. Resets a sandbox SQLite DB at data/verify.db (NEVER touches app.db).
 *   2. Creates a portfolio + Zerodha account.
 *   3. Parses each xlsx in "Zerodha Data/" via lib/parsers/zerodha and ingests via lib/db/queries/trades.
 *   4. Cross-checks ingest counts (parser vs DB) and dedupe behaviour (re-ingest must skip all).
 *   5. Detects intraday pairs and computes FIFO holdings + realized P&L.
 *   6. Cross-validates: sum(buys) - sum(sells) per symbol == open lot qty.
 *   7. Fetches live EOD prices (Yahoo) for open symbols, computes market value + unrealized P&L.
 *   8. Computes portfolio XIRR using realized cashflows + current MV.
 *   9. Prints a structured report. No PII (broker IDs are stripped at parse time).
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

import * as schema from '@/lib/db/schema';
import { zerodhaParser } from '@/lib/parsers/zerodha';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { getOrCreateAccount } from '@/lib/db/queries/accounts';
import {
  insertTrades,
  getTradesForPortfolio,
  type NormalizedTradeInput,
} from '@/lib/db/queries/trades';
import { detectIntradayPairs } from '@/lib/analytics/intradayDetect';
import { computeFifo } from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { fetchEodQuotes } from '@/lib/pricing/yahoo';
import { portfolios, users } from '@/lib/db/schema';
import { hash as hashPassword } from '@/lib/auth/password';

const TRADEBOOK_DIR = resolve('./Zerodha Data');
const DB_PATH = resolve('./data/verify.db');

function fmtINR(n: number): string {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  // ── Setup sandbox DB ────────────────────────────────────────────────────────
  for (const ext of ['', '-wal', '-shm']) {
    const p = DB_PATH + ext;
    if (existsSync(p)) rmSync(p);
  }
  mkdirSync(dirname(DB_PATH), { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });

  // Create user + portfolio
  const passwordHash = await hashPassword('Verify_Password_123!');
  const user = db.insert(users).values({ passwordHash }).returning().get();
  const portfolio = db
    .insert(portfolios)
    .values({ userId: user.id, name: 'Verify', baseCurrency: 'INR' })
    .returning()
    .get();
  const account = getOrCreateAccount(db, portfolio.id, 'zerodha', 'Primary');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(' E2E VERIFICATION: Zerodha tradebooks');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  sandbox db: ${DB_PATH}`);
  console.log(`  portfolio:  ${portfolio.id} (Verify)`);
  console.log(`  account:    ${account.id} (zerodha/Primary)`);

  // ── 1. Parse + ingest all files ─────────────────────────────────────────────
  if (!existsSync(TRADEBOOK_DIR)) {
    throw new Error(`Tradebook directory not found: ${TRADEBOOK_DIR}`);
  }
  const files = readdirSync(TRADEBOOK_DIR)
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    .sort();
  if (files.length === 0) throw new Error('No xlsx files found');

  console.log(`\n── Parsing ${files.length} files ─────────────────────────────`);
  type FileResult = {
    file: string;
    parsedRows: number;
    inserted: number;
    skipped: number;
  };
  const fileResults: FileResult[] = [];
  let totalParsed = 0;

  for (const f of files) {
    const full = resolve(TRADEBOOK_DIR, f);
    const bytes = readFileSync(full);
    const detected = zerodhaParser.detect({ bytes, filename: f });
    if (!detected) {
      console.log(`  ✗ ${f} — NOT detected as zerodha`);
      continue;
    }
    const parsed = zerodhaParser.parse({ bytes, filename: f });
    totalParsed += parsed.length;
    const rows: NormalizedTradeInput[] = parsed.map((t: NormalizedTrade) => ({
      symbol: t.symbol,
      isin: t.isin ?? null,
      tradeDate: t.tradeDate,
      side: t.side,
      qty: t.qty,
      price: t.price,
      currency: t.currency,
      exchange: t.exchange ?? null,
      segment: t.segment ?? null,
      series: t.series ?? null,
      tradeId: t.tradeId ?? null,
      orderId: t.orderId ?? null,
      execTime: t.execTime ?? null,
      sourceRowIdx: t.rawRowIdx ?? null,
    }));
    const result = insertTrades(db, account.id, rows);
    fileResults.push({
      file: basename(f),
      parsedRows: parsed.length,
      inserted: result.inserted,
      skipped: result.skipped,
    });
    console.log(
      `  ✓ ${f.padEnd(40)} parsed=${String(parsed.length).padStart(5)}  ` +
        `inserted=${String(result.inserted).padStart(5)}  skipped=${String(result.skipped).padStart(3)}`,
    );
  }

  const totalInserted = fileResults.reduce((s, r) => s + r.inserted, 0);
  const totalSkippedFirstPass = fileResults.reduce((s, r) => s + r.skipped, 0);
  console.log(
    `\n  totals: parsed=${totalParsed}  inserted=${totalInserted}  skipped=${totalSkippedFirstPass}`,
  );

  // ── 2. Idempotency check: re-ingest, expect 100% skipped ────────────────────
  console.log(`\n── Re-ingesting (idempotency check) ──────────────────────────`);
  let reInserted = 0;
  let reSkipped = 0;
  for (const f of files) {
    const full = resolve(TRADEBOOK_DIR, f);
    const bytes = readFileSync(full);
    const parsed = zerodhaParser.parse({ bytes, filename: f });
    const rows: NormalizedTradeInput[] = parsed.map((t) => ({
      symbol: t.symbol,
      isin: t.isin ?? null,
      tradeDate: t.tradeDate,
      side: t.side,
      qty: t.qty,
      price: t.price,
      currency: t.currency,
      exchange: t.exchange ?? null,
      segment: t.segment ?? null,
      series: t.series ?? null,
      tradeId: t.tradeId ?? null,
      orderId: t.orderId ?? null,
      execTime: t.execTime ?? null,
      sourceRowIdx: t.rawRowIdx ?? null,
    }));
    const r = insertTrades(db, account.id, rows);
    reInserted += r.inserted;
    reSkipped += r.skipped;
  }
  console.log(`  re-inserted=${reInserted}  re-skipped=${reSkipped}`);
  if (reInserted !== 0) {
    console.log(`  ✗ FAIL: idempotency broken — ${reInserted} rows re-inserted`);
  } else {
    console.log(`  ✓ PASS: dedupe is idempotent`);
  }

  // ── 3. DB row count vs parser ───────────────────────────────────────────────
  const dbTrades = getTradesForPortfolio(db, portfolio.id);
  console.log(`\n── DB sanity ─────────────────────────────────────────────────`);
  console.log(`  trades in DB: ${dbTrades.length}`);
  if (dbTrades.length !== totalInserted) {
    console.log(`  ✗ FAIL: DB count (${dbTrades.length}) != inserted (${totalInserted})`);
  } else {
    console.log(`  ✓ PASS: DB count matches inserted count`);
  }

  // ── 4. Intraday detection ───────────────────────────────────────────────────
  // Convert DB rows back to NormalizedTrade shape for analytics
  const allTrades: NormalizedTrade[] = dbTrades.map((t, i) => ({
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side,
    qty: t.qty,
    price: t.price,
    currency: t.currency,
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
  const { pairs, delivery: deliveryRaw } = detectIntradayPairs(allTrades);
  const delivery = applySymbolAliases(deliveryRaw);
  console.log(`\n── Intraday detection ────────────────────────────────────────`);
  console.log(`  intraday pairs (excluded from holdings): ${pairs.length}`);
  console.log(`  delivery trades:                          ${delivery.length}`);
  if (pairs.length * 2 + delivery.length !== allTrades.length) {
    console.log(
      `  ✗ FAIL: pairs*2 + delivery (${pairs.length * 2 + delivery.length}) != all (${allTrades.length})`,
    );
  } else {
    console.log(`  ✓ PASS: pairs partition delivery cleanly`);
  }

  // ── 5. FIFO ─────────────────────────────────────────────────────────────────
  // Reattach symbol from delivery trades into lot accounting (lots loses symbol; we'll do per-symbol)
  // computeFifo returns flat lot list — cross-check via per-symbol qty math
  const symbolQty = new Map<string, { bought: number; sold: number }>();
  for (const t of delivery) {
    const cur = symbolQty.get(t.symbol) ?? { bought: 0, sold: 0 };
    if (t.side === 'buy') cur.bought += t.qty;
    else cur.sold += t.qty;
    symbolQty.set(t.symbol, cur);
  }

  // Per-symbol FIFO so opening-balance oversells (pre-FY20-21 holdings) don't blow up the whole portfolio.
  console.log(`\n── FIFO (per-symbol; pre-existing holdings reported separately) ─`);
  let openLots: { qty: number; costPerShare: number; date: string }[] = [];
  let realized: ReturnType<typeof computeFifo>['realized'] = [];
  const oversoldSymbols: { symbol: string; reason: string }[] = [];
  const bySymbolDelivery = new Map<string, NormalizedTrade[]>();
  for (const t of delivery) {
    const arr = bySymbolDelivery.get(t.symbol) ?? [];
    arr.push(t);
    bySymbolDelivery.set(t.symbol, arr);
  }
  for (const [symbol, trades] of bySymbolDelivery) {
    try {
      const r = computeFifo(
        trades,
        KNOWN_CORPORATE_ACTIONS.filter((a) => a.symbol === symbol),
      );
      openLots.push(...r.lots);
      realized.push(...r.realized);
    } catch (err) {
      oversoldSymbols.push({ symbol, reason: (err as Error).message });
    }
  }
  console.log(
    `  symbols processed cleanly:           ${bySymbolDelivery.size - oversoldSymbols.length}`,
  );
  console.log(`  symbols with pre-existing holdings:  ${oversoldSymbols.length}`);
  if (oversoldSymbols.length > 0) {
    console.log(
      `  (these had sells before any buys in tradebook range — likely demat-transferred from elsewhere)`,
    );
    for (const o of oversoldSymbols.slice(0, 20)) {
      console.log(`    • ${o.symbol.padEnd(20)} ${o.reason}`);
    }
  }

  const oversoldSet = new Set(oversoldSymbols.map((o) => o.symbol));
  const openQtyBySymbol = new Map<string, number>();
  for (const [symbol, qm] of symbolQty) {
    if (oversoldSet.has(symbol)) continue; // skip symbols that need an opening balance
    const open = qm.bought - qm.sold;
    if (open !== 0) openQtyBySymbol.set(symbol, open);
  }

  console.log(`\n── FIFO holdings (clean symbols only) ────────────────────────`);
  console.log(`  open symbols (qty > 0): ${openQtyBySymbol.size}`);
  console.log(`  realized trades (sells matched to lots): ${realized.length}`);
  console.log(`  total realized P&L: ${fmtINR(realized.reduce((s, r) => s + r.pnl, 0))}`);

  const sumOpenLotQty = openLots.reduce((s, l) => s + l.qty, 0);
  const sumOpenSymbolQty = [...openQtyBySymbol.values()].reduce((s, q) => s + q, 0);
  if (Math.abs(sumOpenLotQty - sumOpenSymbolQty) > 1e-6) {
    console.log(
      `  ✗ FAIL: open lot qty (${sumOpenLotQty}) != bought-sold per symbol (${sumOpenSymbolQty})`,
    );
  } else {
    console.log(`  ✓ PASS: open lot qty matches buy-sell math (${sumOpenLotQty} units)`);
  }

  // Top realized P&L symbols
  const realizedBySymbol = new Map<string, number>();
  for (const r of realized) {
    realizedBySymbol.set(r.symbol, (realizedBySymbol.get(r.symbol) ?? 0) + r.pnl);
  }
  const topGainers = [...realizedBySymbol.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topLosers = [...realizedBySymbol.entries()].sort((a, b) => a[1] - b[1]).slice(0, 5);
  console.log(`\n  Top 5 realized gainers:`);
  for (const [s, p] of topGainers) console.log(`    ${s.padEnd(20)} ${fmtINR(p)}`);
  console.log(`  Top 5 realized losers:`);
  for (const [s, p] of topLosers) console.log(`    ${s.padEnd(20)} ${fmtINR(p)}`);

  // ── 6. Live prices + market value ───────────────────────────────────────────
  const openSymbols = [...openQtyBySymbol.keys()];
  console.log(`\n── Fetching live EOD prices (Yahoo) ──────────────────────────`);
  console.log(
    `  symbols to fetch: ${openSymbols.length} (rate-limited 1 req/s, will take ~${openSymbols.length}s)`,
  );

  const startedAt = Date.now();
  const quoteMap = await fetchEodQuotes(openSymbols);
  console.log(
    `  fetched ${quoteMap.size}/${openSymbols.length} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  // Compute weighted-avg cost per symbol from delivery trades (FIFO open lots, not all buys)
  // Reconstruct per-symbol open lots by replaying delivery trades
  const openLotsBySymbol = new Map<string, { qty: number; costPerShare: number; date: string }[]>();
  for (const t of [...delivery].sort((a, b) =>
    a.tradeDate !== b.tradeDate
      ? a.tradeDate.localeCompare(b.tradeDate)
      : a.rawRowIdx - b.rawRowIdx,
  )) {
    const lots = openLotsBySymbol.get(t.symbol) ?? [];
    if (t.side === 'buy') {
      lots.push({ qty: t.qty, costPerShare: t.price, date: t.tradeDate });
    } else {
      let remaining = t.qty;
      while (remaining > 0 && lots.length > 0) {
        const head = lots[0]!;
        const used = Math.min(head.qty, remaining);
        head.qty -= used;
        remaining -= used;
        if (head.qty === 0) lots.shift();
      }
    }
    openLotsBySymbol.set(t.symbol, lots);
  }

  let totalInvestedOpen = 0;
  let totalMarketValue = 0;
  let pricedSymbols = 0;
  let unpricedSymbols: string[] = [];
  type Holding = {
    symbol: string;
    qty: number;
    avgCost: number;
    invested: number;
    last: number | null;
    mv: number | null;
    unrealized: number | null;
  };
  const holdings: Holding[] = [];

  for (const [symbol, qty] of openQtyBySymbol) {
    const lots = openLotsBySymbol.get(symbol) ?? [];
    const invested = lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
    const avgCost = qty > 0 ? invested / qty : 0;
    const quote = quoteMap.get(symbol);
    const last = quote?.close ?? null;
    const mv = last != null ? qty * last : null;
    const unrealized = mv != null ? mv - invested : null;
    if (last != null) {
      pricedSymbols++;
      totalInvestedOpen += invested;
      totalMarketValue += mv!;
    } else {
      unpricedSymbols.push(symbol);
    }
    holdings.push({ symbol, qty, avgCost, invested, last, mv, unrealized });
  }

  console.log(`  priced: ${pricedSymbols}/${openQtyBySymbol.size}`);
  if (unpricedSymbols.length > 0) {
    console.log(
      `  unpriced: ${unpricedSymbols.slice(0, 10).join(', ')}${unpricedSymbols.length > 10 ? `, +${unpricedSymbols.length - 10} more` : ''}`,
    );
  }

  // Top 10 holdings by market value
  const ranked = [...holdings].filter((h) => h.mv != null).sort((a, b) => b.mv! - a.mv!);
  console.log(`\n  Top 10 holdings by market value:`);
  console.log(
    `    ${'SYMBOL'.padEnd(20)} ${'QTY'.padStart(8)} ${'AVG'.padStart(10)} ${'LAST'.padStart(10)} ${'INVESTED'.padStart(14)} ${'MV'.padStart(14)} ${'UNREAL'.padStart(14)}`,
  );
  for (const h of ranked.slice(0, 10)) {
    console.log(
      `    ${h.symbol.padEnd(20)} ${String(h.qty).padStart(8)} ` +
        `${fmtINR(h.avgCost).padStart(10)} ${fmtINR(h.last!).padStart(10)} ` +
        `${fmtINR(h.invested).padStart(14)} ${fmtINR(h.mv!).padStart(14)} ${fmtINR(h.unrealized!).padStart(14)}`,
    );
  }

  // ── 7. Portfolio totals + XIRR ──────────────────────────────────────────────
  const realizedPnl = realized.reduce((s, r) => s + r.pnl, 0);
  const unrealizedPnl = totalMarketValue - totalInvestedOpen;
  const totalPnl = realizedPnl + unrealizedPnl;

  console.log(`\n── Portfolio totals ──────────────────────────────────────────`);
  console.log(`  Invested (open positions):   ${fmtINR(totalInvestedOpen).padStart(18)}`);
  console.log(`  Market Value (open):         ${fmtINR(totalMarketValue).padStart(18)}`);
  console.log(`  Unrealized P&L:              ${fmtINR(unrealizedPnl).padStart(18)}`);
  console.log(`  Realized P&L (FIFO, all-time): ${fmtINR(realizedPnl).padStart(16)}`);
  console.log(`  Total P&L:                   ${fmtINR(totalPnl).padStart(18)}`);

  // XIRR: cashflows = -buys, +sells, +current MV (today). Exclude symbols with pre-existing balances
  // (their sells have no matching cost basis in the dataset and would distort the rate).
  const cashflows: Cashflow[] = [];
  for (const t of delivery) {
    if (oversoldSet.has(t.symbol)) continue;
    const amount = (t.side === 'buy' ? -1 : 1) * t.qty * t.price;
    cashflows.push({ date: t.tradeDate, amount });
  }
  const today = new Date().toISOString().slice(0, 10);
  cashflows.push({ date: today, amount: totalMarketValue });

  let xirrPct: number | null = null;
  try {
    xirrPct = xirr(cashflows);
  } catch (err) {
    console.log(`  ✗ XIRR did not converge: ${(err as Error).message}`);
  }
  if (xirrPct != null) {
    console.log(`  XIRR (since-inception):      ${pct(xirrPct).padStart(18)}`);
  }

  // ── 8. Date span ────────────────────────────────────────────────────────────
  const dates = delivery.map((t) => t.tradeDate).sort();
  console.log(`\n── Date span ─────────────────────────────────────────────────`);
  console.log(`  earliest trade: ${dates[0]}`);
  console.log(`  latest trade:   ${dates[dates.length - 1]}`);

  // ── 9. Summary ──────────────────────────────────────────────────────────────
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(` SUMMARY`);
  console.log(`═══════════════════════════════════════════════════════════════`);
  console.log(`  files ingested:         ${files.length}`);
  console.log(`  trades ingested:        ${totalInserted}`);
  console.log(`  intraday pairs:         ${pairs.length}`);
  console.log(`  delivery trades:        ${delivery.length}`);
  console.log(`  realized sell legs:     ${realized.length}`);
  console.log(`  open symbols:           ${openQtyBySymbol.size}`);
  console.log(`  priced symbols:         ${pricedSymbols}`);
  console.log(`  realized P&L:           ${fmtINR(realizedPnl)}`);
  console.log(`  unrealized P&L:         ${fmtINR(unrealizedPnl)}`);
  console.log(`  total P&L:              ${fmtINR(totalPnl)}`);
  if (xirrPct != null) console.log(`  XIRR:                   ${pct(xirrPct)}`);
  console.log(`═══════════════════════════════════════════════════════════════`);

  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
