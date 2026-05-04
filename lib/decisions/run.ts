/**
 * Orchestrator: build SymbolState records from current portfolio data and
 * produce decisions for each holding/watchlist symbol via lib/decisions/score.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { insertDecisions } from '@/lib/db/queries/decisions';
import { getStyleWeights, normaliseWeights } from '@/lib/db/queries/styleWeights';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import type { NormalizedTrade } from '@/lib/parsers/types';

import type { RuleLibrary } from '@/lib/codex/synthesize';
import { defaultStyleWeights, scoreSymbol, type SymbolState } from '@/lib/decisions/score';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { getSector } from '@/lib/sectors/map';

type Db = BetterSQLite3Database<typeof schema>;

export type RunDecisionsResult = {
  inserted: number;
  ruleLibraryVersion: string;
  perSymbol: { symbol: string; action: string; score: number; nFired: number }[];
};

export function buildSymbolStates(db: Db, portfolioId: string): SymbolState[] {
  // Use FIFO-derived open positions so symbol aliases (HDFC→HDFCBANK, LTI→LTIM,
  // AMARAJABAT→ARE&M) and corporate actions (bonus/split) are applied. Without
  // this, raw trades for pre-merger tickers produce ghost symbols in the
  // decisions table.
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryTrades.map((t, i) => ({
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
  const openPositions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const watch = listWatchlist(db, portfolioId);
  const seen = new Set<string>();
  const symbols: string[] = [];
  // Mirror the legacy `computeHoldings`-shaped rows for the rest of this fn so
  // the downstream code (which reads h.netQty / h.firstTradeDate) keeps working.
  const holdings = openPositions.map((p) => ({
    symbol: p.symbol,
    netQty: p.qty,
    firstTradeDate: p.firstBuyDate,
    // FIFO already gives us cost basis directly — no need for buyQty/buyValue.
    buyQty: p.qty,
    buyValue: p.costBasis,
  }));
  for (const h of holdings) {
    if (h.netQty > 0 && !seen.has(h.symbol)) {
      symbols.push(h.symbol);
      seen.add(h.symbol);
    }
  }
  for (const w of watch) {
    if (!seen.has(w.symbol)) {
      symbols.push(w.symbol);
      seen.add(w.symbol);
    }
  }
  if (symbols.length === 0) return [];

  const today = new Date().toISOString().slice(0, 10);
  const latest = getLatestPrices(db, symbols);
  const stats = getSymbolStats(db, symbols, today);

  const states: SymbolState[] = [];
  const holdingBySymbol = new Map(holdings.map((h) => [h.symbol, h]));

  for (const sym of symbols) {
    const h = holdingBySymbol.get(sym);
    const netQty = h ? h.netQty : 0;
    const avgCost =
      h && h.netQty > 0 && h.buyValue > 0 && h.buyQty > 0 ? h.buyValue / h.buyQty : undefined;
    const lp = latest.get(sym);
    const st = stats.get(sym) ?? { high52w: null, low52w: null, avgVolume30d: null };

    let monthsHeld: number | undefined;
    if (h && h.firstTradeDate) {
      const ms = Date.now() - new Date(h.firstTradeDate).getTime();
      monthsHeld = Math.floor(ms / (30 * 24 * 3600 * 1000));
    }

    // Pull fundamentals where available to enrich SymbolState so quality
    // rules (PE / ROCE / revenue CAGR / debt) can actually fire.
    const fund = loadFundamentals(sym);
    let pe: number | undefined;
    let roce5y: number | undefined;
    let revenueCagr5y: number | undefined;
    let netDebtToEbitda: number | undefined;
    if (fund) {
      pe = typeof fund.current?.pe === 'number' ? fund.current.pe : undefined;
      const years = Object.keys(fund.annual).sort();
      const lastFive = years.slice(-5);
      const roces = lastFive
        .map((y) => fund.annual[y]?.roce_pct)
        .filter((v): v is number => typeof v === 'number');
      if (roces.length > 0) roce5y = roces.reduce((a, b) => a + b, 0) / roces.length / 100;
      if (years.length >= 6) {
        const last = fund.annual[years[years.length - 1]!];
        const five = fund.annual[years[years.length - 6]!];
        if (
          last &&
          five &&
          typeof last.sales_cr === 'number' &&
          typeof five.sales_cr === 'number' &&
          five.sales_cr > 0
        ) {
          revenueCagr5y = Math.pow(last.sales_cr / five.sales_cr, 1 / 5) - 1;
        }
        if (
          last &&
          typeof last.debt_cr === 'number' &&
          typeof last.ebitda_cr === 'number' &&
          last.ebitda_cr > 0
        ) {
          netDebtToEbitda = last.debt_cr / last.ebitda_cr;
        }
      }
    }

    // Valuation context — own historical PE, sector PE comparison, PEG, P/B,
    // earnings-yield-vs-Gsec. Enables the score engine's valuation gates that
    // were previously silent.
    const sector = getSector(sym);
    const sectorMedian = sector ? getSectorMedian(sector) : null;
    const valctx = buildValuationContext({
      db,
      symbol: sym,
      fund,
      sectorMedian,
      endDate: today,
    });

    states.push({
      symbol: sym,
      netQty,
      avgCost,
      currentPrice: lp?.close,
      high52w: st.high52w ?? undefined,
      low52w: st.low52w ?? undefined,
      monthsHeld,
      thesisIntact: true, // default; thesis page can override later
      pe,
      roce5y,
      revenueCagr5y,
      netDebtToEbitda,
      pb: valctx.pb ?? undefined,
      peg: valctx.peg ?? undefined,
      peVsSectorMedian: valctx.peVsSectorMedian ?? undefined,
      pe5yMedian: valctx.pe5yMedian ?? undefined,
      pe10yPercentile: valctx.pe10yPercentile ?? undefined,
      earningsYieldMinusGsec: valctx.earningsYieldMinusGsec ?? undefined,
    });
  }
  return states;
}

export function runDecisions(
  db: Db,
  portfolioId: string,
  library: RuleLibrary,
): RunDecisionsResult {
  const states = buildSymbolStates(db, portfolioId);
  const stored = getStyleWeights(db, portfolioId);
  const weights =
    stored && Object.keys(stored).length > 0
      ? normaliseWeights(stored)
      : defaultStyleWeights(library);

  const rows = states.map((s) => {
    const r = scoreSymbol(s, library, weights);
    return {
      portfolioId,
      symbol: s.symbol,
      action: r.action,
      score: r.score,
      ruleLibraryVersion: library.version,
      payload: {
        votes: r.fired.map((f) => ({
          ruleId: f.ruleId,
          action: f.action,
          weight: f.weight,
          baseWeight: f.baseWeight,
          styleScale: f.styleScale,
          tags: f.tags ?? [],
          why: f.why ?? [],
        })),
        perAction: r.perAction,
        inputs: {
          netQty: s.netQty,
          currentPrice: s.currentPrice,
          high52w: s.high52w,
          low52w: s.low52w,
          monthsHeld: s.monthsHeld,
          pe: s.pe,
          roce5y: s.roce5y,
          revenueCagr5y: s.revenueCagr5y,
        },
      },
    };
  });
  insertDecisions(db, rows);
  return {
    inserted: rows.length,
    ruleLibraryVersion: library.version,
    perSymbol: rows.map((r) => ({
      symbol: r.symbol,
      action: r.action,
      score: r.score,
      nFired: (r.payload.votes ?? []).length,
    })),
  };
}
