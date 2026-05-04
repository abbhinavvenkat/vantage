/**
 * Orchestration helper that produces a CagrPlan from a portfolio's open
 * positions + watchlist by chaining the universe screener, growth forecaster,
 * and plan generator.
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import {
  buildCagrPlan,
  type CagrHolding,
  type CagrPlan,
  type WatchlistEvaluation,
} from '@/lib/cagr/portfolioPlan';
import {
  screenUniverse,
  type ScreenedCandidate,
  type MarketCapBucket,
} from '@/lib/cagr/universeScreener';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { forecastGrowth, loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';
import * as schema from '@/lib/db/schema';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import type { NormalizedTrade } from '@/lib/parsers/types';

type Db = BetterSQLite3Database<typeof schema>;

export type RunCagrPlanOptions = {
  db: Db;
  portfolioId: string;
  targetCagrPct: number;
  horizonYears: number;
  /** Override roots in tests. */
  universeRoot?: string;
  fundamentalsRoot?: string;
  backtestResultsRoot?: string;
};

function inferMarketCapBucket(mcapCr: number | null | undefined): MarketCapBucket {
  if (mcapCr === null || mcapCr === undefined || !Number.isFinite(mcapCr) || mcapCr <= 0) {
    return 'unknown';
  }
  if (mcapCr >= 50_000) return 'largecap';
  if (mcapCr >= 17_000) return 'midcap';
  if (mcapCr >= 500) return 'smallcap';
  return 'unknown';
}

export function buildHoldingsForCagr(
  db: Db,
  portfolioId: string,
  fundamentalsRoot?: string,
): CagrHolding[] {
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

  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  if (positions.length === 0) return [];
  const symbols = positions.map((p) => p.symbol);
  const latestPrices = getLatestPrices(db, symbols);
  const priceBySymbol = new Map<string, number>();
  for (const [sym, lp] of latestPrices) {
    priceBySymbol.set(sym, lp.close ?? 0);
  }

  const out: CagrHolding[] = [];
  for (const p of positions) {
    if (p.qty <= 0) continue;
    const fund = loadFundamentals(p.symbol, fundamentalsRoot);
    const fc = forecastGrowth({
      symbol: p.symbol,
      fundamentals: fund,
      firedRules: [],
    });
    const forecastedCagr =
      fc.yearFive > 0 ? Math.pow(1 + fc.yearFive, 1 / 5) - 1 : Math.max(0, fc.yearOne);
    const price = priceBySymbol.get(p.symbol) ?? 0;
    const mv = price > 0 ? price * p.qty : p.costBasis;
    const sector = typeof fund?.company_name === 'string' && fund?.annual ? 'Unknown' : 'Unknown';
    out.push({
      symbol: p.symbol,
      marketValue: mv,
      forecastedCagr: Number(forecastedCagr.toFixed(4)),
      sector,
      marketCapBucket: inferMarketCapBucket(fund?.current?.market_cap_cr ?? null),
    });
  }
  return out;
}

/**
 * Forecast each watchlist symbol so it can be evaluated in the plan alongside
 * holdings. Returns one row per watchlisted symbol with forecastedCagr,
 * sector + mcap (best-effort from candidate match or universe fallback).
 */
export function buildWatchlistForCagr(
  db: Db,
  portfolioId: string,
  candidates: ScreenedCandidate[],
  fundamentalsRoot?: string,
): WatchlistEvaluation[] {
  const watchlist = listWatchlist(db, portfolioId);
  if (watchlist.length === 0) return [];
  const out: WatchlistEvaluation[] = [];
  const candBySymbol = new Map<string, ScreenedCandidate>();
  for (const c of candidates) candBySymbol.set(c.symbol, c);

  for (const w of watchlist) {
    const cand = candBySymbol.get(w.symbol);
    let forecastedCagr: number;
    let sector: string;
    let bucket: MarketCapBucket;
    if (cand) {
      forecastedCagr = cand.forecastedCagr;
      sector = cand.sector;
      bucket = cand.marketCapBucket;
    } else {
      // Symbol isn't in this run's screener output — forecast directly.
      const fund = loadFundamentals(w.symbol, fundamentalsRoot);
      const fc = forecastGrowth({ symbol: w.symbol, fundamentals: fund, firedRules: [] });
      forecastedCagr =
        fc.yearFive > 0 ? Math.pow(1 + fc.yearFive, 1 / 5) - 1 : Math.max(0, fc.yearOne);
      sector = 'Unknown';
      bucket = 'unknown';
    }
    out.push({
      symbol: w.symbol,
      thesis: w.thesis ?? null,
      conviction: (w.conviction as 'high' | 'medium' | 'low' | null) ?? null,
      targetBuyPrice: w.targetBuyPrice ?? null,
      targetSellPrice: w.targetSellPrice ?? null,
      forecastedCagr: Number(forecastedCagr.toFixed(4)),
      sector,
      marketCapBucket: bucket,
      candidateMatch: cand ?? null,
    });
  }
  return out;
}

