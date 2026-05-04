/**
 * Final Recommendation synthesis layer.
 *
 * Cross-framework synthesis for ONE symbol — fuses the five existing per-stock
 * outputs (Stalwarts fired-rules, Compounder Thesis, Target-CAGR fit,
 * Research/thesis-stress-test, Growth forecast) into a single action:
 *   buy_more · enter_position · sell_partial · sell_full · hold.
 *
 * Risk-management overrides are applied AFTER score-mapping and can ONLY
 * downgrade the action (never upgrade). Caps include single-name and sector
 * concentration, broken-thesis lock, and "research first" gating for new
 * entries with low forecast confidence.
 *
 * ─── Framework weighting rationale ─────────────────────────────────────────
 * Weights are informed by `data/codex/synthesized/consensus.md` which
 * synthesises 63 stalwart profiles into a Convergent Core (§1) and a
 * composite Indian-equity decision framework (§8). The five Convergent Core
 * principles cited by 18+ investors are: management integrity (§1.1), risk
 * as permanent loss (§1.2), patience (§1.3), ROIC > cost-of-capital (§1.4),
 * FCF over earnings (§1.5).
 *
 * Stalwarts (0.30) — highest weight. The fired-rules score directly
 *   surfaces this Convergent Core: rules are weighted by cross-investor
 *   consensus tier (§7), and red-flag rules encode the universal exit
 *   triggers from §1.9 and §6. Citation: §1.1, §1.2, §1.9, §7.
 *
 * Compounder Thesis (0.25) — structural quality + reinvestment math. The
 *   composite framework's Layer 2 (§8) explicitly demands ROCE > 15% and
 *   identifiable moat; Layer 5 (§8) sizes by conviction = quality × runway.
 *   Citation: §1.4, §1.6, §8 Layer 2.
 *
 * Target-CAGR fit (0.20) — the planner's math-driven forward view. Useful
 *   but only as good as the forecast horizon and PEG/PE assumptions
 *   underneath it. Lynch's PEG (§8 Layer 4) gets the largest weight in
 *   that planner; this caps its influence at the synthesis layer.
 *   Citation: §8 Layer 4.
 *
 * Research / thesis stress-test (0.15) — the "execution check": is
 *   management actually delivering on the thesis? §1.1 (management
 *   integrity) and §6 universal red flags both depend on accumulating
 *   evidence over time, which is what thesis-stress-test does.
 *   Citation: §1.1, §6, §8 Layer 6.
 *
 * Growth forecast (0.10) — lowest weight. Noisiest signal: PE-mean-
 *   reversion is by construction speculative, and Lynch's caveat that
 *   "PEG <1 at PE 70 is still dangerous" (§8 Layer 4) warns against
 *   over-relying on growth-multiple math. Useful as a tie-breaker.
 *   Citation: §8 Layer 4 caveat.
 *
 * ─── Action mapping (post-weighted-score) ──────────────────────────────────
 *   score ≥ +1.5 AND held       → buy_more
 *   score ≥ +1.5 AND NOT held   → enter_position
 *   score in (-0.5, +1.5)       → hold
 *   score in (-1.5, -0.5)       → sell_partial
 *   score ≤ -1.5                → sell_full
 *
 * ─── Risk overrides (downgrade-only) ───────────────────────────────────────
 * 1. Single-name concentration > 10% → cap buy_more; > 15% → force sell_partial
 * 2. Sector weight > 35% on enter_position → force hold
 * 3. Thesis broken OR compounder broken → cap at hold (no buy_more / enter)
 * 4. Untested thesis + low forecast confidence + not held → force hold
 * 5. Largest holding (caller flag) → demote buy_more → hold
 * Citation for risk caps: §1.2 (never permanently lose), §1.10 (no leverage),
 * §8 Layer 5 (max 15% single-name), §1.9 (sell on thesis break only).
 */

export type FinalAction = 'buy_more' | 'enter_position' | 'sell_partial' | 'sell_full' | 'hold';

export type FrameworkSource = 'stalwarts' | 'compounder' | 'valuation' | 'forecast' | 'research';

export type FrameworkVote = {
  source: FrameworkSource;
  /** Directional score, -2..+2 (or 0 when no data). */
  score: number;
  /** Weight applied (0..1). 0 when the framework has no data for this symbol. */
  weight: number;
  /** One-line rationale describing the vote. */
  rationale: string;
};

