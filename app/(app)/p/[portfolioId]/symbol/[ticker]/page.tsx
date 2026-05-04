import { notFound } from 'next/navigation';
import Link from 'next/link';

import { db } from '@/lib/db/client';
import { getTradesForPortfolio } from '@/lib/db/queries/trades';
import { getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { getThesis } from '@/lib/db/queries/theses';
import { listEvents } from '@/lib/db/queries/events';
import { listFilings } from '@/lib/db/queries/filings';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { latestDecisionsByPortfolio } from '@/lib/db/queries/decisions';
import { latestCagrPlan } from '@/lib/db/queries/cagrPlans';
import { getStyleWeights, normaliseWeights } from '@/lib/db/queries/styleWeights';
import { getSession } from '@/lib/auth/session';

import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Section, slugify } from '@/components/ui/Section';
import { ArrowDown, ArrowUp, ChevronRight } from '@/components/ui/Icons';

import { ResearchSection } from './ResearchSection';
import { ThesisEditor } from './ThesisEditor';
import { CollapsibleTradeHistory } from './CollapsibleTradeHistory';
import { FinalRecommendationCard } from './FinalRecommendationCard';

import { compareSymbolToNifty } from '@/lib/analytics/symbolBenchmark';
import { fetchBenchmarkClose, getBenchmarkSeriesCached } from '@/lib/pricing/benchmarks';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import {
  defaultStyleWeights,
  scoreSymbol,
  type FiredRule,
  type SymbolState,
} from '@/lib/decisions/score';
import { forecastGrowth, loadFundamentals } from '@/lib/decisions/growthForecast';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { getSector } from '@/lib/sectors/map';
import { buildFundamentalsTable } from '@/lib/fundamentals/buildTable';
import { explainFiredRules, groupConflicts } from '@/lib/fundamentals/ruleExplain';
import { FundamentalsCard } from '@/lib/fundamentals/FundamentalsCard';
import { runCagrPlanForSymbol, type SymbolCagrSlice } from '@/lib/cagr/run';
import { CompounderPanel } from '@/app/(app)/p/[portfolioId]/decisions/CompounderPanel';
import { loadLatestThesisStressTest } from '@/lib/research/loadOutputs';
import {
  synthesize,
  type CagrPlannerAction,
  type CompounderClassification as FinalCompounderClass,
  type StalwartAction,
  type ThesisVerdict as FinalThesisVerdict,
} from '@/lib/synthesis/finalRecommendation';
import {
  STALWART_DISPLAY_LABEL,
  STALWART_DISPLAY_TONE,
  toDisplayAction,
} from '@/lib/decisions/displayAction';

type Props = {
  params: Promise<{ portfolioId: string; ticker: string }>;
};

type ActionKey = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

const ACTION_LABEL: Record<ActionKey, string> = {
  fresh_buy: 'Fresh Buy',
  add: 'Add',
  hold: 'Hold',
  trim_25: 'Trim 25%',
  trim_50: 'Trim 50%',
  exit: 'Exit',
};

const ACTION_TONE: Record<ActionKey, 'pos' | 'info' | 'neutral' | 'warning' | 'neg'> = {
  fresh_buy: 'pos',
  add: 'pos',
  hold: 'neutral',
  trim_25: 'warning',
  trim_50: 'warning',
  exit: 'neg',
};

