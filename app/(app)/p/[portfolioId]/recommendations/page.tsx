import Link from 'next/link';

import { getSession } from '@/lib/auth/session';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { db } from '@/lib/db/client';
import { latestDecisionsByPortfolio } from '@/lib/db/queries/decisions';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { latestCagrPlan } from '@/lib/db/queries/cagrPlans';
import { runCagrPlan } from '@/lib/cagr/run';
import { screenUniverse, type ScreenedCandidate } from '@/lib/cagr/universeScreener';
import type { CagrAction } from '@/lib/cagr/portfolioPlan';
import { Card } from '@/components/ui/Card';
import { Sparkle, TrendingUp } from '@/components/ui/Icons';
import { forecastGrowth, loadFundamentals } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { getSector } from '@/lib/sectors/map';
import { buildValuationContext } from '@/lib/valuation/peStats';
import { getSectorMedian } from '@/lib/valuation/sectorPe';
import { loadLatestThesisStressTest } from '@/lib/research/loadOutputs';
import {
  synthesize,
  valuationScore,
  type StalwartAction,
  type CompounderClassification as FinalCompounderClass,
  type CagrPlannerAction,
  type ThesisVerdict as FinalThesisVerdict,
} from '@/lib/synthesis/finalRecommendation';

import { RescoreButton } from '../decisions/RescoreButton';
import SummaryDashboard from '../decisions/SummaryDashboard';
import {
  DecisionsTable,
  type ActionKey,
  type CompounderClass,
  type DecisionTableRow,
  type ThesisVerdict,
  type CagrKind,
} from '../decisions/DecisionsTable';

type Props = { params: Promise<{ portfolioId: string }> };

type Vote = {
  ruleId: string;
  action: string;
  weight: number;
  baseWeight?: number;
  styleScale?: number;
  tags?: string[];
  why?: string[];
};
type Inputs = {
  netQty?: number;
  currentPrice?: number;
  high52w?: number;
  low52w?: number;
  monthsHeld?: number;
};
type Payload = { votes?: Vote[]; perAction?: Record<string, number>; inputs?: Inputs };