export type RiskOverride = {
  triggered: boolean;
  reason: string;
  /** Forces the action no higher than this. null = no cap effect. */
  cap: FinalAction | null;
};

export type FinalRecommendation = {
  action: FinalAction;
  confidence: 'low' | 'medium' | 'high';
  /** Raw composite score, -2..+2. */
  weightedScore: number;
  votes: FrameworkVote[];
  riskOverrides: RiskOverride[];
  rationaleMd: string;
};

export type StalwartAction = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

export type CompounderClassification =
  | '7-9x candidate'
  | 'solid compounder'
  | 'mediocre'
  | 'broken';

export type CagrPlannerAction = 'add' | 'keep' | 'trim_partial' | 'replace' | 'fresh_buy';

export type ThesisVerdict = 'intact' | 'weakened' | 'broken' | 'untested';

export type SynthesizeInput = {
  symbol: string;
  isHolding: boolean;
  isWatchlist: boolean;
  /** 0..1 fraction of portfolio MV; null when not held. */
  positionPct: number | null;
  /** 0..1 fraction of portfolio MV that the symbol's sector represents. */
  sectorWeight: number | null;
  /** Number of holdings (used for risk math context — currently informational). */
  totalSymbols: number;
  /** Caller flag: is this the largest position by MV? */
  isLargestHolding?: boolean;

  /** Stalwarts (fired-rules) framework. */
  stalwartAction: StalwartAction | null;
  stalwartScore: number | null; // 0..1 confidence

  /** Compounder Thesis. */
  compounderClass: CompounderClassification | null;
  compounderWeightedScore: number | null; // 0..1

  /** Target-CAGR planner output for this symbol. */
  cagrAction: CagrPlannerAction | null;
  /** Forecast 5y CAGR (decimal). */
  cagrForecast: number | null;

  /** Research / thesis stress-test verdict. */
  thesisVerdict: ThesisVerdict | null;

  /** Growth forecast. */
  growthYearFive: number | null; // 5y cumulative
  growthConfidence: 'low' | 'medium' | 'high' | null;

  /**
   * Valuation context — same shape as `lib/valuation/peStats#ValuationContext`.
   * Drives the Valuation framework vote AND a hard PE10y_pctile veto. Pass
   * null for any unavailable axis; the score function degrades gracefully.
   */
  valuation: {
    pe: number | null;
    peg: number | null;
    peVsSectorMedian: number | null;
    peSectorMedian: number | null;
    pe5yMedian: number | null;
    pe10yPercentile: number | null;
  } | null;
};

// ─── Weights ────────────────────────────────────────────────────────────────
// Valuation gets its own seat (was buried inside Compounder + Stalwart gates).
// Target-CAGR planner and Growth forecast are folded into a single "Forecast"
// vote — both are forward-looking and were double-counting the same
// PE-rerating drag. Combined weight 0.20 (was 0.20 + 0.10).
export const FRAMEWORK_WEIGHTS: Record<FrameworkSource, number> = {
  stalwarts: 0.27,
  compounder: 0.22,
  valuation: 0.15,
  forecast: 0.2,
  research: 0.16,
};

// ─── Verdict → directional score (-2..+2) ───────────────────────────────────
const STALWART_SCORE: Record<StalwartAction, number> = {
  fresh_buy: 2,
  add: 2,
  hold: 0,
  trim_25: -1,
  trim_50: -2,
  exit: -2,
};

const COMPOUNDER_SCORE: Record<CompounderClassification, number> = {
  '7-9x candidate': 2,
  'solid compounder': 1,
  mediocre: 0,
  broken: -2,
};

const CAGR_SCORE: Record<CagrPlannerAction, number> = {
  add: 2,
  fresh_buy: 2,
  keep: 0,
  trim_partial: -1,
  replace: -2,
};

const THESIS_SCORE: Record<ThesisVerdict, number> = {
  intact: 1,
  untested: 0,
  weakened: -1,
  broken: -2,
};

/**
 * Map 5y cumulative growth forecast to a directional score.
 * Thresholds use 5y *annualised* CAGR to match the consensus framing
 * (Layer 2 quality bar = 15% ROCE; high-conviction returns 15-25% CAGR).
 *   ann <  5%  → -1
 *   5% ≤ ann < 15% → 0
 *   15% ≤ ann < 25% → +1
 *   ann ≥ 25% → +2
 * Low confidence halves the magnitude (rounded toward 0).
 */
