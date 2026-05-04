/**
 * Target CAGR portfolio plan generator.
 *
 * Given the user's current open positions (with per-symbol forecasted CAGR),
 * a watchlist, and a list of universe-screened candidates, produce an
 * informational action plan that nudges the portfolio toward the target CAGR.
 *
 * No external calls — pure functions.
 */

import type { ScreenedCandidate, MarketCapBucket } from '@/lib/cagr/universeScreener';

export type CagrHolding = {
  symbol: string;
  marketValue: number; // ₹
  forecastedCagr: number; // 0..1
  sector: string;
  marketCapBucket: MarketCapBucket;
  /**
   * Optional Compounder Thesis Framework classification. When present, takes
   * precedence over the forecast-vs-target classifier:
   *   - '7-9x candidate' (and not already the largest position) → 'add'
   *   - 'broken' → 'replace' regardless of forecast
   *   - other classes fall through to forecast-based logic.
   */
  compounderClassification?: '7-9x candidate' | 'solid compounder' | 'mediocre' | 'broken';
};

export type CagrAction =
  | {
      kind: 'add' | 'keep' | 'trim_partial';
      symbol: string;
      replacementSymbol?: undefined;
      rationale: string;
      currentWeightPct: number;
      targetWeightPct: number;
      deltaInr: number;
      forecastedCagr: number;
      thesisMd?: string;
    }
  | {
      kind: 'replace';
      symbol: string;
      replacementSymbol: string;
      rationale: string;
      currentWeightPct: number;
      targetWeightPct: number;
      deltaInr: number;
      forecastedCagr: number;
      thesisMd: string;
    }
  | {
      kind: 'fresh_buy';
      symbol: string;
      replacementSymbol?: undefined;
      rationale: string;
      currentWeightPct?: undefined;
      targetWeightPct: number;
      deltaInr: number;
      forecastedCagr: number;
      thesisMd: string;
    };

export type CagrGap = {
  dimension: 'sector' | 'mcap';
  key: string;
  currentPct: number; // 0..1
  targetPct: number; // 0..1
  suggestedSymbols: string[];
};

export type WatchlistEvaluation = {
  symbol: string;
  thesis: string | null;
  conviction: 'high' | 'medium' | 'low' | null;
  targetBuyPrice: number | null;
  targetSellPrice: number | null;
  forecastedCagr: number;
  sector: string;
  marketCapBucket: MarketCapBucket;
  candidateMatch: ScreenedCandidate | null;
};

export type CagrPlan = {
  targetCagrPct: number;
  horizonYears: number;
  currentPortfolioForecastCagr: number;
  proposedPortfolioForecastCagr: number;
  alphaUplift: number;
  actions: CagrAction[];
  gaps: CagrGap[];
  unaccountedRiskNotes: string[];
  /** Per-watchlist-symbol evaluation surfaced for the UI. */
  watchlistEvaluations: WatchlistEvaluation[];
};

export type BuildPlanInput = {
  holdings: CagrHolding[];
  watchlist: WatchlistEvaluation[];
  candidates: ScreenedCandidate[];
  targetCagrPct: number;
  horizonYears: number;
  /** Used when there are no holdings to anchor weights against. */
  assumedCapitalInr?: number;
};

// "Ideal" 20-25% CAGR template — mid+smallcap-tilted, defence/IT/healthcare/
// chemicals heavy, financials moderate, consumer staples low. Sector keys
// chosen to match `data/codex/backtests/universe.csv` sector strings.
const TEMPLATE_SECTOR: Record<string, number> = {
  'Information Technology': 0.18,
  Healthcare: 0.16,
  'Capital Goods': 0.13,
  Chemicals: 0.1,
  'Financial Services': 0.14,
  'Consumer Durables': 0.08,
  Automobile: 0.07,
  'Fast Moving Consumer Goods': 0.04,
  'Construction Materials': 0.04,
  'Oil Gas & Consumable Fuels': 0.02,
  Power: 0.02,
  Realty: 0.01,
  Telecommunication: 0.01,
};

const TEMPLATE_MCAP: Record<MarketCapBucket, number> = {
  largecap: 0.35,
  midcap: 0.4,
  smallcap: 0.2,
  unknown: 0.05,
};

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return part / whole;
}

function aggregateBy<T>(
  arr: T[],
  keyFn: (x: T) => string,
  valFn: (x: T) => number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) {
    const k = keyFn(x);
    out[k] = (out[k] ?? 0) + valFn(x);
  }
  return out;
}

