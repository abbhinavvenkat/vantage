/**
 * Standalone summary dashboard for /p/<id>/decisions.
 *
 * Self-contained Server Component. Loads everything via existing exports —
 * no signature changes to helper modules. Mount with:
 *   <SummaryDashboard portfolioId={portfolioId} />
 */

import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Sparkle, TrendingUp, ChevronRight, Refresh } from '@/components/ui/Icons';

import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { runCagrPlan } from '@/lib/cagr/run';
import { computeCompounderProfile, type CompounderProfile } from '@/lib/compounder/score';
import { db } from '@/lib/db/client';
import { latestCagrPlan } from '@/lib/db/queries/cagrPlans';
import {
  decisionsForSnapshot,
  latestDecisionsByPortfolio,
  listDecisionSnapshots,
} from '@/lib/db/queries/decisions';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { getStyleWeights, normaliseWeights } from '@/lib/db/queries/styleWeights';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import {
  ACTION_KEYS,
  buildCompounderDistribution,
  buildRecentSnapshots,
  findFrameworkConflicts,
  summariseStalwartDisplayActions,
  topStyleInvestors,
  type ActionKey,
  type DecisionLite,
} from '@/lib/decisions/summarise';
import {
  STALWART_DISPLAY_ACTIONS,
  STALWART_DISPLAY_LABEL,
  STALWART_DISPLAY_TONE,
  finalToDisplayAction,
  toDisplayAction,
} from '@/lib/decisions/displayAction';
import { forecastGrowth } from '@/lib/decisions/growthForecast';
import {
  synthesize,
  type CagrPlannerAction,
  type CompounderClassification as FinalCompounderClass,
  type FinalAction,
  type StalwartAction,
  type ThesisVerdict as FinalThesisVerdict,
} from '@/lib/synthesis/finalRecommendation';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { loadLatestThesisStressTest } from '@/lib/research/loadOutputs';
import { defaultStyleWeights } from '@/lib/decisions/score';
import type { CagrAction } from '@/lib/cagr/portfolioPlan';
import { getSector } from '@/lib/sectors/map';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { listFilings } from '@/lib/db/queries/filings';
import { summariseResearchSignals } from '@/lib/research/signals';

type Props = { portfolioId: string };

const ACTION_LABEL: Record<ActionKey, string> = {
  fresh_buy: 'Fresh buys',
  add: 'Add',
  hold: 'Hold',
  trim_25: 'Trim 25',
  trim_50: 'Trim 50',
  exit: 'Exit',
};

const ACTION_TONE: Record<ActionKey, 'pos' | 'neg' | 'info' | 'warning' | 'neutral'> = {
  fresh_buy: 'pos',
  add: 'pos',
  hold: 'neutral',
  trim_25: 'warning',
  trim_50: 'warning',
  exit: 'neg',
};

const CLASS_TONE: Record<
  CompounderProfile['classification'],
  'pos' | 'neg' | 'info' | 'warning' | 'neutral'
> = {
  '7-9x candidate': 'pos',
  'solid compounder': 'info',
  mediocre: 'warning',
  broken: 'neg',
};

const CLASS_BAR_COLOR: Record<CompounderProfile['classification'], string> = {
  '7-9x candidate': 'var(--color-pos)',
  'solid compounder': 'var(--color-accent)',
  mediocre: '#d97706',
  broken: 'var(--color-neg)',
};

function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