export function growthScore(
  yearFive: number | null,
  confidence: 'low' | 'medium' | 'high' | null,
): number {
  if (yearFive === null || !Number.isFinite(yearFive)) return 0;
  const ann = yearFive > -1 ? Math.pow(1 + yearFive, 1 / 5) - 1 : -0.2;
  let raw: number;
  if (ann < 0.05) raw = -1;
  else if (ann < 0.15) raw = 0;
  else if (ann < 0.25) raw = 1;
  else raw = 2;
  if (confidence === 'low') {
    // Halve magnitude, round toward zero. Coerce -0 → +0 for cleanliness.
    const halved = raw === 0 ? 0 : Math.trunc(raw / 2);
    return halved === 0 ? 0 : halved;
  }
  return raw;
}

function fmtPct(x: number, digits = 0): string {
  return `${x >= 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`;
}

/**
 * Map the valuation context to a directional score (-2..+2).
 *
 * Three independent axes — PEG (Lynch), PE-vs-sector-median, PE-vs-own-history
 * — each vote pass / partial / fail. The aggregate score is the count-weighted
 * blend with two hard rules:
 *
 *   - 10y percentile veto: PE in top 15% of own range → -2 (regardless of
 *     other axes — buying near own all-time highs has crashed too many
 *     "great business" theses, see consensus.md §7.5).
 *   - All-axes-pass with very low PEG (<0.8) → +2 (Lynch's GARP green light).
 *
 * Returns the raw -2..+2 score AND the contributing rationale slice.
 */
export function valuationScore(v: SynthesizeInput['valuation']): {
  score: number;
  rationale: string;
  hasData: boolean;
} {
  if (!v) {
    return { score: 0, rationale: 'No valuation context', hasData: false };
  }
  const reasons: string[] = [];

  // Hard veto: top 15% of own 10y history.
  if (typeof v.pe10yPercentile === 'number' && v.pe10yPercentile >= 0.85) {
    return {
      score: -2,
      rationale: `PE at ${(v.pe10yPercentile * 100).toFixed(0)}th percentile of own 10y history — overdue for mean reversion`,
      hasData: true,
    };
  }

  type Axis = 'pass' | 'partial' | 'fail';
  const axes: { name: string; verdict: Axis; note: string }[] = [];

  // PEG axis.
  if (typeof v.peg === 'number' && Number.isFinite(v.peg)) {
    if (v.peg <= 1.0) {
      axes.push({ name: 'PEG', verdict: 'pass', note: `PEG ${v.peg.toFixed(2)}` });
    } else if (v.peg <= 1.5) {
      axes.push({ name: 'PEG', verdict: 'partial', note: `PEG ${v.peg.toFixed(2)}` });
    } else {
      axes.push({ name: 'PEG', verdict: 'fail', note: `PEG ${v.peg.toFixed(2)}` });
    }
  }

  // Sector axis.
  if (typeof v.peVsSectorMedian === 'number' && Number.isFinite(v.peVsSectorMedian)) {
    const r = v.peVsSectorMedian;
    if (r <= 1.3) {
      axes.push({ name: 'sector', verdict: 'pass', note: `${r.toFixed(2)}× sector median` });
    } else if (r <= 1.7) {
      axes.push({
        name: 'sector',
        verdict: 'partial',
        note: `${r.toFixed(2)}× sector median`,
      });
    } else {
      axes.push({ name: 'sector', verdict: 'fail', note: `${r.toFixed(2)}× sector median` });
    }
  }

  // Own-history axis (prefer 5y median, else 10y percentile mid-range).
  if (
    typeof v.pe === 'number' &&
    typeof v.pe5yMedian === 'number' &&
    v.pe5yMedian > 0 &&
    Number.isFinite(v.pe5yMedian)
  ) {
    const r = v.pe / v.pe5yMedian;
    if (r <= 1.2) {
      axes.push({ name: 'own', verdict: 'pass', note: `${r.toFixed(2)}× own 5y median` });
    } else if (r <= 1.5) {
      axes.push({ name: 'own', verdict: 'partial', note: `${r.toFixed(2)}× own 5y median` });
    } else {
      axes.push({ name: 'own', verdict: 'fail', note: `${r.toFixed(2)}× own 5y median` });
    }
  } else if (typeof v.pe10yPercentile === 'number' && Number.isFinite(v.pe10yPercentile)) {
    const p = v.pe10yPercentile;
    if (p <= 0.5) {
      axes.push({
        name: 'own',
        verdict: 'pass',
        note: `${(p * 100).toFixed(0)}th pctile own 10y`,
      });
    } else if (p <= 0.8) {
      axes.push({
        name: 'own',
        verdict: 'partial',
        note: `${(p * 100).toFixed(0)}th pctile own 10y`,
      });
    } else {
      axes.push({
        name: 'own',
        verdict: 'fail',
        note: `${(p * 100).toFixed(0)}th pctile own 10y`,
      });
    }
  }

  if (axes.length === 0) {
    return { score: 0, rationale: 'No valuation axis had data', hasData: false };
  }

  const passes = axes.filter((a) => a.verdict === 'pass').length;
  const partials = axes.filter((a) => a.verdict === 'partial').length;
  const fails = axes.filter((a) => a.verdict === 'fail').length;

  // Lynch GARP green light: all axes pass AND PEG ≤ 0.8.
  if (passes === axes.length && typeof v.peg === 'number' && v.peg <= 0.8) {
    return {
      score: 2,
      rationale: `All ${axes.length} valuation axes pass · PEG ${v.peg.toFixed(2)} (Lynch GARP)`,
      hasData: true,
    };
  }

  // Average per-axis score (pass=+1, partial=0, fail=-1) → continuous -1..+1
  // → mapped to -2..+2 with thresholds. A single severe fail (PEG > 1.5,
  // sector ratio > 1.7) drags the verdict; a single severe pass + a fail
  // averages to "partial" rather than washing the fail away.
  const axisAvg =
    axes.reduce((s, a) => s + (a.verdict === 'pass' ? 1 : a.verdict === 'fail' ? -1 : 0), 0) /
    axes.length;
  let score: number;
  if (axisAvg >= 0.66) score = 2;
  else if (axisAvg >= 0.33) score = 1;
  else if (axisAvg >= -0.33) score = 0;
  else if (axisAvg >= -0.66) score = -1;
  else score = -2;

  reasons.push(...axes.map((a) => `${a.name}: ${a.verdict} (${a.note})`));
  return { score, rationale: reasons.join(' · '), hasData: true };
}