function classify(
  forecastedCagr: number,
  targetFrac: number,
  currentWeightPct: number,
  maxAddWeight: number,
  compounderClass?: CagrHolding['compounderClassification'],
  isLargestPosition = false,
): 'add' | 'keep' | 'trim_partial' | 'replace' {
  // Compounder Thesis Framework overrides — applied first so they short-circuit
  // forecast-only logic. See lib/compounder/score.ts for classification math.
  if (compounderClass === 'broken') return 'replace';
  if (
    compounderClass === '7-9x candidate' &&
    !isLargestPosition &&
    currentWeightPct < maxAddWeight
  ) {
    return 'add';
  }
  if (forecastedCagr < targetFrac * 0.7) return 'replace';
  if (forecastedCagr < targetFrac * 0.95) return 'trim_partial';
  if (forecastedCagr >= targetFrac * 1.1 && currentWeightPct < maxAddWeight) return 'add';
  return 'keep';
}

function pickReplacement(
  hold: CagrHolding,
  candidates: ScreenedCandidate[],
  used: Set<string>,
  targetFrac: number,
): ScreenedCandidate | null {
  // Prefer same-sector candidates with higher forecast CAGR; fallback to any
  // candidate with forecast >= target × 1.05.
  const sameSector = candidates
    .filter(
      (c) =>
        !used.has(c.symbol) &&
        c.sector === hold.sector &&
        c.forecastedCagr > hold.forecastedCagr &&
        c.forecastedCagr >= targetFrac * 0.95,
    )
    .sort((a, b) => b.forecastedCagr - a.forecastedCagr);
  if (sameSector.length > 0) return sameSector[0]!;
  const any = candidates
    .filter(
      (c) =>
        !used.has(c.symbol) &&
        c.forecastedCagr >= targetFrac * 1.05 &&
        c.forecastedCagr > hold.forecastedCagr,
    )
    .sort((a, b) => b.forecastedCagr - a.forecastedCagr);
  return any[0] ?? null;
}