function fmtInr(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${n < 0 ? '-' : ''}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${n < 0 ? '-' : ''}₹${(abs / 1e5).toFixed(2)} L`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function fmtTs(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default async function SummaryDashboard({ portfolioId }: Props) {
  // ---- Load everything ----------------------------------------------------
  const lib = loadLatestRuleLibrary();
  const decisionRows = latestDecisionsByPortfolio(db, portfolioId);
  const holdings = computeHoldings(db, portfolioId).filter((h) => h.netQty > 0);
  const watchlist = listWatchlist(db, portfolioId);

  // Style weights — use stored if available, otherwise default uniform across
  // investors in the loaded library.
  const storedStyle = getStyleWeights(db, portfolioId);
  const styleWeights =
    storedStyle && Object.keys(storedStyle).length > 0
      ? normaliseWeights(storedStyle)
      : lib
        ? defaultStyleWeights(lib)
        : {};
  const investorsBacking = new Set<string>();
  if (lib) {
    for (const r of lib.rules)
      for (const s of r.supporting_investors) investorsBacking.add(s.investor);
  }

  // ---- Decisions (lite) for the summariser --------------------------------
  // Build a held-set so we can route 'hold' winners on watchlist symbols to
  // the 'pass' display tile (instead of the misleading 'retain' bucket).
  const heldSet = new Set(holdings.map((h) => h.symbol));
  type Vote = { ruleId: string; action: string; weight: number };
  type Inputs = { netQty?: number };
  const decisionsLite: (DecisionLite & { held: boolean })[] = decisionRows.map((d) => {
    const payload = (d.payloadJson ?? {}) as { votes?: Vote[]; inputs?: Inputs };
    const votes = (payload.votes ?? []).map((v) => ({
      ruleId: v.ruleId,
      action: v.action,
      weight: Number(v.weight) || 0,
    }));
    const heldFromInputs =
      payload.inputs && typeof payload.inputs.netQty === 'number'
        ? payload.inputs.netQty > 0
        : heldSet.has(d.symbol);
    return {
      symbol: d.symbol,
      action: d.action as ActionKey,
      score: d.score,
      votes,
      held: heldFromInputs,
    };
  });
  const stalwartDisplayCounts = summariseStalwartDisplayActions(decisionsLite);
  // Build display-vocab tiles by walking the decisions once; each symbol's
  // bucket is decided by `toDisplayAction(action, { held })` so watchlist
  // symbols whose winning action is 'hold' land in 'pass' rather than 'retain'.
  const stalwartDisplayTiles: Record<
    (typeof STALWART_DISPLAY_ACTIONS)[number],
    {
      count: number;
      totalWeight: number;
      topSymbols: { symbol: string; weight: number; score: number }[];
    }
  > = {
    add_more: { count: 0, totalWeight: 0, topSymbols: [] },
    retain: { count: 0, totalWeight: 0, topSymbols: [] },
    pass: { count: 0, totalWeight: 0, topSymbols: [] },
    sell_partial: { count: 0, totalWeight: 0, topSymbols: [] },
    sell_full: { count: 0, totalWeight: 0, topSymbols: [] },
  };
  for (const d of decisionsLite) {
    if (!ACTION_KEYS.includes(d.action)) continue;
    const da = toDisplayAction(d.action, { held: d.held });
    const matchingVotes = d.votes.filter((v) => v.action === d.action);
    const symWeight = matchingVotes.reduce((s, v) => s + (Number(v.weight) || 0), 0);
    stalwartDisplayTiles[da].totalWeight += symWeight;
    stalwartDisplayTiles[da].topSymbols.push({
      symbol: d.symbol,
      weight: Number(symWeight.toFixed(4)),
      score: d.score,
    });
  }
  for (const da of STALWART_DISPLAY_ACTIONS) {
    stalwartDisplayTiles[da].count = stalwartDisplayCounts[da];
    stalwartDisplayTiles[da].topSymbols = stalwartDisplayTiles[da].topSymbols
      .sort((a, b) => b.weight - a.weight || b.score - a.score)
      .slice(0, 3);
    stalwartDisplayTiles[da].totalWeight = Number(stalwartDisplayTiles[da].totalWeight.toFixed(4));
  }

  // ---- Compounder profiles for every holding + watchlist symbol ----------
  const allSymbols = Array.from(
    new Set([
      ...holdings.map((h) => h.symbol),
      ...watchlist.map((w) => w.symbol),
      ...decisionsLite.map((d) => d.symbol),
    ]),
  );
  const dashToday = new Date().toISOString().slice(0, 10);
  const profiles: CompounderProfile[] = allSymbols.map((sym) => {
    const fund = loadFundamentals(sym);
    const sec = getSector(sym) || 'Unknown';
    const v = buildValuationContext({
      db,
      symbol: sym,
      fund,
      sectorMedian: getSectorMedian(sec),
      endDate: dashToday,
    });
    return computeCompounderProfile({
      symbol: sym,
      sector: sec,
      fundamentals: fund,
      firedRules: [],
      valuation: {
        pe: v.pe,
        peg: v.peg,
        peVsSectorMedian: v.peVsSectorMedian,
        peSectorMedian: v.peSectorMedian,
        pe5yMedian: v.pe5yMedian,
        pe10yPercentile: v.pe10yPercentile,
        earningsYieldMinusGsec: v.earningsYieldMinusGsec,
      },
    });
  });
  const profileBySym = new Map(profiles.map((p) => [p.symbol, p]));
  const compDist = buildCompounderDistribution(profiles);

  // ---- Target-CAGR snapshot ------------------------------------------------
  // Use persisted plan if available; otherwise compute live.
  const persistedPlan = latestCagrPlan(db, portfolioId);
  const targetCagrPct = persistedPlan?.targetCagrPct ?? 22;
  const horizonYears = persistedPlan?.horizonYears ?? 10;

  let cagrCurrentForecast = persistedPlan?.currentForecastCagr ?? null;
  let cagrProposedForecast = persistedPlan?.proposedForecastCagr ?? null;
  let cagrActions: CagrAction[] = [];
  let cagrComputedLive = false;
  if (!persistedPlan) {
    try {
      const live = runCagrPlan({
        db,
        portfolioId,
        targetCagrPct,
        horizonYears,
      });
      cagrCurrentForecast = live.plan.currentPortfolioForecastCagr;
      cagrProposedForecast = live.plan.proposedPortfolioForecastCagr;
      cagrActions = live.plan.actions;
      cagrComputedLive = true;
    } catch {
      // If the planner cannot run (missing universe.csv or fundamentals), the
      // dashboard still renders without CAGR numbers.
      cagrActions = [];
    }
  } else {
    // The persisted plan stores the action list inside planJson; pull it back
    // out for the dashboard.
    const planJson = persistedPlan.planJson as { actions?: CagrAction[] } | null;
    cagrActions = planJson?.actions ?? [];
  }
  const cagrAlpha =
    cagrCurrentForecast !== null && cagrProposedForecast !== null
      ? cagrProposedForecast - cagrCurrentForecast
      : null;
  const cagrActionsBySymbol = new Map<string, CagrAction>();
  for (const a of cagrActions) cagrActionsBySymbol.set(a.symbol, a);
  const topImpactActions = cagrActions
    .filter((a) => a.kind === 'replace' || a.kind === 'add' || a.kind === 'fresh_buy')
    .sort((a, b) => Math.abs(b.deltaInr) - Math.abs(a.deltaInr))
    .slice(0, 3);

  // ---- Mixed-signal conflicts ---------------------------------------------
  const conflicts = findFrameworkConflicts({
    decisions: decisionsLite,
    profilesBySymbol: profileBySym,
    cagrActionsBySymbol,
  }).slice(0, 5);

  // ---- Style mixer numbers -------------------------------------------------
  const topStyle = topStyleInvestors(styleWeights, 3);

  // ---- Research signals ---------------------------------------------------
  const researchSymbols = Array.from(
    new Set([...holdings.map((h) => h.symbol), ...watchlist.map((w) => w.symbol)]),
  );
  const researchSignals = summariseResearchSignals(researchSymbols);
  const filingsToReadCount = listFilings(db, portfolioId, {
    triage: 'read_now',
    isRead: false,
  }).length;

  // ---- Final synthesis counts (parallel to Action signals) ----------------
  // For each scored symbol we synthesise across all 5 frameworks. We only
  // need lightweight inputs here — fundamentals + price + sector — so this
  // adds at most a few ms per symbol on the dashboard render.
  const watchSet = new Set(watchlist.map((w) => w.symbol));
  const holdBySym = new Map(holdings.map((h) => [h.symbol, h]));
  const dashPrices = getLatestPrices(db, allSymbols);
  let dashTotalMv = 0;
  const dashSectorMv = new Map<string, number>();
  let dashMaxMv = 0;
  let dashLargestSym: string | null = null;
  for (const h of holdings) {
    const p = dashPrices.get(h.symbol)?.close;
    if (typeof p !== 'number') continue;
    const mv = p * h.netQty;
    dashTotalMv += mv;
    const sec = getSector(h.symbol) ?? 'Unknown';
    dashSectorMv.set(sec, (dashSectorMv.get(sec) ?? 0) + mv);
    if (mv > dashMaxMv) {
      dashMaxMv = mv;
      dashLargestSym = h.symbol;
    }
  }
  const finalRows: { symbol: string; finalAction: FinalAction; held: boolean }[] =
    decisionsLite.map((d) => {
      const profile = profileBySym.get(d.symbol) ?? null;
      const cagr = cagrActionsBySymbol.get(d.symbol) ?? null;
      const stress = loadLatestThesisStressTest(d.symbol);
      const stressVerdict: FinalThesisVerdict | null = stress
        ? stress.verdict === 'watch'
          ? 'weakened'
          : (stress.verdict as FinalThesisVerdict)
        : 'untested';
      const fund = loadFundamentals(d.symbol);
      const growthOut = forecastGrowth({
        symbol: d.symbol,
        fundamentals: fund,
        firedRules: [],
        priceHistory: [],
      });
      const h = holdBySym.get(d.symbol);
      const lp = dashPrices.get(d.symbol)?.close;
      const positionPct =
        h && typeof lp === 'number' && dashTotalMv > 0 ? (lp * h.netQty) / dashTotalMv : null;
      const sec = getSector(d.symbol) ?? 'Unknown';
      const sectorWeight =
        dashTotalMv > 0 && dashSectorMv.has(sec) ? dashSectorMv.get(sec)! / dashTotalMv : null;
      const valctx = buildValuationContext({
        db,
        symbol: d.symbol,
        fund,
        sectorMedian: getSectorMedian(sec),
        endDate: dashToday,
      });
      const rec = synthesize({
        symbol: d.symbol,
        isHolding: !!h,
        isWatchlist: watchSet.has(d.symbol),
        positionPct,
        sectorWeight,
        totalSymbols: holdings.length,
        isLargestHolding: dashLargestSym === d.symbol,
        stalwartAction: d.action as StalwartAction,
        stalwartScore: d.score,
        compounderClass: profile ? (profile.classification as FinalCompounderClass) : null,
        compounderWeightedScore: profile?.weightedScore ?? null,
        cagrAction: (cagr?.kind ?? null) as CagrPlannerAction | null,
        cagrForecast: cagr && typeof cagr.forecastedCagr === 'number' ? cagr.forecastedCagr : null,
        thesisVerdict: stressVerdict,
        growthYearFive: growthOut.yearFive,
        growthConfidence: growthOut.confidence,
        valuation: {
          pe: valctx.pe,
          peg: valctx.peg,
          peVsSectorMedian: valctx.peVsSectorMedian,
          peSectorMedian: valctx.peSectorMedian,
          pe5yMedian: valctx.pe5yMedian,
          pe10yPercentile: valctx.pe10yPercentile,
        },
      });
      return { symbol: d.symbol, finalAction: rec.action, held: !!h };
    });
  // Display-vocab counts for the "Final synthesis" tile row, with not-held
  // 'hold' routed to 'pass' so watchlist symbols don't show as Retain.
  const finalDisplayCounts: Record<(typeof STALWART_DISPLAY_ACTIONS)[number], number> = {
    add_more: 0,
    retain: 0,
    pass: 0,
    sell_partial: 0,
    sell_full: 0,
  };
  for (const r of finalRows) {
    finalDisplayCounts[finalToDisplayAction(r.finalAction, { held: r.held })] += 1;
  }

  // ---- Recent snapshots audit ---------------------------------------------
  const allSnapshots = listDecisionSnapshots(db, portfolioId);
  const recent = buildRecentSnapshots(
    allSnapshots,
    (snapshotAt) => {
      const rows = decisionsForSnapshot(db, portfolioId, snapshotAt);
      return new Map(rows.map((r) => [r.symbol, r.action as ActionKey]));
    },
    3,
  );

  // ---- Render --------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {/* A. Action signal counters */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Action signals
          </h3>
          <span className="text-xs text-[var(--color-muted)]">
            {decisionsLite.length} symbol{decisionsLite.length === 1 ? '' : 's'} scored
          </span>
        </div>
        <div className="mt-2 text-[10px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Stalwarts only
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STALWART_DISPLAY_ACTIONS.map((a) => {
            const t = stalwartDisplayTiles[a];
            return (
              <div
                key={a}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                    {STALWART_DISPLAY_LABEL[a]}
                  </span>
                  <Badge tone={STALWART_DISPLAY_TONE[a]}>{t.count}</Badge>
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                  Σ weight {t.totalWeight.toFixed(2)}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {t.topSymbols.length === 0 ? (
                    <span className="text-[11px] text-[var(--color-muted)]">—</span>
                  ) : (
                    t.topSymbols.map((s) => (
                      <Link
                        key={s.symbol}
                        href={`/p/${portfolioId}/symbol/${s.symbol}`}
                        className="rounded border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-[11px] font-medium hover:bg-[var(--color-accent-soft)]"
                      >
                        {s.symbol}
                      </Link>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-[10px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Final synthesis
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {STALWART_DISPLAY_ACTIONS.map((da) => {
            const count = finalDisplayCounts[da];
            return (
              <div
                key={da}
                className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                    {STALWART_DISPLAY_LABEL[da]}
                  </span>
                  <Badge tone={STALWART_DISPLAY_TONE[da]}>{count}</Badge>
                </div>
                <div className="mt-1 text-[11px] text-[var(--color-muted)]">Cross-framework</div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* B. Compounder framework summary */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Compounder framework
          </h3>
          <Link
            href={`/p/${portfolioId}/decisions/compounder`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
          >
            View detail <ChevronRight size={12} />
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(['7-9x candidate', 'solid compounder', 'mediocre', 'broken'] as const).map((c) => (
            <div
              key={c}
              className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                  {c}
                </span>
                <Badge tone={CLASS_TONE[c]}>{compDist.counts[c]}</Badge>
              </div>
              <div className="mt-1 text-[11px] text-[var(--color-muted)]">
                {compDist.total > 0 ? fmtPct(compDist.fractions[c], 0) : '—'} of book
              </div>
            </div>
          ))}
        </div>
        {compDist.total > 0 ? (
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-card-hover)]">
            {(['7-9x candidate', 'solid compounder', 'mediocre', 'broken'] as const).map((c) =>
              compDist.fractions[c] > 0 ? (
                <div
                  key={c}
                  title={`${c}: ${fmtPct(compDist.fractions[c], 0)}`}
                  style={{
                    width: `${(compDist.fractions[c] * 100).toFixed(2)}%`,
                    backgroundColor: CLASS_BAR_COLOR[c],
                  }}
                />
              ) : null,
            )}
          </div>
        ) : null}
        {compDist.topCandidates.length > 0 ? (
          <div className="mt-4">
            <div className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Top 7-9× candidates
            </div>
            <div className="flex flex-col gap-1.5">
              {compDist.topCandidates.map((c) => (
                <Link
                  key={c.symbol}
                  href={`/p/${portfolioId}/symbol/${c.symbol}`}
                  className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-1.5 text-sm hover:bg-[var(--color-accent-soft)]"
                >
                  <span className="font-medium">{c.symbol}</span>
                  <span className="text-xs text-[var(--color-muted)]">
                    {c.tenYearMultiple.toFixed(1)}× in 10y · score{' '}
                    {(c.weightedScore * 100).toFixed(0)}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        ) : null}
      </Card>

      {/* C. Target-CAGR snapshot */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Target CAGR · {targetCagrPct}% / {horizonYears}y
            {cagrComputedLive ? (
              <span className="ml-2 text-[10px] font-normal text-[var(--color-muted)]">
                (computed live)
              </span>
            ) : null}
          </h3>
          <Link
            href={`/p/${portfolioId}/decisions/target-cagr`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
          >
            View full plan <ChevronRight size={12} />
          </Link>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Current forecast
            </div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">
              {cagrCurrentForecast === null ? '—' : fmtPct(cagrCurrentForecast)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)]">vs target {targetCagrPct}%</div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              If recommended actions taken
            </div>
            <div className="mt-0.5 text-2xl font-semibold tabular-nums">
              {cagrProposedForecast === null ? '—' : fmtPct(cagrProposedForecast)}
            </div>
            <div className="text-[11px] text-[var(--color-muted)]">
              {cagrAlpha === null ? '—' : `Δ ${fmtPct(cagrAlpha, 2)} alpha`}
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Top impact actions
            </div>
            <div className="mt-1 flex flex-col gap-1">
              {topImpactActions.length === 0 ? (
                <span className="text-[11px] text-[var(--color-muted)]">No actions queued.</span>
              ) : (
                topImpactActions.map((a) => {
                  const label =
                    a.kind === 'replace'
                      ? `Replace ${a.symbol} → ${a.replacementSymbol ?? '?'}`
                      : a.kind === 'add'
                        ? `Add to ${a.symbol}`
                        : `Fresh buy ${a.symbol}`;
                  return (
                    <Link
                      key={`${a.kind}-${a.symbol}`}
                      href={`/p/${portfolioId}/symbol/${a.symbol}`}
                      className="flex items-center justify-between text-[11px] hover:underline"
                    >
                      <span className="truncate">{label}</span>
                      <span className="ml-2 text-[var(--color-muted)] tabular-nums">
                        {fmtInr(a.deltaInr)}
                      </span>
                    </Link>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* D. Mixed-signal conflicts */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Mixed signals
          </h3>
          <span className="text-xs text-[var(--color-muted)]">
            {conflicts.length} of {Math.max(1, decisionsLite.length)} symbols disagree
          </span>
        </div>
        {conflicts.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            All three frameworks agree across your portfolio. Nothing to flag right now.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-[var(--color-border)]">
            {conflicts.map((c) => (
              <li key={`${c.symbol}-${c.kind}`} className="flex items-start justify-between py-2">
                <div className="flex-1 pr-3">
                  <Link
                    href={`/p/${portfolioId}/symbol/${c.symbol}`}
                    className="text-sm font-medium hover:underline"
                  >
                    {c.symbol}
                  </Link>
                  <p className="mt-0.5 text-xs text-[var(--color-muted)]">{c.explanation}</p>
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-1">
                  {c.ruleAction ? (
                    <Badge tone={ACTION_TONE[c.ruleAction]}>
                      rule: {ACTION_LABEL[c.ruleAction].toLowerCase()}
                    </Badge>
                  ) : null}
                  {c.compounderClass ? (
                    <Badge tone={CLASS_TONE[c.compounderClass]}>
                      compounder: {c.compounderClass}
                    </Badge>
                  ) : null}
                  {c.cagrKind ? <Badge tone="info">cagr: {c.cagrKind}</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* E. Style mixer + library version */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Rule library &amp; style
          </h3>
          <div className="flex items-center gap-2">
            <Link
              href={`/p/${portfolioId}/style-mixer`}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
            >
              <Sparkle size={12} /> Adjust style
            </Link>
            <Link
              href={`/p/${portfolioId}/decisions`}
              className="inline-flex items-center gap-1 text-xs text-[var(--color-muted)] hover:underline"
            >
              <Refresh size={12} /> Re-score (top of page)
            </Link>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Rule library
            </div>
            <div className="mt-0.5 text-lg font-semibold">v{lib?.version ?? '—'}</div>
            <div className="text-[11px] text-[var(--color-muted)]">
              {lib?.rules.length ?? 0} rules · {investorsBacking.size} investors
            </div>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2 sm:col-span-2">
            <div className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
              Top-3 style weights
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {topStyle.length === 0 ? (
                <span className="text-[11px] text-[var(--color-muted)]">
                  No style override — using uniform weights across all investors.
                </span>
              ) : (
                topStyle.map((s) => (
                  <div key={s.investor} className="flex items-center gap-2">
                    <span className="w-24 truncate text-xs font-medium capitalize">
                      {s.investor}
                    </span>
                    <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-card)]">
                      <div
                        style={{
                          width: `${(s.weight * 100).toFixed(1)}%`,
                          backgroundColor: 'var(--color-accent)',
                        }}
                      />
                    </div>
                    <span className="w-12 text-right text-[11px] text-[var(--color-muted)] tabular-nums">
                      {fmtPct(s.weight, 0)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* F. Research signals (thesis health, drift, filings) */}
      <ResearchSignalsCard
        portfolioId={portfolioId}
        signals={researchSignals}
        filingsToReadCount={filingsToReadCount}
      />

      {/* G. Recent decisions audit */}
      <Card>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
            Recent decisions
          </h3>
          <Link
            href={`/p/${portfolioId}/decisions/audit`}
            className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
          >
            <TrendingUp size={12} /> View full audit
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            No snapshots yet. Click <span className="font-medium">Re-score</span> at the top of this
            page to create the first one.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col divide-y divide-[var(--color-border)]">
            {recent.map((s) => (
              <li
                key={s.snapshotAt}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium tabular-nums">{fmtTs(s.snapshotAt)}</span>
                  <Badge tone="neutral">v{s.ruleLibraryVersion}</Badge>
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  {s.n} symbol{s.n === 1 ? '' : 's'} scored
                  {s.changedFromPrior !== null
                    ? ` · ${s.changedFromPrior} changed action vs prior`
                    : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const VERDICT_TONE: Record<
  'intact' | 'watch' | 'weakened' | 'broken' | 'untested',
  'pos' | 'info' | 'warning' | 'neg' | 'neutral'
> = {
  intact: 'pos',
  watch: 'info',
  weakened: 'warning',
  broken: 'neg',
  untested: 'neutral',
};

const VERDICT_BAR_COLOR: Record<'intact' | 'watch' | 'weakened' | 'broken' | 'untested', string> = {
  intact: 'var(--color-pos)',
  watch: 'var(--color-accent)',
  weakened: '#d97706',
  broken: 'var(--color-neg)',
  untested: 'var(--color-border)',
};

function ResearchSignalsCard({
  portfolioId,
  signals,
  filingsToReadCount,
}: {
  portfolioId: string;
  signals: import('@/lib/research/signals').ResearchSignalsSummary;
  filingsToReadCount: number;
}) {
  const { distribution, concerningTheses, guidanceMissWatch } = signals;
  const order: Array<keyof typeof VERDICT_TONE> = [
    'intact',
    'watch',
    'weakened',
    'broken',
    'untested',
  ];

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-wide text-[var(--color-fg)] uppercase">
          Research signals
        </h3>
        <span className="text-xs text-[var(--color-muted)]">
          {distribution.total} symbol{distribution.total === 1 ? '' : 's'} tracked
        </span>
      </div>

      {/* Thesis health distribution */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {order.map((bucket) => (
          <div
            key={bucket}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
                {bucket === 'untested' ? 'Not tested' : bucket}
              </span>
              <Badge tone={VERDICT_TONE[bucket]}>{distribution[bucket]}</Badge>
            </div>
          </div>
        ))}
      </div>
      {distribution.total > 0 ? (
        <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[var(--color-card-hover)]">
          {order.map((bucket) =>
            distribution[bucket] > 0 ? (
              <div
                key={bucket}
                title={`${bucket}: ${distribution[bucket]}`}
                style={{
                  width: `${((distribution[bucket] / distribution.total) * 100).toFixed(2)}%`,
                  backgroundColor: VERDICT_BAR_COLOR[bucket],
                }}
              />
            ) : null,
          )}
        </div>
      ) : null}

      {/* Top concerning theses */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Concerning theses
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">weakened or broken · top 5</span>
        </div>
        {concerningTheses.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            No weakened or broken theses. Run <code>/thesis-stress-test</code> on holdings without a
            verdict to expand coverage.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {concerningTheses.slice(0, 5).map((c) => (
              <li key={c.symbol} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/p/${portfolioId}/symbol/${c.symbol}`}
                    className="font-medium hover:underline"
                  >
                    {c.symbol}
                  </Link>
                  <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">{c.rationale}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge tone={VERDICT_TONE[c.verdict]}>{c.verdict}</Badge>
                  <span className="tnum text-[10px] text-[var(--color-muted)]">
                    {c.lastReviewed}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Guidance miss watch */}
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Guidance miss watch
          </span>
          <span className="text-[11px] text-[var(--color-muted)]">
            ≥2 partial/missed quarters · top 5
          </span>
        </div>
        {guidanceMissWatch.length === 0 ? (
          <p className="text-xs text-[var(--color-muted)]">
            No symbols with repeated guidance misses. Run <code>/management-accountability</code>{' '}
            after digesting more concalls to populate this.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {guidanceMissWatch.slice(0, 5).map((m) => (
              <li key={m.symbol} className="flex items-start justify-between gap-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/p/${portfolioId}/symbol/${m.symbol}`}
                    className="font-medium hover:underline"
                  >
                    {m.symbol}
                  </Link>
                  {m.topDriftSignal ? (
                    <p className="mt-0.5 truncate text-xs text-[var(--color-muted)]">
                      {m.topDriftSignal}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <span className="text-[11px] tabular-nums">
                    {m.delivered} of {m.totalScored} delivered
                  </span>
                  <span className="text-[10px] text-[var(--color-muted)] tabular-nums">
                    consistency {(m.consistencyScore * 100).toFixed(0)}%
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Filings to read */}
      <div className="mt-5 flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-2.5">
        <div>
          <div className="text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Filings to read
          </div>
          <div className="mt-0.5 text-sm">
            {filingsToReadCount === 0
              ? 'No filings flagged for immediate read.'
              : `${filingsToReadCount} filing${filingsToReadCount === 1 ? '' : 's'} flagged for immediate read`}
          </div>
        </div>
        <Link
          href={`/p/${portfolioId}/filings?f=read_now`}
          className="inline-flex items-center gap-1 text-xs text-[var(--color-accent)] hover:underline"
        >
          Open filings inbox <ChevronRight size={12} />
        </Link>
      </div>
    </Card>
  );
}