function buildVotes(input: SynthesizeInput): FrameworkVote[] {
  const out: FrameworkVote[] = [];

  // Stalwarts. A 'hold' winner means the rule library has no positive or
  // negative consensus on this symbol — treated as abstain (weight 0) so it
  // doesn't drag every composite toward zero. Other actions (add/fresh_buy/
  // trim/exit) carry directional conviction and vote at full weight.
  if (input.stalwartAction !== null && input.stalwartAction !== 'hold') {
    out.push({
      source: 'stalwarts',
      score: STALWART_SCORE[input.stalwartAction],
      weight: FRAMEWORK_WEIGHTS.stalwarts,
      rationale:
        input.stalwartScore !== null
          ? `Fired-rules action ${input.stalwartAction.toUpperCase()} · confidence ${input.stalwartScore.toFixed(2)}`
          : `Fired-rules action ${input.stalwartAction.toUpperCase()}`,
    });
  } else if (input.stalwartAction === 'hold') {
    out.push({
      source: 'stalwarts',
      score: 0,
      weight: 0,
      rationale: 'Stalwart action HOLD — no directional signal, abstain',
    });
  } else {
    out.push({
      source: 'stalwarts',
      score: 0,
      weight: 0,
      rationale: 'No fired rules — abstain',
    });
  }

  // Compounder.
  if (input.compounderClass !== null) {
    out.push({
      source: 'compounder',
      score: COMPOUNDER_SCORE[input.compounderClass],
      weight: FRAMEWORK_WEIGHTS.compounder,
      rationale:
        input.compounderWeightedScore !== null
          ? `Classification ${input.compounderClass} · weightedScore ${input.compounderWeightedScore.toFixed(2)}`
          : `Classification ${input.compounderClass}`,
    });
  } else {
    out.push({
      source: 'compounder',
      score: 0,
      weight: 0,
      rationale: 'No compounder profile — abstain',
    });
  }

  // Valuation — its own seat, separate from any quality verdict.
  const val = valuationScore(input.valuation);
  out.push({
    source: 'valuation',
    score: val.score,
    weight: val.hasData ? FRAMEWORK_WEIGHTS.valuation : 0,
    rationale: val.rationale,
  });

  // Forecast — combines the Target-CAGR planner action with the 5y growth
  // forecast. Both signals are forward-looking and largely move together
  // (growth model feeds the CAGR planner). When both are present we average
  // them; when only one is present we use it as-is. Single combined weight
  // 0.20 (was 0.20 + 0.10 separately).
  const haveCagr = input.cagrAction !== null;
  const haveGrowth = input.growthYearFive !== null;
  if (haveCagr || haveGrowth) {
    const cagrPart = haveCagr ? CAGR_SCORE[input.cagrAction!] : null;
    const growthPart = haveGrowth
      ? growthScore(input.growthYearFive!, input.growthConfidence)
      : null;
    let score: number;
    const labels: string[] = [];
    if (cagrPart !== null && growthPart !== null) {
      score = (cagrPart + growthPart) / 2;
      labels.push(`Planner ${input.cagrAction}`);
      labels.push(
        `5y growth ${fmtPct(input.growthYearFive!, 0)} (${input.growthConfidence ?? 'unknown'} conf)`,
      );
    } else if (cagrPart !== null) {
      score = cagrPart;
      const cagrLabel =
        input.cagrForecast !== null ? ` · 5y forecast ${fmtPct(input.cagrForecast, 0)}` : '';
      labels.push(`Planner ${input.cagrAction}${cagrLabel}`);
    } else {
      score = growthPart!;
      labels.push(
        `5y growth ${fmtPct(input.growthYearFive!, 0)} (${input.growthConfidence ?? 'unknown'} conf)`,
      );
    }
    out.push({
      source: 'forecast',
      score,
      weight: FRAMEWORK_WEIGHTS.forecast,
      rationale: labels.join(' · '),
    });
  } else {
    out.push({
      source: 'forecast',
      score: 0,
      weight: 0,
      rationale: 'No forecast inputs — abstain',
    });
  }

  // Research (thesis stress-test).
  if (input.thesisVerdict !== null) {
    out.push({
      source: 'research',
      score: THESIS_SCORE[input.thesisVerdict],
      weight: FRAMEWORK_WEIGHTS.research,
      rationale: `Thesis verdict ${input.thesisVerdict}`,
    });
  } else {
    out.push({
      source: 'research',
      score: 0,
      weight: 0,
      rationale: 'No thesis stress-test — abstain',
    });
  }

  return out;
}