function fmt(n: number, d = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

function fmtInr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

function fmtPct(x: number | null | undefined, decimals = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(decimals)}%`;
}

function pnlClass(n: number | null) {
  if (n == null) return 'text-[var(--color-muted)]';
  return n >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
}

function pctOrDash(rate: number | null): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const pct = rate * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

const COMPOUNDER_TONE = {
  '7-9x candidate': 'pos',
  'solid compounder': 'info',
  mediocre: 'warning',
  broken: 'neg',
} as const;

export default async function SymbolDetailPage({ params }: Props) {
  const { portfolioId, ticker } = await params;
  const symbol = decodeURIComponent(ticker).toUpperCase();

  // ── Trades + holding ────────────────────────────────────────────────────
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const symbolTrades = allTrades.filter((t) => t.symbol === symbol);

  const holdings = computeHoldings(db, portfolioId);
  const myHolding = holdings.find((h) => h.symbol === symbol) ?? null;
  const watchlist = listWatchlist(db, portfolioId);
  const watchEntry = watchlist.find((w) => w.symbol === symbol) ?? null;

  // The page exists if the user has either traded the symbol, watchlisted it,
  // or it's in the universe (for research candidates). Otherwise 404.
  const hasTrades = symbolTrades.length > 0;
  const isHeld = !!myHolding && myHolding.netQty > 0;
  const isWatched = !!watchEntry;
  const fund = loadFundamentals(symbol);

  if (!hasTrades && !isWatched && !fund) {
    notFound();
  }

  // ── Prices & per-symbol stats ───────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const allSymbols = [
    ...new Set([...holdings.map((h) => h.symbol), ...watchlist.map((w) => w.symbol), symbol]),
  ];
  const prices = getLatestPrices(db, allSymbols);
  const cmp = prices.get(symbol);
  const stats = getSymbolStats(db, [symbol], today).get(symbol) ?? {
    high52w: null,
    low52w: null,
    avgVolume30d: null,
  };

  // Position aggregates (delivery-only).
  const buys = symbolTrades.filter((t) => t.side === 'buy' && t.isIntradayPairId === null);
  const sells = symbolTrades.filter((t) => t.side === 'sell' && t.isIntradayPairId === null);
  const totalBuyQty = buys.reduce((s, t) => s + t.qty, 0);
  const totalSellQty = sells.reduce((s, t) => s + t.qty, 0);
  const totalBuyValue = buys.reduce((s, t) => s + t.qty * t.price, 0);
  const netQty = totalBuyQty - totalSellQty;
  const avgCost = totalBuyQty > 0 ? totalBuyValue / totalBuyQty : 0;
  const costBasis = avgCost * netQty;
  const marketValue = cmp ? cmp.close * netQty : null;
  const pnl = marketValue != null ? marketValue - costBasis : null;
  const pctReturn = pnl != null && costBasis > 0 ? (pnl / costBasis) * 100 : null;
  const positive = pnl != null && pnl >= 0;

  // Total portfolio MV for weight calc.
  let totalPortMv = 0;
  for (const h of holdings) {
    if (h.netQty <= 0) continue;
    const p = prices.get(h.symbol)?.close;
    if (typeof p === 'number') totalPortMv += p * h.netQty;
  }
  const positionWeightPct =
    isHeld && totalPortMv > 0 && marketValue != null ? (marketValue / totalPortMv) * 100 : null;

  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';
  const thesisRow = getThesis(db, portfolioId, symbol);

  // ── Decision: prefer the latest persisted snapshot if present, else
  // compute live from the rule library + style weights so the page still
  // shows a recommendation for newly-watched / universe-only symbols. ──
  const persistedDecisions = latestDecisionsByPortfolio(db, portfolioId);
  const persisted = persistedDecisions.find((d) => d.symbol === symbol) ?? null;
  const lib = loadLatestRuleLibrary();

  let action: ActionKey = 'hold';
  let score = 0;
  let firedRules: FiredRule[] = [];
  let perAction: Record<ActionKey, number> | null = null;

  if (persisted) {
    action = persisted.action as ActionKey;
    score = persisted.score;
    type Vote = {
      ruleId: string;
      action: string;
      weight: number;
      baseWeight?: number;
      styleScale?: number;
      tags?: string[];
      why?: string[];
    };
    type Payload = { votes?: Vote[]; perAction?: Record<string, number> };
    const payload = (persisted.payloadJson ?? {}) as Payload;
    firedRules = (payload.votes ?? []).map((v) => ({
      ruleId: v.ruleId,
      action: v.action as ActionKey,
      weight: v.weight,
      baseWeight: v.baseWeight ?? v.weight,
      styleScale: v.styleScale ?? 1,
      tags: v.tags ?? [],
      why: v.why ?? [],
    }));
    if (payload.perAction) perAction = payload.perAction as Record<ActionKey, number>;
  } else if (lib) {
    // Build a SymbolState matching `buildSymbolStates` shape.
    const lp = cmp?.close;
    let monthsHeld: number | undefined;
    if (myHolding && myHolding.firstTradeDate) {
      const ms = Date.now() - new Date(myHolding.firstTradeDate).getTime();
      monthsHeld = Math.floor(ms / (30 * 24 * 3600 * 1000));
    }
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
    const state: SymbolState = {
      symbol,
      netQty,
      avgCost: avgCost > 0 ? avgCost : undefined,
      currentPrice: lp,
      high52w: stats.high52w ?? undefined,
      low52w: stats.low52w ?? undefined,
      monthsHeld,
      thesisIntact: true,
      pe,
      roce5y,
      revenueCagr5y,
      netDebtToEbitda,
    };
    const stored = getStyleWeights(db, portfolioId);
    const weights =
      stored && Object.keys(stored).length > 0
        ? normaliseWeights(stored)
        : defaultStyleWeights(lib);
    const r = scoreSymbol(state, lib, weights);
    action = r.action as ActionKey;
    score = r.score;
    firedRules = r.fired;
    perAction = r.perAction as Record<ActionKey, number>;
  }

  // ── Rule lookups for citations / supporting investors ───────────────────
  const ruleById = new Map<
    string,
    typeof lib extends null ? never : NonNullable<typeof lib>['rules'][number]
  >();
  if (lib) for (const rl of lib.rules) ruleById.set(rl.id, rl);

  const firedView = firedRules.map((f) => {
    const r = ruleById.get(f.ruleId);
    const supporting = (r?.supporting_investors ?? []).map((s) => s.investor);
    return {
      ruleId: f.ruleId,
      action: f.action as ActionKey,
      weight: f.weight,
      baseWeight: f.baseWeight ?? f.weight,
      styleScale: f.styleScale ?? 1,
      tags: f.tags ?? r?.applicability_tags ?? [],
      why: f.why ?? [],
      schools: r?.schools ?? [],
      supporting_investors: supporting,
      consensus_tier: r?.consensus_tier ?? null,
      consensus_investor_count: r?.consensus_investor_count ?? null,
      backtest_alpha_avg: r?.backtest_alpha_avg ?? null,
      citations: r?.citations ?? [],
      statement: r?.statement ?? '',
    };
  });

  const ruleExplains = explainFiredRules(firedView);
  const conflict = groupConflicts(firedView);

  // ── Compounder profile + growth forecast ────────────────────────────────
  const sector = getSector(symbol);
  const valctxToday = new Date().toISOString().slice(0, 10);
  const symbolValctx = buildValuationContext({
    db,
    symbol,
    fund,
    sectorMedian: getSectorMedian(sector),
    endDate: valctxToday,
  });
  const compounder = computeCompounderProfile({
    symbol,
    sector,
    fundamentals: fund,
    firedRules: firedRules as (FiredRule & { tags?: string[] })[],
    valuation: {
      pe: symbolValctx.pe,
      peg: symbolValctx.peg,
      peVsSectorMedian: symbolValctx.peVsSectorMedian,
      peSectorMedian: symbolValctx.peSectorMedian,
      pe5yMedian: symbolValctx.pe5yMedian,
      pe10yPercentile: symbolValctx.pe10yPercentile,
      earningsYieldMinusGsec: symbolValctx.earningsYieldMinusGsec,
    },
  });
  const growth = forecastGrowth({
    symbol,
    fundamentals: fund,
    firedRules: firedRules as (FiredRule & { tags?: string[] })[],
    currentPrice: cmp?.close,
    priceHistory: [],
  });
  const fundamentalsTable = buildFundamentalsTable(fund);

  // ── Target-CAGR slice ───────────────────────────────────────────────────
  const storedCagrPlan = latestCagrPlan(db, portfolioId);
  const targetCagrPct = storedCagrPlan?.targetCagrPct ?? 22;
  const horizonYears = storedCagrPlan?.horizonYears ?? 10;
  let cagrSlice: SymbolCagrSlice | null = null;
  try {
    cagrSlice = runCagrPlanForSymbol({
      db,
      portfolioId,
      targetCagrPct,
      horizonYears,
      symbol,
    });
  } catch {
    cagrSlice = null;
  }

  // ── Final synthesis (across all 5 frameworks) ─────────────────────────
  // Sector weight + largest-holding flag for risk overrides.
  let mySectorWeight: number | null = null;
  let isLargestHolding = false;
  if (totalPortMv > 0) {
    const sectorMv = new Map<string, number>();
    let maxMv = 0;
    let largestSym: string | null = null;
    for (const h of holdings) {
      if (h.netQty <= 0) continue;
      const p = prices.get(h.symbol)?.close;
      if (typeof p !== 'number') continue;
      const mv = p * h.netQty;
      const sec = getSector(h.symbol) ?? 'Unknown';
      sectorMv.set(sec, (sectorMv.get(sec) ?? 0) + mv);
      if (mv > maxMv) {
        maxMv = mv;
        largestSym = h.symbol;
      }
    }
    const mySectorMv = sectorMv.get(sector);
    if (typeof mySectorMv === 'number') mySectorWeight = mySectorMv / totalPortMv;
    isLargestHolding = largestSym === symbol;
  }

  const stress = loadLatestThesisStressTest(symbol);
  const stressVerdict: FinalThesisVerdict | null = stress
    ? stress.verdict === 'watch'
      ? 'weakened'
      : (stress.verdict as FinalThesisVerdict)
    : 'untested';

  const cagrPlannerKind: CagrPlannerAction | null = cagrSlice?.action?.kind ?? null;
  const cagrPlannerForecast =
    cagrSlice?.action && typeof cagrSlice.action.forecastedCagr === 'number'
      ? cagrSlice.action.forecastedCagr
      : null;

  const finalRecommendation = synthesize({
    symbol,
    isHolding: isHeld,
    isWatchlist: isWatched,
    positionPct: positionWeightPct != null ? positionWeightPct / 100 : null,
    sectorWeight: mySectorWeight,
    totalSymbols: holdings.length,
    isLargestHolding,
    stalwartAction: action as StalwartAction,
    stalwartScore: score,
    compounderClass: compounder.classification as FinalCompounderClass,
    compounderWeightedScore: compounder.weightedScore,
    cagrAction: cagrPlannerKind,
    cagrForecast: cagrPlannerForecast,
    thesisVerdict: stressVerdict,
    growthYearFive: growth.yearFive,
    growthConfidence: growth.confidence,
    valuation: {
      pe: symbolValctx.pe,
      peg: symbolValctx.peg,
      peVsSectorMedian: symbolValctx.peVsSectorMedian,
      peSectorMedian: symbolValctx.peSectorMedian,
      pe5yMedian: symbolValctx.pe5yMedian,
      pe10yPercentile: symbolValctx.pe10yPercentile,
    },
  });

  // ── Vs Nifty 50 overlay (only meaningful when we have trades) ───────────
  let niftyPanel: {
    actualXirr: number | null;
    niftyXirr: number | null;
    alpha: number | null;
    niftyEndValue: number;
    actualEndValue: number;
    totalInvested: number;
  } | null = null;
  if (hasTrades) {
    const earliestTradeDate = symbolTrades.reduce(
      (min, t) => (t.tradeDate < min ? t.tradeDate : min),
      symbolTrades[0]!.tradeDate,
    );
    try {
      const niftySeries = await getBenchmarkSeriesCached('nifty50', earliestTradeDate, today);
      const currentNiftyClose = (await fetchBenchmarkClose('nifty50', today)) ?? 0;
      if (niftySeries.size > 0 && currentNiftyClose > 0) {
        niftyPanel = compareSymbolToNifty(
          symbolTrades,
          symbol,
          marketValue ?? 0,
          niftySeries,
          currentNiftyClose,
          today,
        );
      }
    } catch {
      niftyPanel = null;
    }
  }

  // ── Events + filings (for research panel) ───────────────────────────────
  const upcomingEvents = listEvents(db, portfolioId, {
    symbol,
    fromDate: today,
    order: 'asc',
  });
  const recentFilings = listFilings(db, portfolioId, { symbol });

  // ── Drawdown vs 52w high for header context ─────────────────────────────
  const drawdownPct =
    cmp && stats.high52w && stats.high52w > 0
      ? ((cmp.close - stats.high52w) / stats.high52w) * 100
      : null;

  const blendedFiveYearAnnualised =
    growth.yearFive > -1 ? Math.pow(1 + growth.yearFive, 1 / 5) - 1 : null;

  // ── Section list for the right-side TOC ─────────────────────────────────
  type TocItem = { number: string; title: string; visible: boolean };
  const toc: TocItem[] = [
    { number: 'I', title: 'Snapshot', visible: true },
    { number: 'II', title: 'Final Recommendation', visible: true },
    { number: 'III', title: 'Position context', visible: true },
    { number: 'IV', title: 'Stalwarts', visible: true },
    { number: 'V', title: 'Compounder Thesis', visible: true },
    { number: 'VI', title: 'Target-CAGR fit', visible: cagrSlice !== null },
    { number: 'VII', title: 'Growth forecast', visible: true },
    {
      number: 'VIII',
      title: 'Fundamentals & Stalwart Commentary',
      visible: fundamentalsTable.rows.length > 0,
    },
    { number: 'IX', title: 'Research', visible: true },
    { number: 'X', title: 'Vs Nifty 50', visible: niftyPanel !== null },
    { number: 'XI', title: 'Trade history', visible: hasTrades },
    { number: 'XII', title: 'Thesis editor', visible: true },
  ];

  return (
    <div className="flex gap-6">
      {/* Main column */}
      <div className="flex flex-1 flex-col gap-10">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
          <Link href={`/p/${portfolioId}/holdings`} className="hover:text-[var(--color-fg)]">
            Holdings
          </Link>
          <ChevronRight size={12} />
          <span className="text-[var(--color-fg)]">{symbol}</span>
        </nav>

        {/* Mobile TOC chip strip */}
        <div className="-mt-4 flex flex-wrap gap-1.5 lg:hidden">
          {toc
            .filter((t) => t.visible)
            .map((t) => (
              <a
                key={t.number}
                href={`#${slugify(t.title)}`}
                className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-[10px] font-medium text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
              >
                {t.number}. {t.title}
              </a>
            ))}
        </div>

        {/* I. Snapshot */}
        <Section number="I" title="Snapshot" id={slugify('Snapshot')}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-[var(--color-accent)] to-[#7c3aed] text-base font-semibold text-white shadow-[var(--shadow-sm)]">
                {symbol.slice(0, 2)}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-2xl font-semibold tracking-tight">{symbol}</h3>
                  <Badge tone="neutral">{sector}</Badge>
                  {isHeld ? (
                    <Badge tone="pos">Held</Badge>
                  ) : isWatched ? (
                    <Badge tone="info">Watchlisted</Badge>
                  ) : (
                    <Badge tone="neutral">Universe candidate</Badge>
                  )}
                </div>
                {cmp ? (
                  <p className="tnum mt-1 text-sm text-[var(--color-muted)]">
                    ₹{fmt(cmp.close)}{' '}
                    <span className="text-[var(--color-subtle)]">· {cmp.date}</span>
                    {stats.high52w != null && stats.low52w != null ? (
                      <>
                        {' '}
                        · 52w ₹{fmt(stats.low52w)}–₹{fmt(stats.high52w)}
                        {drawdownPct != null ? (
                          <span className={pnlClass(drawdownPct)}>
                            {' '}
                            ({drawdownPct >= 0 ? '+' : ''}
                            {drawdownPct.toFixed(1)}% vs high)
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm text-[var(--color-muted)]">No price data</p>
                )}
              </div>
            </div>
            {pnl != null ? (
              <div className="text-left sm:text-right">
                <div
                  className={`tnum flex items-baseline gap-1.5 text-2xl font-semibold sm:justify-end ${pnlClass(pnl)}`}
                >
                  {positive ? (
                    <ArrowUp size={18} className="self-center" />
                  ) : (
                    <ArrowDown size={18} className="self-center" />
                  )}
                  {pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}
                </div>
                {pctReturn != null ? (
                  <div className={`tnum text-sm ${pnlClass(pctReturn)}`}>
                    {pctReturn >= 0 ? '+' : ''}
                    {fmt(pctReturn)}%
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-5 sm:grid-cols-4">
            <KeyStat
              label="Recommended action"
              value={`${STALWART_DISPLAY_LABEL[toDisplayAction(action, { held: isHeld })]} · ${score.toFixed(2)}`}
            />
            <KeyStat
              label="Compounder"
              value={`${compounder.classification} · ${compounder.estimatedTenYearReturn.toFixed(1)}×`}
            />
            <KeyStat
              label="Forecast 5y CAGR"
              value={
                blendedFiveYearAnnualised != null
                  ? `${(blendedFiveYearAnnualised * 100).toFixed(1)}%`
                  : '—'
              }
            />
            <KeyStat
              label={isHeld ? 'Position weight' : isWatched ? 'Target buy' : 'Universe'}
              value={
                isHeld && positionWeightPct != null
                  ? `${positionWeightPct.toFixed(1)}%`
                  : isWatched && watchEntry?.targetBuyPrice != null
                    ? `₹${fmt(watchEntry.targetBuyPrice)}`
                    : isWatched
                      ? 'No target'
                      : 'Not held'
              }
            />
          </div>
        </Section>

        {/* II. Final Recommendation */}
        <Section
          number="II"
          title="Final Recommendation"
          id={slugify('Final Recommendation')}
          subtitle="Cross-framework synthesis with portfolio risk overrides"
        >
          <FinalRecommendationCard recommendation={finalRecommendation} held={isHeld} />
        </Section>

        {/* III. Position context */}
        <Section
          number="III"
          title="Position context"
          id={slugify('Position context')}
          subtitle={
            isHeld
              ? `Held since ${myHolding!.firstTradeDate}`
              : isWatched
                ? `${watchEntry!.conviction} conviction watch`
                : 'Research candidate from universe screener'
          }
        >
          {isHeld ? (
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <KeyStat label="Net Qty" value={fmt(netQty, 0)} />
              <KeyStat label="Avg Cost" value={`₹${fmt(avgCost)}`} />
              <KeyStat label="Cost Basis" value={fmtInr(costBasis)} />
              <KeyStat
                label="Market Value"
                value={marketValue != null ? fmtInr(marketValue) : '—'}
              />
            </div>
          ) : isWatched ? (
            <>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <KeyStat
                  label="Target Buy"
                  value={
                    watchEntry!.targetBuyPrice != null ? `₹${fmt(watchEntry!.targetBuyPrice)}` : '—'
                  }
                />
                <KeyStat
                  label="Target Sell"
                  value={
                    watchEntry!.targetSellPrice != null
                      ? `₹${fmt(watchEntry!.targetSellPrice)}`
                      : '—'
                  }
                />
                <KeyStat label="CMP" value={cmp ? `₹${fmt(cmp.close)}` : '—'} />
                <KeyStat
                  label="Days on watch"
                  value={`${Math.max(
                    0,
                    Math.floor((Date.now() - watchEntry!.createdAt) / (24 * 3600 * 1000)),
                  )}d`}
                />
              </div>
              {watchEntry!.thesis ? (
                <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3 text-xs whitespace-pre-line">
                  {watchEntry!.thesis}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="text-xs text-[var(--color-muted)]">
                Not held and not on your watchlist. This is a research candidate from the universe
                screener.
              </div>
              {cagrSlice?.candidate ? (
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <KeyStat
                    label="Composite score"
                    value={cagrSlice.candidate.compositeScore.toFixed(1)}
                  />
                  <KeyStat
                    label="Forecast CAGR"
                    value={fmtPct(cagrSlice.candidate.forecastedCagr, 0)}
                  />
                  <KeyStat
                    label="Frameworks"
                    value={
                      cagrSlice.candidate.frameworkSupport.map((f) => f.framework).join(' · ') ||
                      '—'
                    }
                  />
                </div>
              ) : null}
            </>
          )}
        </Section>

        {/* IV. Stalwarts (fired-rules from cross-investor codex) */}
        <Section
          number="IV"
          title="Stalwarts"
          id={slugify('Stalwarts')}
          subtitle={`${firedView.length} rule${firedView.length === 1 ? '' : 's'} fired · ${
            lib ? `Rule library v${lib.version}` : 'No library loaded'
          }`}
          action={
            <>
              {(() => {
                const da = toDisplayAction(action, { held: isHeld });
                return <Badge tone={STALWART_DISPLAY_TONE[da]}>{STALWART_DISPLAY_LABEL[da]}</Badge>;
              })()}
              <span className="text-xs text-[var(--color-muted)] tabular-nums">
                score {score.toFixed(2)}
              </span>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {conflict.isMixed ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-warn,var(--color-border))] bg-[var(--color-card-hover)] p-3 text-xs">
                <div className="font-medium text-[var(--color-fg)]">
                  Mixed signals: {conflict.addCount} buy/add vote
                  {conflict.addCount === 1 ? '' : 's'} (weight {conflict.addWeight.toFixed(2)}) vs{' '}
                  {conflict.trimCount} trim/exit vote{conflict.trimCount === 1 ? '' : 's'} (weight{' '}
                  {conflict.trimWeight.toFixed(2)})
                </div>
                <div className="mt-1 text-[var(--color-muted)]">
                  Net direction:{' '}
                  <span className="font-medium text-[var(--color-fg)]">
                    {conflict.netAction.toUpperCase()}
                  </span>{' '}
                  — when add-side weight exceeds trim-side by ≥20% the planner leans toward add.
                </div>
              </div>
            ) : null}
            <ul className="space-y-2">
              {firedView.map((r, idx) => (
                <li
                  key={r.ruleId}
                  className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>
                      {r.supporting_investors.slice(0, 4).map((inv) => (
                        <Badge key={inv} tone="info">
                          {inv.toUpperCase().slice(0, 10)}
                        </Badge>
                      ))}
                      {r.supporting_investors.length > 4 ? (
                        <span className="text-[10px] text-[var(--color-muted)]">
                          +{r.supporting_investors.length - 4}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      {r.backtest_alpha_avg !== null ? (
                        <span className="text-[var(--color-pos)]">
                          Backtest alpha {fmtPct(r.backtest_alpha_avg, 0)}/yr
                        </span>
                      ) : null}
                      <span
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted)] tabular-nums"
                        title={`Effective weight ${r.weight.toFixed(2)} = library ${r.baseWeight.toFixed(2)} × your style scale ${r.styleScale.toFixed(2)}`}
                      >
                        {ruleExplains[idx]?.weightLabel ?? 'Moderate'} · {r.weight.toFixed(2)}
                      </span>
                    </div>
                  </div>
                  <div className="mt-2 text-[var(--color-fg)]">{r.statement}</div>
                  {r.why.length > 0 ? (
                    <div className="mt-1 text-[var(--color-muted)]">
                      <span className="font-medium">Why this fired: </span>
                      {r.why.join(' · ')}
                    </div>
                  ) : null}
                  {r.citations[0] ? (
                    <div className="mt-2 text-[10px] text-[var(--color-muted)]">
                      <span className="font-medium">{r.citations[0].investor}</span>:{' '}
                      <span className="italic">
                        “{r.citations[0].quote.slice(0, 180)}
                        {r.citations[0].quote.length > 180 ? '…' : ''}”
                      </span>{' '}
                      {r.citations[0].source_url ? (
                        <a
                          href={r.citations[0].source_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[var(--color-accent)] underline"
                        >
                          source
                        </a>
                      ) : null}
                    </div>
                  ) : null}
                  {r.tags.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {r.tags.map((t) => (
                        <span
                          key={t}
                          className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
              {firedView.length === 0 ? (
                <li className="text-xs text-[var(--color-muted)]">
                  No rules fired — defaulting to hold (small prior).
                </li>
              ) : null}
            </ul>
            <div className="border-t border-dotted border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-muted)]">
              Methodology: action picked by highest summed weight per action; ties → hold.
              {perAction
                ? ` Per-action scores: ${(Object.entries(perAction) as [ActionKey, number][])
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
                    .join(' · ')}`
                : ''}
            </div>
          </div>
        </Section>

        {/* V. Compounder Thesis */}
        <Section
          number="V"
          title="Compounder Thesis"
          id={slugify('Compounder Thesis')}
          action={
            <Badge tone={COMPOUNDER_TONE[compounder.classification]}>
              {compounder.classification}
            </Badge>
          }
        >
          <CompounderPanel profile={compounder} />
        </Section>

        {/* VI. Target-CAGR fit */}
        {cagrSlice ? (
          <Section
            number="VI"
            title="Target-CAGR fit"
            id={slugify('Target-CAGR fit')}
            subtitle={`Plan target ${cagrSlice.targetCagrPct}% over ${cagrSlice.horizonYears}y`}
            action={
              <Link
                href={`/p/${portfolioId}/decisions/target-cagr`}
                className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] underline"
              >
                View full plan →
              </Link>
            }
          >
            {cagrSlice.action ? (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={cagrActionTone(cagrSlice.action.kind)}>
                    {cagrActionLabel(cagrSlice.action.kind)}
                  </Badge>
                  {cagrSlice.action.kind === 'replace' && cagrSlice.action.replacementSymbol ? (
                    <span className="text-[var(--color-muted)]">
                      →{' '}
                      <Link
                        href={`/p/${portfolioId}/symbol/${encodeURIComponent(cagrSlice.action.replacementSymbol)}`}
                        className="font-medium text-[var(--color-accent)] underline"
                      >
                        {cagrSlice.action.replacementSymbol}
                      </Link>
                    </span>
                  ) : null}
                  {typeof cagrSlice.action.forecastedCagr === 'number' ? (
                    <Badge tone="neutral">{fmtPct(cagrSlice.action.forecastedCagr, 0)}</Badge>
                  ) : null}
                  <span className="text-[var(--color-muted)] tabular-nums">
                    {cagrSlice.action.currentWeightPct !== undefined
                      ? `${cagrSlice.action.currentWeightPct.toFixed(1)}% → ${cagrSlice.action.targetWeightPct.toFixed(1)}%`
                      : `${cagrSlice.action.targetWeightPct.toFixed(1)}% target`}
                    {' · '}
                    <span
                      className={
                        cagrSlice.action.deltaInr >= 0
                          ? 'text-[var(--color-pos)]'
                          : 'text-[var(--color-neg)]'
                      }
                    >
                      {cagrSlice.action.deltaInr >= 0 ? '+' : ''}
                      {fmtInr(cagrSlice.action.deltaInr)}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[var(--color-muted)]">{cagrSlice.action.rationale}</p>
                {cagrSlice.action.thesisMd ? (
                  <p className="mt-2 whitespace-pre-line text-[var(--color-fg)]">
                    {cagrSlice.action.thesisMd}
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-[var(--color-muted)]">
                No specific action recommended for this symbol in the current target-CAGR plan.
              </div>
            )}
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KeyStat
                label="Portfolio current"
                value={fmtPct(cagrSlice.currentPortfolioForecastCagr, 1)}
              />
              <KeyStat
                label="Portfolio if you act"
                value={fmtPct(cagrSlice.proposedPortfolioForecastCagr, 1)}
              />
              <KeyStat label="Alpha uplift" value={fmtPct(cagrSlice.alphaUplift, 1)} />
            </div>
          </Section>
        ) : null}

        {/* VII. Growth forecast */}
        <Section
          number="VII"
          title="Growth forecast"
          id={slugify('Growth forecast')}
          action={
            <Badge tone={confidenceTone(growth.confidence)}>{growth.confidence} confidence</Badge>
          }
        >
          <div className="grid grid-cols-3 gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3">
            <ForecastPill label="1y" value={growth.yearOne} />
            <ForecastPill label="3y" value={growth.yearThree} />
            <ForecastPill label="5y" value={growth.yearFive} />
          </div>
          <ul className="mt-3 space-y-1 text-xs text-[var(--color-muted)]">
            {growth.basis.map((b, i) => (
              <li key={i}>• {b}</li>
            ))}
          </ul>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SmallStat
              label="PAT 5y CAGR"
              value={growth.inputs.patCagr5y != null ? fmtPct(growth.inputs.patCagr5y, 1) : '—'}
            />
            <SmallStat
              label="Revenue 5y CAGR"
              value={
                growth.inputs.revenueCagr5y != null ? fmtPct(growth.inputs.revenueCagr5y, 1) : '—'
              }
            />
            <SmallStat
              label="ROCE avg 5y"
              value={growth.inputs.roceAvg5y != null ? fmtPct(growth.inputs.roceAvg5y, 1) : '—'}
            />
            <SmallStat
              label="PE / fair PE"
              value={
                growth.inputs.currentPe != null
                  ? `${growth.inputs.currentPe.toFixed(0)}${
                      growth.inputs.historicalMedianPe != null
                        ? ` / ${growth.inputs.historicalMedianPe.toFixed(0)}`
                        : ''
                    }`
                  : '—'
              }
            />
          </div>
        </Section>

        {/* VIII. Fundamentals & Stalwart Commentary */}
        {fundamentalsTable.rows.length > 0 ? (
          <Section
            number="VIII"
            title="Fundamentals & Stalwart Commentary"
            id={slugify('Fundamentals & Stalwart Commentary')}
            bare
          >
            <Card padded={false}>
              <FundamentalsCard table={fundamentalsTable} />
            </Card>
          </Section>
        ) : null}

        {/* IX. Research — thesis verdict, accountability, AR/concall, filings, events, manifest, skill invocations */}
        <Section
          number="IX"
          title="Research"
          id={slugify('Research')}
          subtitle="Thesis verdict · accountability · AR/concall digests · filings · events · skill invocations"
          bare
        >
          <ResearchSection
            portfolioId={portfolioId}
            symbol={symbol}
            upcomingEvents={upcomingEvents}
            recentFilings={recentFilings}
          />
        </Section>

        {/* X. Vs Nifty 50 */}
        {niftyPanel ? (
          <Section
            number="X"
            title="Vs Nifty 50"
            id={slugify('Vs Nifty 50')}
            subtitle="Same rupees, same dates — what if you had bought Niftybees instead?"
          >
            <NiftyOverlayContent panel={niftyPanel} />
          </Section>
        ) : null}

        {/* XI. Trade history */}
        {hasTrades ? (
          <Section
            number="XI"
            title="Trade history"
            id={slugify('Trade history')}
            subtitle={`${symbolTrades.length} entries${
              symbolTrades.length >= 20 ? ' · collapsed by default' : ''
            }`}
            bare
          >
            <Card padded={false} className="overflow-hidden">
              <CollapsibleTradeHistory
                trades={symbolTrades.map((t) => ({
                  id: t.id,
                  tradeDate: t.tradeDate,
                  side: t.side as 'buy' | 'sell',
                  qty: t.qty,
                  price: t.price,
                  isIntradayPairId: t.isIntradayPairId,
                }))}
              />
            </Card>
          </Section>
        ) : null}

        {/* XII. Thesis editor */}
        <Section
          number="XII"
          title="Thesis editor"
          id={slugify('Thesis editor')}
          subtitle="Markdown thesis + checklist"
        >
          <ThesisEditor
            portfolioId={portfolioId}
            symbol={symbol}
            csrfToken={csrfToken}
            initial={{
              thesisMd: thesisRow?.thesisMd ?? '',
              checklist:
                (thesisRow?.checklistJson as
                  | { item: string; expected: 'pass' | 'fail' | 'unknown' }[]
                  | null) ?? [],
              entryDate: thesisRow?.entryDate ?? null,
              targetReviewDate: thesisRow?.targetReviewDate ?? null,
              lastReviewedAt: thesisRow?.lastReviewedAt ?? null,
            }}
          />
        </Section>
      </div>

      {/* Right TOC sidebar (desktop only) */}
      <aside className="sticky top-20 hidden h-fit w-44 shrink-0 lg:block">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] p-3">
          <div className="mb-2 text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            On this page
          </div>
          <ul className="flex flex-col gap-1">
            {toc
              .filter((t) => t.visible)
              .map((t) => (
                <li key={t.number}>
                  <a
                    href={`#${slugify(t.title)}`}
                    className="flex items-baseline gap-2 rounded px-1.5 py-1 text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]"
                  >
                    <span className="text-[10px] font-bold text-[var(--color-accent)] tabular-nums">
                      {t.number}.
                    </span>
                    <span>{t.title}</span>
                  </a>
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function KeyStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className="tnum mt-1 text-base font-semibold">{value}</div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-2">
      <div className="text-[10px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className="tnum mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function ForecastPill({ label, value }: { label: string; value: number }) {
  const sign = value >= 0 ? '+' : '';
  const tone = value >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
  return (
    <div className="flex flex-col items-center">
      <span className="text-[10px] text-[var(--color-muted)]">{label}</span>
      <span className={`text-base font-semibold tabular-nums ${tone}`}>
        {sign}
        {(value * 100).toFixed(1)}%
      </span>
    </div>
  );
}

function confidenceTone(c: 'low' | 'medium' | 'high'): 'pos' | 'info' | 'neutral' {
  if (c === 'high') return 'pos';
  if (c === 'medium') return 'info';
  return 'neutral';
}

function cagrActionLabel(kind: 'add' | 'keep' | 'trim_partial' | 'replace' | 'fresh_buy'): string {
  switch (kind) {
    case 'add':
      return 'Add';
    case 'keep':
      return 'Keep';
    case 'trim_partial':
      return 'Trim ~35%';
    case 'replace':
      return 'Replace';
    case 'fresh_buy':
      return 'Fresh buy';
  }
}

function cagrActionTone(
  kind: 'add' | 'keep' | 'trim_partial' | 'replace' | 'fresh_buy',
): 'pos' | 'info' | 'warning' | 'neg' {
  switch (kind) {
    case 'add':
      return 'pos';
    case 'keep':
      return 'info';
    case 'trim_partial':
      return 'warning';
    case 'replace':
      return 'neg';
    case 'fresh_buy':
      return 'pos';
  }
}

type NiftyPanelProps = {
  panel: {
    actualXirr: number | null;
    niftyXirr: number | null;
    alpha: number | null;
    niftyEndValue: number;
    actualEndValue: number;
    totalInvested: number;
  };
};

function NiftyOverlayContent({ panel }: NiftyPanelProps) {
  const { actualXirr, niftyXirr, alpha, niftyEndValue, actualEndValue } = panel;

  const verdict =
    alpha == null
      ? { tone: 'neutral' as const, text: 'Comparison unavailable' }
      : alpha > 0
        ? {
            tone: 'pos' as const,
            text: `You beat the market by ${pctOrDash(alpha)} (annualised)`,
          }
        : alpha < 0
          ? {
              tone: 'neg' as const,
              text: `Underperformed Nifty by ${pctOrDash(-alpha)} (annualised)`,
            }
          : { tone: 'neutral' as const, text: 'Matched Nifty exactly' };

  const niftyDeltaVsActual = niftyEndValue - actualEndValue;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Badge tone={verdict.tone}>{verdict.text}</Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-[var(--color-border)] pt-4 sm:grid-cols-4">
        <KeyStat label="Your XIRR" value={pctOrDash(actualXirr)} />
        <KeyStat label="Nifty XIRR" value={pctOrDash(niftyXirr)} />
        <KeyStat label="Alpha (You − Nifty)" value={pctOrDash(alpha)} />
        <KeyStat
          label="If Niftybees Instead"
          value={niftyEndValue > 0 ? `₹${fmt(niftyEndValue, 0)}` : '—'}
        />
      </div>

      {niftyEndValue > 0 && actualEndValue > 0 ? (
        <p className="text-xs text-[var(--color-muted)]">
          Mirrored Nifty position would currently be worth{' '}
          <span className={pnlClass(niftyDeltaVsActual <= 0 ? 1 : -1)}>
            ₹{fmt(niftyEndValue, 0)}
          </span>{' '}
          vs your actual ₹{fmt(actualEndValue, 0)} ({niftyDeltaVsActual >= 0 ? '+' : ''}
          {fmt(niftyDeltaVsActual, 0)} difference).
        </p>
      ) : null}
    </div>
  );
}