export default async function RecommendationsPage({ params }: Props) {
  const { portfolioId } = await params;
  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';
  const lib = loadLatestRuleLibrary();
  const decisions = latestDecisionsByPortfolio(db, portfolioId);

  const holdings = computeHoldings(db, portfolioId).filter((h) => h.netQty > 0);
  const watchlist = listWatchlist(db, portfolioId);
  const watchSet = new Set(watchlist.map((w) => w.symbol));
  const watchBySymbol = new Map(watchlist.map((w) => [w.symbol, w]));
  const holdingsBySymbol = new Map(holdings.map((h) => [h.symbol, h]));

  const prices = getLatestPrices(db, [
    ...new Set([...holdings.map((h) => h.symbol), ...watchlist.map((w) => w.symbol)]),
  ]);

  let totalValue = 0;
  for (const h of holdings) {
    const p = prices.get(h.symbol)?.close;
    if (typeof p === 'number') totalValue += p * h.netQty;
  }

  const persistedPlan = latestCagrPlan(db, portfolioId);
  let cagrActions: CagrAction[] = [];
  if (persistedPlan) {
    const planJson = persistedPlan.planJson as { actions?: CagrAction[] } | null;
    cagrActions = planJson?.actions ?? [];
  } else {
    try {
      const live = runCagrPlan({ db, portfolioId, targetCagrPct: 22, horizonYears: 10 });
      cagrActions = live.plan.actions;
    } catch {
      cagrActions = [];
    }
  }
  const cagrBySymbol = new Map<string, CagrAction>();
  for (const a of cagrActions) cagrBySymbol.set(a.symbol, a);

  // Universe screener candidates — used to populate "Switches by AI" rows.
  let cagrCandidates: ScreenedCandidate[] = [];
  try {
    cagrCandidates = screenUniverse({ targetCagrPct: 22, horizonYears: 10 });
  } catch {
    // universe data not yet available (no universe.csv)
  }
  const candidateBySymbol = new Map(cagrCandidates.map((c) => [c.symbol, c]));

  // Identify switch symbols: replacement targets + top-10 fresh buys from screener.
  const planSymbols = new Set(cagrActions.map((a) => a.symbol));
  const replaceTargets: string[] = [];
  for (const a of cagrActions) {
    if (a.kind === 'replace' && a.replacementSymbol) {
      replaceTargets.push(a.replacementSymbol);
      planSymbols.add(a.replacementSymbol);
    }
  }
  const freshBuyCandidates = cagrCandidates.filter((c) => !planSymbols.has(c.symbol)).slice(0, 10);
  const allSwitchSymbols = new Set([...replaceTargets, ...freshBuyCandidates.map((c) => c.symbol)]);

  const sectorMv = new Map<string, number>();
  let maxMv = 0;
  let largestSymbol: string | null = null;
  for (const h of holdings) {
    const p = prices.get(h.symbol)?.close;
    if (typeof p !== 'number') continue;
    const mv = p * h.netQty;
    const sec = getSector(h.symbol) ?? 'Unknown';
    sectorMv.set(sec, (sectorMv.get(sec) ?? 0) + mv);
    if (mv > maxMv) {
      maxMv = mv;
      largestSymbol = h.symbol;
    }
  }
  const sectorWeightOf = (sym: string): number | null => {
    if (totalValue <= 0) return null;
    const sec = getSector(sym) ?? 'Unknown';
    const mv = sectorMv.get(sec);
    if (typeof mv !== 'number') return null;
    return mv / totalValue;
  };

  const tableRows: DecisionTableRow[] = decisions.map((d) => {
    const payload = (d.payloadJson ?? {}) as Payload;
    const votes = (payload.votes ?? []) as Vote[];
    const fired: FiredRule[] = votes.map((v) => ({
      ruleId: v.ruleId,
      action: v.action as ActionKey,
      weight: v.weight,
      baseWeight: v.baseWeight ?? v.weight,
      styleScale: v.styleScale ?? 1,
      tags: v.tags ?? [],
      why: v.why ?? [],
    }));

    const h = holdingsBySymbol.get(d.symbol);
    const w = watchBySymbol.get(d.symbol);
    const lp = prices.get(d.symbol)?.close;
    const positionPct =
      h && typeof lp === 'number' && totalValue > 0 ? (lp * h.netQty) / totalValue : null;

    const fund = loadFundamentals(d.symbol);
    const growthOut = forecastGrowth({
      symbol: d.symbol,
      fundamentals: fund,
      firedRules: fired,
      currentPrice: lp,
      priceHistory: [],
    });
    const growth = growthOut
      ? {
          yearOne: growthOut.yearOne,
          yearThree: growthOut.yearThree,
          yearFive: growthOut.yearFive,
          confidence: growthOut.confidence,
        }
      : null;

    const recSec = getSector(d.symbol) ?? 'Unknown';
    const recVal = buildValuationContext({
      db,
      symbol: d.symbol,
      fund,
      sectorMedian: getSectorMedian(recSec),
      endDate: new Date().toISOString().slice(0, 10),
    });
    const compounder = computeCompounderProfile({
      symbol: d.symbol,
      sector: recSec,
      fundamentals: fund,
      firedRules: fired,
      valuation: {
        pe: recVal.pe,
        peg: recVal.peg,
        peVsSectorMedian: recVal.peVsSectorMedian,
        peSectorMedian: recVal.peSectorMedian,
        pe5yMedian: recVal.pe5yMedian,
        pe10yPercentile: recVal.pe10yPercentile,
        earningsYieldMinusGsec: recVal.earningsYieldMinusGsec,
      },
    });

    const topRules = [...fired]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((f) => ({ ruleId: f.ruleId, action: f.action as ActionKey, weight: f.weight }));

    const stress = loadLatestThesisStressTest(d.symbol);
    const verdict: ThesisVerdict = stress ? (stress.verdict as ThesisVerdict) : 'untested';

    const cagrAction = cagrBySymbol.get(d.symbol);
    const cagrKind: CagrKind = cagrAction ? cagrAction.kind : null;
    const cagrForecast =
      cagrAction && typeof cagrAction.forecastedCagr === 'number'
        ? cagrAction.forecastedCagr
        : growthOut && growthOut.yearFive > -1
          ? Math.pow(1 + growthOut.yearFive, 1 / 5) - 1
          : null;

    const synthesisVerdict: FinalThesisVerdict | null =
      verdict === 'watch'
        ? 'weakened'
        : verdict === 'untested' ||
            verdict === 'intact' ||
            verdict === 'weakened' ||
            verdict === 'broken'
          ? (verdict as FinalThesisVerdict)
          : null;

    const final = synthesize({
      symbol: d.symbol,
      isHolding: !!h,
      isWatchlist: watchSet.has(d.symbol),
      positionPct,
      sectorWeight: sectorWeightOf(d.symbol),
      totalSymbols: holdings.length,
      isLargestHolding: largestSymbol === d.symbol,
      stalwartAction: d.action as StalwartAction,
      stalwartScore: d.score,
      compounderClass: compounder.classification as FinalCompounderClass,
      compounderWeightedScore: compounder.weightedScore,
      cagrAction: (cagrKind ?? null) as CagrPlannerAction | null,
      cagrForecast,
      thesisVerdict: synthesisVerdict,
      growthYearFive: growthOut?.yearFive ?? null,
      growthConfidence: growthOut?.confidence ?? null,
      valuation: {
        pe: recVal.pe,
        peg: recVal.peg,
        peVsSectorMedian: recVal.peVsSectorMedian,
        peSectorMedian: recVal.peSectorMedian,
        pe5yMedian: recVal.pe5yMedian,
        pe10yPercentile: recVal.pe10yPercentile,
      },
    });

    // Valuation cell: re-use the same `valuationScore` the Final synthesis
    // uses so the column matches the framework vote. Also expose the raw
    // axes (PEG, sector ratio, own 5y/10y) so the user can see *why*.
    const valVote = valuationScore({
      pe: recVal.pe,
      peg: recVal.peg,
      peVsSectorMedian: recVal.peVsSectorMedian,
      peSectorMedian: recVal.peSectorMedian,
      pe5yMedian: recVal.pe5yMedian,
      pe10yPercentile: recVal.pe10yPercentile,
    });
    const valStatus: 'pass' | 'partial' | 'fail' | 'unknown' = !valVote.hasData
      ? 'unknown'
      : valVote.score >= 1
        ? 'pass'
        : valVote.score <= -1
          ? 'fail'
          : 'partial';
    const peVsOwn5yMedian =
      recVal.pe !== null && recVal.pe5yMedian !== null && recVal.pe5yMedian > 0
        ? recVal.pe / recVal.pe5yMedian
        : null;

    return {
      symbol: d.symbol,
      sector: getSector(d.symbol) ?? 'Unknown',
      isHolding: !!h,
      isWatchlist: watchSet.has(d.symbol),
      isCagrSwitch: allSwitchSymbols.has(d.symbol),
      action: d.action as ActionKey,
      score: d.score,
      compounderClass: compounder.classification as CompounderClass,
      compounderScore: compounder.weightedScore,
      compounderTenX: compounder.estimatedTenYearReturn,
      valuation: {
        status: valStatus,
        score: valVote.score,
        pe: recVal.pe,
        peg: recVal.peg,
        peVsSectorMedian: recVal.peVsSectorMedian,
        peSectorMedian: recVal.peSectorMedian,
        peVsOwn5yMedian,
        pe10yPercentile: recVal.pe10yPercentile,
      },
      cagrKind,
      cagrForecast,
      thesisVerdict: verdict,
      growth,
      topRules,
      positionPct,
      targetBuyPrice: w?.targetBuyPrice ?? null,
      finalAction: final.action,
      finalScore: final.weightedScore,
      finalConfidence: final.confidence,
      finalRiskCapped: final.riskOverrides.length > 0,
    };
  });

  // Build stub rows for switch symbols not already in the decisions table.
  const decisionSymbolSet = new Set(decisions.map((d) => d.symbol));
  const switchStubRows: DecisionTableRow[] = [];
  for (const sym of allSwitchSymbols) {
    if (decisionSymbolSet.has(sym)) continue;
    const cand = candidateBySymbol.get(sym);
    if (!cand) continue;

    const fund = loadFundamentals(sym);
    const growthOut = forecastGrowth({ symbol: sym, fundamentals: fund, firedRules: [] });
    const growth = growthOut
      ? {
          yearOne: growthOut.yearOne,
          yearThree: growthOut.yearThree,
          yearFive: growthOut.yearFive,
          confidence: growthOut.confidence,
        }
      : null;

    const swSec = cand.sector || getSector(sym) || 'Unknown';
    const swVal = buildValuationContext({
      db,
      symbol: sym,
      fund,
      sectorMedian: getSectorMedian(swSec),
      endDate: new Date().toISOString().slice(0, 10),
    });
    const swCompounder = computeCompounderProfile({
      symbol: sym,
      sector: swSec,
      fundamentals: fund,
      firedRules: [],
      valuation: {
        pe: swVal.pe,
        peg: swVal.peg,
        peVsSectorMedian: swVal.peVsSectorMedian,
        peSectorMedian: swVal.peSectorMedian,
        pe5yMedian: swVal.pe5yMedian,
        pe10yPercentile: swVal.pe10yPercentile,
        earningsYieldMinusGsec: swVal.earningsYieldMinusGsec,
      },
    });

    const swStress = loadLatestThesisStressTest(sym);
    const swVerdict: ThesisVerdict = swStress ? (swStress.verdict as ThesisVerdict) : 'untested';

    const swCagrKind: CagrKind = replaceTargets.includes(sym) ? 'replace' : 'fresh_buy';

    const swValVote = valuationScore({
      pe: swVal.pe,
      peg: swVal.peg,
      peVsSectorMedian: swVal.peVsSectorMedian,
      peSectorMedian: swVal.peSectorMedian,
      pe5yMedian: swVal.pe5yMedian,
      pe10yPercentile: swVal.pe10yPercentile,
    });
    const swValStatus: 'pass' | 'partial' | 'fail' | 'unknown' = !swValVote.hasData
      ? 'unknown'
      : swValVote.score >= 1
        ? 'pass'
        : swValVote.score <= -1
          ? 'fail'
          : 'partial';
    const swPeVsOwn5y =
      swVal.pe !== null && swVal.pe5yMedian !== null && swVal.pe5yMedian > 0
        ? swVal.pe / swVal.pe5yMedian
        : null;

    const swSynthesisVerdict: FinalThesisVerdict | null =
      swVerdict === 'watch'
        ? 'weakened'
        : swVerdict === 'untested' ||
            swVerdict === 'intact' ||
            swVerdict === 'weakened' ||
            swVerdict === 'broken'
          ? (swVerdict as FinalThesisVerdict)
          : null;

    const swFinal = synthesize({
      symbol: sym,
      isHolding: false,
      isWatchlist: watchSet.has(sym),
      positionPct: null,
      sectorWeight: null,
      totalSymbols: holdings.length,
      isLargestHolding: false,
      stalwartAction: null,
      stalwartScore: 0,
      compounderClass: swCompounder.classification as FinalCompounderClass,
      compounderWeightedScore: swCompounder.weightedScore,
      cagrAction: swCagrKind as CagrPlannerAction,
      cagrForecast: cand.forecastedCagr,
      thesisVerdict: swSynthesisVerdict,
      growthYearFive: growthOut?.yearFive ?? null,
      growthConfidence: growthOut?.confidence ?? null,
      valuation: {
        pe: swVal.pe,
        peg: swVal.peg,
        peVsSectorMedian: swVal.peVsSectorMedian,
        peSectorMedian: swVal.peSectorMedian,
        pe5yMedian: swVal.pe5yMedian,
        pe10yPercentile: swVal.pe10yPercentile,
      },
    });

    switchStubRows.push({
      symbol: sym,
      sector: swSec,
      isHolding: false,
      isWatchlist: watchSet.has(sym),
      isCagrSwitch: true,
      action: 'fresh_buy',
      score: 0,
      compounderClass: swCompounder.classification as CompounderClass,
      compounderScore: swCompounder.weightedScore,
      compounderTenX: swCompounder.estimatedTenYearReturn,
      valuation: {
        status: swValStatus,
        score: swValVote.score,
        pe: swVal.pe,
        peg: swVal.peg,
        peVsSectorMedian: swVal.peVsSectorMedian,
        peSectorMedian: swVal.peSectorMedian,
        peVsOwn5yMedian: swPeVsOwn5y,
        pe10yPercentile: swVal.pe10yPercentile,
      },
      cagrKind: swCagrKind,
      cagrForecast: cand.forecastedCagr,
      thesisVerdict: swVerdict,
      growth,
      topRules: [],
      positionPct: null,
      targetBuyPrice: watchBySymbol.get(sym)?.targetBuyPrice ?? null,
      finalAction: swFinal.action,
      finalScore: swFinal.weightedScore,
      finalConfidence: swFinal.confidence,
      finalRiskCapped: swFinal.riskOverrides.length > 0,
    });
  }

  const allRows = [...tableRows, ...switchStubRows];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Sparkle size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Recommendations</h2>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                {lib ? (
                  <>
                    Rule Library <span className="font-medium">v{lib.version}</span> ·{' '}
                    {lib.rules.length} rules · {decisions.length} symbol
                    {decisions.length === 1 ? '' : 's'} scored
                  </>
                ) : (
                  <>No rule library found. Run the codex pipeline first.</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/p/${portfolioId}/decisions/compounder`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]"
            >
              <Sparkle size={14} />
              Compounder thesis
            </Link>
            <Link
              href={`/p/${portfolioId}/decisions/target-cagr`}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]"
            >
              <TrendingUp size={14} />
              Target CAGR
            </Link>
            <RescoreButton portfolioId={portfolioId} csrfToken={csrfToken} />
          </div>
        </div>
      </Card>

      {decisions.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">
            No recommendations yet. Click <span className="font-medium">Re-score</span> above to
            evaluate your holdings against the rule library.
          </p>
        </Card>
      ) : (
        <>
          <details className="group rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-sm)]">
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-3 text-sm font-medium">
              <span>Cross-framework dashboard</span>
              <span className="text-xs text-[var(--color-muted)] group-open:hidden">
                show 6 framework summaries
              </span>
              <span className="hidden text-xs text-[var(--color-muted)] group-open:inline">
                hide
              </span>
            </summary>
            <div className="border-t border-[var(--color-border)] p-5">
              <SummaryDashboard portfolioId={portfolioId} />
            </div>
          </details>
          <DecisionsTable rows={allRows} portfolioId={portfolioId} />
          <div className="flex flex-wrap gap-3">
            <Link
              href={`/p/${portfolioId}/actions?section=style-mixer`}
              className="text-sm text-[var(--color-accent)] underline"
            >
              Tune style mixer →
            </Link>
            <Link
              href={`/p/${portfolioId}/decisions/audit`}
              className="text-sm text-[var(--color-accent)] underline"
            >
              Audit log →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