/**
 * Composite weighted score on the same -2..+2 scale as individual votes.
 * When a framework abstains (weight=0), the remaining frameworks are
 * re-normalised so the composite stays comparable across symbols with
 * differing data availability.
 */
function weightedComposite(votes: FrameworkVote[]): number {
  const wsum = votes.reduce((a, v) => a + v.weight, 0);
  if (wsum <= 0) return 0;
  const dot = votes.reduce((a, v) => a + v.score * v.weight, 0);
  return dot / wsum;
}

function mapScoreToAction(score: number, isHolding: boolean): FinalAction {
  if (score >= 1.5) return isHolding ? 'buy_more' : 'enter_position';
  if (score > -0.5) return 'hold';
  if (score > -1.5) return 'sell_partial';
  return 'sell_full';
}

const ACTION_ORDER: FinalAction[] = [
  'sell_full',
  'sell_partial',
  'hold',
  'enter_position',
  'buy_more',
];

function actionRank(a: FinalAction): number {
  return ACTION_ORDER.indexOf(a);
}

/** Apply a cap: action cannot rank higher than `cap`. */
function applyCap(current: FinalAction, cap: FinalAction): FinalAction {
  if (actionRank(current) <= actionRank(cap)) return current;
  return cap;
}

function applyRiskOverrides(
  baseAction: FinalAction,
  input: SynthesizeInput,
): { action: FinalAction; overrides: RiskOverride[] } {
  const overrides: RiskOverride[] = [];
  let action = baseAction;

  // 1. Single-name concentration.
  if (input.positionPct !== null) {
    if (input.positionPct > 0.15) {
      const pct = (input.positionPct * 100).toFixed(1);
      overrides.push({
        triggered: true,
        reason: `Single-name concentration ${pct}% > 15% guard rail forces sell_partial`,
        cap: 'sell_partial',
      });
      // Force sell_partial only if not already worse (sell_full).
      action = action === 'sell_full' ? action : 'sell_partial';
    } else if (input.positionPct > 0.1) {
      const pct = (input.positionPct * 100).toFixed(1);
      overrides.push({
        triggered: true,
        reason: `Single-name concentration ${pct}% > 10% guard rail caps at hold (no buy_more)`,
        cap: 'hold',
      });
      action = applyCap(action, 'hold');
    }
  }

  // 2. Sector concentration on a fresh entry.
  if (input.sectorWeight !== null && input.sectorWeight > 0.35 && action === 'enter_position') {
    const pct = (input.sectorWeight * 100).toFixed(1);
    overrides.push({
      triggered: true,
      reason: `Sector weight ${pct}% > 35% — force hold on new entry`,
      cap: 'hold',
    });
    action = applyCap(action, 'hold');
  }

  // 3. Broken thesis / broken compounder lock.
  const broken = input.thesisVerdict === 'broken' || input.compounderClass === 'broken';
  if (broken) {
    overrides.push({
      triggered: true,
      reason: `Broken thesis/compounder lock — cannot buy_more or enter_position`,
      cap: 'hold',
    });
    action = applyCap(action, 'hold');
  }

  // 3b. Extreme valuation veto — PE in top 15% of own 10y history. Prevents
  // overpaying even when every other framework votes positive (the "we love
  // this business so much we'll buy at any price" trap, see consensus.md §7.5).
  const pctile10y = input.valuation?.pe10yPercentile ?? null;
  if (typeof pctile10y === 'number' && pctile10y >= 0.85) {
    overrides.push({
      triggered: true,
      reason: `PE in ${(pctile10y * 100).toFixed(0)}th percentile of own 10y history — extreme-valuation veto caps at hold`,
      cap: 'hold',
    });
    action = applyCap(action, 'hold');
  }

  // 4. Untested + low growth confidence on new entries.
  if (
    !input.isHolding &&
    input.thesisVerdict === 'untested' &&
    input.growthConfidence === 'low' &&
    action === 'enter_position'
  ) {
    overrides.push({
      triggered: true,
      reason: 'Untested thesis + low growth confidence — research first',
      cap: 'hold',
    });
    action = applyCap(action, 'hold');
  }

  // 5. Largest holding gate.
  if (input.isLargestHolding && action === 'buy_more') {
    overrides.push({
      triggered: true,
      reason: 'Already largest holding — demote buy_more to hold',
      cap: 'hold',
    });
    action = applyCap(action, 'hold');
  }

  // 6. Valuation-driven promotion (held positions only). Captures the
  // principle: a structurally sound business held at attractive valuation
  // should be a Buy More — even if the Stalwart action is the neutral 'hold'.
  // Conditions:
  //   - Held position
  //   - Compounder verdict is solid or 7-9x (structurally sound)
  //   - Valuation framework returns ≥ +1 (PEG/sector/own-history net positive)
  //   - No active sell signal (Stalwart is hold, not trim/exit)
  //   - No risk override has already capped at hold or worse
  // This sits AFTER the downgrade overrides so concentration / broken thesis /
  // 10y-percentile-veto cannot be overridden by valuation.
  const valSelf = valuationScore(input.valuation);
  const stalwartNotSelling =
    input.stalwartAction === null ||
    input.stalwartAction === 'hold' ||
    input.stalwartAction === 'add' ||
    input.stalwartAction === 'fresh_buy';
  const qualityCompounder =
    input.compounderClass === 'solid compounder' || input.compounderClass === '7-9x candidate';
  const noDowngradeFired = overrides.length === 0 || actionRank(action) >= actionRank('hold');
  // Only promote when current action is 'hold' (not already a buy/sell).
  if (
    input.isHolding &&
    action === 'hold' &&
    qualityCompounder &&
    valSelf.hasData &&
    valSelf.score >= 1 &&
    stalwartNotSelling &&
    noDowngradeFired
  ) {
    overrides.push({
      triggered: true,
      reason: `Valuation-driven promote: held ${input.compounderClass} + valuation ${valSelf.score >= 2 ? 'strong pass' : 'pass'} — Hold → Buy More`,
      cap: 'buy_more',
    });
    action = 'buy_more';
  }

  return { action, overrides };
}