export function buildCagrPlan(input: BuildPlanInput): CagrPlan {
  const {
    holdings,
    watchlist,
    candidates,
    targetCagrPct,
    horizonYears,
    assumedCapitalInr = 1_000_000,
  } = input;
  const targetFrac = targetCagrPct / 100;

  const totalMv = holdings.reduce((s, h) => s + h.marketValue, 0);
  const capital = totalMv > 0 ? totalMv : assumedCapitalInr;

  // ----- Current forecast CAGR -----
  const currentForecast =
    totalMv > 0
      ? holdings.reduce((s, h) => s + (h.marketValue / totalMv) * h.forecastedCagr, 0)
      : 0;

  // ----- Per-holding actions -----
  const usedReplacements = new Set<string>();
  const actions: CagrAction[] = [];
  const newWeights = new Map<string, { mv: number; cagr: number }>();

  // Allow `add` only when the holding is below the natural cap of 1/n positions
  // (so a 4-name portfolio at 25% each still qualifies for `add`).
  const naturalMaxAdd = holdings.length > 0 ? Math.max(0.08, (1 / holdings.length) * 1.5) : 0.08;

  // Identify the largest position by market value — used to gate the
  // compounder-driven 'add' override (we don't want to keep doubling down on
  // an already-dominant name).
  const largestSymbol = holdings.reduce<string | null>((acc, h) => {
    if (acc === null) return h.symbol;
    const accMv = holdings.find((x) => x.symbol === acc)?.marketValue ?? 0;
    return h.marketValue > accMv ? h.symbol : acc;
  }, null);

  for (const h of holdings) {
    const w = pct(h.marketValue, totalMv);
    const kind = classify(
      h.forecastedCagr,
      targetFrac,
      w,
      naturalMaxAdd,
      h.compounderClassification,
      h.symbol === largestSymbol,
    );

    if (kind === 'keep') {
      actions.push({
        kind: 'keep',
        symbol: h.symbol,
        rationale: `Forecast ${(h.forecastedCagr * 100).toFixed(0)}% ≥ target ${targetCagrPct}%. Hold position.`,
        currentWeightPct: Number((w * 100).toFixed(2)),
        targetWeightPct: Number((w * 100).toFixed(2)),
        deltaInr: 0,
        forecastedCagr: h.forecastedCagr,
      });
      newWeights.set(h.symbol, { mv: h.marketValue, cagr: h.forecastedCagr });
      continue;
    }

    if (kind === 'add') {
      // Add up to 8% target weight (or +50% of current, whichever is greater).
      const target = Math.max(0.08, w * 1.5);
      const targetMv = capital * target;
      const delta = Math.max(0, targetMv - h.marketValue);
      actions.push({
        kind: 'add',
        symbol: h.symbol,
        rationale: `High-conviction compounder forecasting ${(h.forecastedCagr * 100).toFixed(0)}% — bring weight toward ${(target * 100).toFixed(0)}%.`,
        currentWeightPct: Number((w * 100).toFixed(2)),
        targetWeightPct: Number((target * 100).toFixed(2)),
        deltaInr: Math.round(delta),
        forecastedCagr: h.forecastedCagr,
      });
      newWeights.set(h.symbol, { mv: h.marketValue + delta, cagr: h.forecastedCagr });
      continue;
    }

    if (kind === 'trim_partial') {
      // Trim 35% of position; freed capital flagged for redeploy via gaps.
      const trimFrac = 0.35;
      const target = w * (1 - trimFrac);
      const delta = -h.marketValue * trimFrac;
      actions.push({
        kind: 'trim_partial',
        symbol: h.symbol,
        rationale: `Forecast ${(h.forecastedCagr * 100).toFixed(0)}% lags target — trim ~35%, redeploy into higher-CAGR names.`,
        currentWeightPct: Number((w * 100).toFixed(2)),
        targetWeightPct: Number((target * 100).toFixed(2)),
        deltaInr: Math.round(delta),
        forecastedCagr: h.forecastedCagr,
      });
      newWeights.set(h.symbol, {
        mv: h.marketValue * (1 - trimFrac),
        cagr: h.forecastedCagr,
      });
      continue;
    }

    // kind === 'replace'
    const repl = pickReplacement(h, candidates, usedReplacements, targetFrac);
    if (repl) usedReplacements.add(repl.symbol);
    actions.push({
      kind: 'replace',
      symbol: h.symbol,
      replacementSymbol: repl?.symbol ?? '(no candidate found)',
      rationale: repl
        ? `Forecast ${(h.forecastedCagr * 100).toFixed(0)}% < ${(targetFrac * 70).toFixed(0)}% — exit and redeploy into ${repl.symbol} (forecast ${(repl.forecastedCagr * 100).toFixed(0)}%).`
        : `Forecast ${(h.forecastedCagr * 100).toFixed(0)}% well below target — exit; no same-sector candidate found, redeploy via gap candidates below.`,
      currentWeightPct: Number((w * 100).toFixed(2)),
      targetWeightPct: Number((w * 100).toFixed(2)),
      deltaInr: -Math.round(h.marketValue),
      forecastedCagr: h.forecastedCagr,
      thesisMd: repl?.thesisMd ?? '',
    });
    if (repl) {
      newWeights.set(repl.symbol, { mv: h.marketValue, cagr: repl.forecastedCagr });
    }
  }

  // ----- Fresh-buy from watchlist (always — these are the user's tracked ideas) -----
  // Each watchlisted symbol becomes a fresh_buy action sized to a sensible
  // starter weight (5% target, scaled down if many watchlist names exist).
  // This makes the planner explicitly act on the user's own watchlist rather
  // than only suggesting screener picks.
  const heldSymbols = new Set(holdings.map((h) => h.symbol));
  const watchlistFresh = watchlist.filter((w) => !heldSymbols.has(w.symbol));
  if (watchlistFresh.length > 0) {
    const starterWeight = Math.min(0.05, 0.4 / watchlistFresh.length);
    for (const w of watchlistFresh) {
      const each = capital * starterWeight;
      const fwks =
        w.candidateMatch?.frameworkSupport.map((f) => f.framework).join('+') ?? 'watchlist';
      const verdict =
        w.forecastedCagr >= targetFrac * 0.95
          ? `meets target (forecast ${(w.forecastedCagr * 100).toFixed(0)}%)`
          : w.forecastedCagr >= targetFrac * 0.7
            ? `near target (forecast ${(w.forecastedCagr * 100).toFixed(0)}% — partial position)`
            : `lags target (forecast ${(w.forecastedCagr * 100).toFixed(0)}% — small starter only)`;
      const rationale = `${verdict}. Tracked via ${fwks}.${w.conviction ? ` Conviction: ${w.conviction}.` : ''}`;
      const thesisMd =
        (w.thesis ?? '') + (w.candidateMatch?.thesisMd ? `\n\n${w.candidateMatch.thesisMd}` : '');
      actions.push({
        kind: 'fresh_buy',
        symbol: w.symbol,
        rationale,
        targetWeightPct: Number((starterWeight * 100).toFixed(2)),
        deltaInr: Math.round(each),
        forecastedCagr: w.forecastedCagr,
        thesisMd: thesisMd.trim() || `Watchlisted ${w.symbol}; no detailed thesis on file.`,
      });
      newWeights.set(w.symbol, { mv: each, cagr: w.forecastedCagr });
    }
  }

  // ----- Fresh-buy from candidates if portfolio empty (and we have no watchlist starters) -----
  if (holdings.length === 0 && watchlistFresh.length === 0) {
    const top = candidates.slice(0, 8);
    const each = capital / Math.max(1, top.length);
    for (const c of top) {
      actions.push({
        kind: 'fresh_buy',
        symbol: c.symbol,
        rationale: `Fresh buy candidate — forecast ${(c.forecastedCagr * 100).toFixed(0)}% via ${c.frameworkSupport.map((f) => f.framework).join('+') || 'screener'}.`,
        targetWeightPct: Number(((each / capital) * 100).toFixed(2)),
        deltaInr: Math.round(each),
        forecastedCagr: c.forecastedCagr,
        thesisMd: c.thesisMd,
      });
      newWeights.set(c.symbol, { mv: each, cagr: c.forecastedCagr });
    }
  }

  // ----- Proposed forecast CAGR -----
  let proposedForecast = 0;
  let proposedTotal = 0;
  for (const v of newWeights.values()) {
    proposedTotal += v.mv;
  }
  if (proposedTotal > 0) {
    for (const v of newWeights.values()) {
      proposedForecast += (v.mv / proposedTotal) * v.cagr;
    }
  }

  // ----- Sector / mcap gaps -----
  const sectorMv = aggregateBy(
    holdings,
    (h) => h.sector,
    (h) => h.marketValue,
  );
  const mcapMv = aggregateBy(
    holdings,
    (h) => h.marketCapBucket,
    (h) => h.marketValue,
  );

  const gaps: CagrGap[] = [];
  const allSectorKeys = new Set<string>([
    ...Object.keys(sectorMv),
    ...Object.keys(TEMPLATE_SECTOR),
  ]);
  for (const sector of allSectorKeys) {
    const cur = pct(sectorMv[sector] ?? 0, totalMv);
    const tgt = TEMPLATE_SECTOR[sector] ?? 0;
    if (Math.abs(cur - tgt) < 0.03) continue;
    const suggestions = candidates
      .filter((c) => c.sector === sector)
      .slice(0, 3)
      .map((c) => c.symbol);
    gaps.push({
      dimension: 'sector',
      key: sector,
      currentPct: Number(cur.toFixed(4)),
      targetPct: Number(tgt.toFixed(4)),
      suggestedSymbols: suggestions,
    });
  }
  for (const bucket of ['largecap', 'midcap', 'smallcap'] as MarketCapBucket[]) {
    const cur = pct(mcapMv[bucket] ?? 0, totalMv);
    const tgt = TEMPLATE_MCAP[bucket] ?? 0;
    if (Math.abs(cur - tgt) < 0.05) continue;
    gaps.push({
      dimension: 'mcap',
      key: bucket,
      currentPct: Number(cur.toFixed(4)),
      targetPct: Number(tgt.toFixed(4)),
      suggestedSymbols: candidates
        .filter((c) => c.marketCapBucket === bucket)
        .slice(0, 3)
        .map((c) => c.symbol),
    });
  }
  // Keep gaps sorted by absolute under/over-weight magnitude.
  gaps.sort((a, b) => Math.abs(b.currentPct - b.targetPct) - Math.abs(a.currentPct - a.targetPct));

  // ----- Risk callouts -----
  const risks: string[] = [];
  if (totalMv > 0) {
    for (const h of holdings) {
      const w = h.marketValue / totalMv;
      if (w > 0.1) {
        risks.push(
          `${h.symbol}: single-name concentration ${(w * 100).toFixed(0)}% > 10% guard rail.`,
        );
      }
    }
    // Sector concentration.
    for (const [sector, mv] of Object.entries(sectorMv)) {
      const w = mv / totalMv;
      if (w > 0.4) {
        risks.push(`Sector concentration: ${sector} at ${(w * 100).toFixed(0)}% > 40%.`);
      }
    }
  }
  if (currentForecast < targetFrac && totalMv > 0) {
    risks.push(
      `Current forecast CAGR ${(currentForecast * 100).toFixed(1)}% trails ${targetCagrPct}% target — actions above tighten gap to ${(proposedForecast * 100).toFixed(1)}%.`,
    );
  }

  return {
    targetCagrPct,
    horizonYears,
    currentPortfolioForecastCagr: Number(currentForecast.toFixed(4)),
    proposedPortfolioForecastCagr: Number(proposedForecast.toFixed(4)),
    alphaUplift: Number((proposedForecast - currentForecast).toFixed(4)),
    actions,
    gaps,
    unaccountedRiskNotes: risks,
    watchlistEvaluations: watchlist,
  };
}