export type SymbolCagrSlice = {
  symbol: string;
  /** Action targeted at this symbol — null when neither plan action nor candidate involves it. */
  action: import('@/lib/cagr/portfolioPlan').CagrAction | null;
  /** Watchlist evaluation row when the symbol is on the watchlist. */
  watchlistEvaluation: WatchlistEvaluation | null;
  /** Universe candidate for this symbol (always present when in the screened set). */
  candidate: ScreenedCandidate | null;
  /** Same plan-level numbers as `runCagrPlan` returns — useful for "current vs proposed" sidebar. */
  currentPortfolioForecastCagr: number;
  proposedPortfolioForecastCagr: number;
  alphaUplift: number;
  /** Portfolio target for headline labelling. */
  targetCagrPct: number;
  horizonYears: number;
};

/**
 * Per-symbol slice of the target-CAGR plan. Useful for the unified per-stock
 * detail page so it can show "what does the planner say about THIS symbol"
 * without re-implementing the screener/forecast math.
 */
export function runCagrPlanForSymbol(
  opts: RunCagrPlanOptions & { symbol: string },
): SymbolCagrSlice {
  const { plan, candidates, watchlist } = runCagrPlan(opts);
  const sym = opts.symbol;
  const action =
    plan.actions.find(
      (a) => a.symbol === sym || (a.kind === 'replace' && a.replacementSymbol === sym),
    ) ?? null;
  const wl = watchlist.find((w) => w.symbol === sym) ?? null;
  const cand = candidates.find((c) => c.symbol === sym) ?? null;
  return {
    symbol: sym,
    action,
    watchlistEvaluation: wl,
    candidate: cand,
    currentPortfolioForecastCagr: plan.currentPortfolioForecastCagr,
    proposedPortfolioForecastCagr: plan.proposedPortfolioForecastCagr,
    alphaUplift: plan.alphaUplift,
    targetCagrPct: plan.targetCagrPct,
    horizonYears: plan.horizonYears,
  };
}

export function runCagrPlan(opts: RunCagrPlanOptions): {
  plan: CagrPlan;
  candidates: ScreenedCandidate[];
  holdings: CagrHolding[];
  watchlist: WatchlistEvaluation[];
} {
  const candidates = screenUniverse({
    targetCagrPct: opts.targetCagrPct,
    horizonYears: opts.horizonYears,
    universeRoot: opts.universeRoot,
    fundamentalsRoot: opts.fundamentalsRoot,
    backtestResultsRoot: opts.backtestResultsRoot,
  });

  const holdings = buildHoldingsForCagr(opts.db, opts.portfolioId, opts.fundamentalsRoot);

  // Decorate holdings with sector from universe.csv lookup if available.
  // (universeScreener already loaded universe rows; we re-read here for sector
  // attribution. Cheap because of fs cache, but we keep it lazy.)
  const sectorMap = new Map<string, string>();
  for (const c of candidates) sectorMap.set(c.symbol, c.sector);
  const enrichedHoldings: CagrHolding[] = holdings.map((h) => {
    const sector = sectorMap.get(h.symbol) ?? h.sector;
    // Layer the Compounder Thesis Framework classification on top so the
    // CAGR planner can override its forecast-only classifier:
    //  - '7-9x candidate' → 'add' (unless already largest position)
    //  - 'broken'         → 'replace'
    const fund = loadFundamentals(h.symbol, opts.fundamentalsRoot);
    const profile = computeCompounderProfile({
      symbol: h.symbol,
      sector: getSector(h.symbol) || sector,
      fundamentals: fund,
      firedRules: [],
    });
    return {
      ...h,
      sector,
      compounderClassification: profile.classification,
    };
  });

  const watchlist = buildWatchlistForCagr(
    opts.db,
    opts.portfolioId,
    candidates,
    opts.fundamentalsRoot,
  );

  const plan = buildCagrPlan({
    holdings: enrichedHoldings,
    watchlist,
    candidates,
    targetCagrPct: opts.targetCagrPct,
    horizonYears: opts.horizonYears,
  });

  return { plan, candidates, holdings: enrichedHoldings, watchlist };
}