/**
 * Confidence calculation:
 *   high   = ≥4 frameworks have data AND ≥4 agree directionally
 *   medium = 3-4 frameworks have data with mixed directions
 *   low    = ≤2 frameworks have data, or strong disagreement across all 5
 */
function computeConfidence(votes: FrameworkVote[]): 'low' | 'medium' | 'high' {
  const active = votes.filter((v) => v.weight > 0);
  if (active.length <= 2) return 'low';

  // Direction sign of each active vote (1, -1, 0).
  const signs = active.map((v) => Math.sign(v.score));
  const positives = signs.filter((s) => s > 0).length;
  const negatives = signs.filter((s) => s < 0).length;
  const neutrals = signs.filter((s) => s === 0).length;

  // High: ≥4 active frameworks AND ≥4 directionally agree
  // (positives ≥ 4 OR negatives ≥ 4; neutrals don't count as agreement).
  if (active.length >= 4 && (positives >= 4 || negatives >= 4)) {
    return 'high';
  }

  // Strong disagreement across all 5: positives ≥ 2 and negatives ≥ 2.
  if (active.length === 5 && positives >= 2 && negatives >= 2) {
    return 'low';
  }

  // Otherwise medium.
  void neutrals;
  return 'medium';
}

const ACTION_LABEL: Record<FinalAction, string> = {
  buy_more: 'Buy More',
  enter_position: 'Enter Position',
  sell_partial: 'Sell Partial',
  sell_full: 'Sell Full',
  hold: 'Hold',
};

function buildRationale(
  action: FinalAction,
  composite: number,
  votes: FrameworkVote[],
  overrides: RiskOverride[],
): string {
  const active = votes.filter((v) => v.weight > 0);
  const supportive = active
    .filter((v) => Math.sign(v.score) === Math.sign(composite) && v.score !== 0)
    .map((v) => v.source);
  const dissenting = active
    .filter((v) => v.score !== 0 && Math.sign(v.score) !== Math.sign(composite))
    .map((v) => v.source);

  const lines: string[] = [];
  lines.push(
    `${ACTION_LABEL[action]} — composite ${composite >= 0 ? '+' : ''}${composite.toFixed(2)} from ${active.length} active framework${active.length === 1 ? '' : 's'}.`,
  );
  if (supportive.length > 0) {
    lines.push(`Supporting: ${supportive.join(', ')}.`);
  }
  if (dissenting.length > 0) {
    lines.push(`Dissenting: ${dissenting.join(', ')}.`);
  }
  if (overrides.length > 0) {
    lines.push(`Risk caps: ${overrides.map((o) => o.reason).join(' · ')}.`);
  }
  return lines.join(' ');
}

/**
 * Synthesize the five framework outputs into a single FinalRecommendation.
 * Pure function: no I/O, deterministic.
 */
export function synthesize(input: SynthesizeInput): FinalRecommendation {
  const votes = buildVotes(input);
  const composite = weightedComposite(votes);
  const baseAction = mapScoreToAction(composite, input.isHolding);
  const { action, overrides } = applyRiskOverrides(baseAction, input);
  const confidence = computeConfidence(votes);
  const rationaleMd = buildRationale(action, composite, votes, overrides);

  return {
    action,
    confidence,
    weightedScore: Number(composite.toFixed(4)),
    votes,
    riskOverrides: overrides,
    rationaleMd,
  };
}

// ─── Display helpers (used by table + card UIs) ─────────────────────────────

export const FINAL_ACTION_LABEL: Record<FinalAction, string> = ACTION_LABEL;

export const FINAL_ACTION_TONE: Record<
  FinalAction,
  'pos' | 'info' | 'neutral' | 'warning' | 'neg'
> = {
  buy_more: 'pos',
  enter_position: 'pos',
  hold: 'neutral',
  sell_partial: 'warning',
  sell_full: 'neg',
};

/** Sort priority: enter_position, buy_more, hold, sell_partial, sell_full. */
export const FINAL_ACTION_PRIORITY: Record<FinalAction, number> = {
  enter_position: 0,
  buy_more: 1,
  hold: 2,
  sell_partial: 3,
  sell_full: 4,
};

export const FINAL_ACTIONS: FinalAction[] = [
  'enter_position',
  'buy_more',
  'hold',
  'sell_partial',
  'sell_full',
];

/** Aggregate counts of FinalAction across rows. */
export function summariseFinalActions<T extends { finalAction: FinalAction }>(
  rows: T[],
): Record<FinalAction, number> {
  const out: Record<FinalAction, number> = {
    buy_more: 0,
    enter_position: 0,
    hold: 0,
    sell_partial: 0,
    sell_full: 0,
  };
  for (const r of rows) out[r.finalAction] += 1;
  return out;
}
