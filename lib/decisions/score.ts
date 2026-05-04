/**
 * Decision scoring — given a Rule Library v0.1+ and a symbol's current state
 * (holding, latest price, 52w high/low, optional valuation hints), compute
 * a per-action score and pick the top action.
 *
 * Style weights (per investor) are folded in: each rule's contribution is
 * scaled by the average style weight of investors that support it.
 */

import type { RuleLibrary, SynthesizedRule, RuleAction } from '@/lib/codex/synthesize';

export type SymbolState = {
  symbol: string;
  netQty: number; // shares currently held (delivery-only)
  avgCost?: number;
  currentPrice?: number;
  high52w?: number;
  low52w?: number;
  monthsHeld?: number;
  pe?: number;
  pb?: number;
  /** PE divided by 5y PAT-CAGR-percent. Lynch's PEG. */
  peg?: number;
  /** Symbol's current PE ÷ sector median PE (1.0 = at-sector). */
  peVsSectorMedian?: number;
  /** Symbol's own 5y trailing-PE median. */
  pe5yMedian?: number;
  /** 0..1 — where current PE sits in the symbol's own 10y trailing-PE history. */
  pe10yPercentile?: number;
  /** Earnings yield (1/PE) minus G-Sec yield, decimal. */
  earningsYieldMinusGsec?: number;
  roce5y?: number;
  revenueCagr5y?: number;
  netDebtToEbitda?: number;
  positionPct?: number;
  thesisIntact?: boolean;
  drawdownCause?: 'temporary_narrative' | 'broken_thesis' | 'macro' | 'unknown';
  cyclePhase?: 'trough' | 'mid' | 'peak' | 'unknown';
  promoterPledge?: boolean;
  auditorResigned?: boolean;
};

export type StyleWeights = Record<string, number>; // investor slug -> weight 0..1

export type FiredRule = {
  ruleId: string;
  action: RuleAction;
  weight: number; // contribution after style scaling
  baseWeight: number; // rule's library weight
  styleScale: number; // mean style weight across supporting investors
  tags?: string[]; // applicability tags (quality, cycle, etc.)
  why?: string[]; // reasons the rule fired (e.g., "PE 22 < 25 threshold")
};

export type ScoreResult = {
  symbol: string;
  action: RuleAction;
  score: number;
  perAction: Record<RuleAction, number>;
  fired: FiredRule[];
};

const ALL_ACTIONS: RuleAction[] = ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'];

function pctDrawdown(price?: number, high?: number): number | null {
  if (!price || !high || high <= 0) return null;
  return (price - high) / high; // negative = below high
}

function explainWhy(rule: SynthesizedRule, s: SymbolState): string[] {
  const out: string[] = [];
  const c = rule.conditions;
  if (c.valuation && typeof c.valuation['max_pe'] === 'number' && typeof s.pe === 'number') {
    out.push(`PE ${s.pe.toFixed(0)} ≤ ${c.valuation['max_pe']} threshold`);
  }
  if (
    c.fundamentals &&
    typeof c.fundamentals['min_roce_5y_avg'] === 'number' &&
    typeof s.roce5y === 'number'
  ) {
    out.push(
      `ROCE ${(s.roce5y * 100).toFixed(0)}% ≥ ${(
        (c.fundamentals['min_roce_5y_avg'] as number) * 100
      ).toFixed(0)}% threshold`,
    );
  }
  if (
    c.fundamentals &&
    typeof c.fundamentals['min_revenue_cagr_5y'] === 'number' &&
    typeof s.revenueCagr5y === 'number'
  ) {
    out.push(
      `Rev CAGR ${(s.revenueCagr5y * 100).toFixed(0)}% ≥ ${(
        (c.fundamentals['min_revenue_cagr_5y'] as number) * 100
      ).toFixed(0)}% threshold`,
    );
  }
  if (c.price_action && typeof c.price_action['max_drawdown_from_52w_high'] === 'number') {
    if (typeof s.currentPrice === 'number' && typeof s.high52w === 'number' && s.high52w > 0) {
      const dd = ((s.currentPrice - s.high52w) / s.high52w) * 100;
      out.push(
        `Drawdown ${dd.toFixed(0)}% past ${((c.price_action['max_drawdown_from_52w_high'] as number) * 100).toFixed(0)}% threshold`,
      );
    }
  }
  if (
    c.time_in_position &&
    typeof c.time_in_position['min_months_held'] === 'number' &&
    typeof s.monthsHeld === 'number'
  ) {
    out.push(`Held ${s.monthsHeld}mo ≥ ${c.time_in_position['min_months_held']}mo threshold`);
  }
  if (c.narrative) {
    if (c.narrative['promoter_pledge'] !== undefined && s.promoterPledge === true) {
      out.push('Promoter pledge present');
    }
    if (c.narrative['auditor_resigned'] !== undefined && s.auditorResigned === true) {
      out.push('Auditor resigned');
    }
  }
  return out;
}

function ruleApplies(rule: SynthesizedRule, s: SymbolState): boolean {
  const c = rule.conditions;
  // If the rule is a buy rule and we already hold a meaningful position,
  // a "fresh_buy" doesn't really apply — but "add" does. Don't be strict here:
  // let scoring rank.
  if (
    rule.action === 'fresh_buy' &&
    s.netQty > 0 &&
    c.fundamentals?.['min_position_pct_for_high_conviction']
  ) {
    // ok
  }

  if (c.valuation) {
    const isRedFlagRule =
      rule.action === 'exit' || rule.action === 'trim_25' || rule.action === 'trim_50';

    if (typeof c.valuation['max_pe'] === 'number') {
      // Buy-side: rule requires PE ≤ ceiling. Need PE; if missing or above, don't fire.
      if (typeof s.pe !== 'number') return false;
      if (s.pe > (c.valuation['max_pe'] as number)) return false;
    }

    if (typeof c.valuation['max_pb'] === 'number') {
      if (typeof s.pb !== 'number') return false;
      if (s.pb > (c.valuation['max_pb'] as number)) return false;
    }

    if (typeof c.valuation['max_peg'] === 'number') {
      // PEG-based rules need positive PAT growth to be meaningful. If we
      // can't compute PEG (negative growth or missing data), skip the rule —
      // safer than firing without the conviction the rule is supposed to test.
      if (typeof s.peg !== 'number') return false;
      if (s.peg > (c.valuation['max_peg'] as number)) return false;
    }

    if (typeof c.valuation['min_eyield_minus_gsec'] === 'number') {
      // Earnings-yield-vs-Gsec rule: only fires when eyield − gsec ≥ threshold.
      if (typeof s.earningsYieldMinusGsec !== 'number') return false;
      if (s.earningsYieldMinusGsec < (c.valuation['min_eyield_minus_gsec'] as number)) {
        return false;
      }
    }

    if (typeof c.valuation['pe_above_5y_median_pct'] === 'number') {
      // Trim/exit-side: fires when current PE is meaningfully above the
      // symbol's own 5y median by `pe_above_5y_median_pct` (e.g., 0.5 = +50%).
      // For non-red-flag rules this is purely informational so we skip.
      if (!isRedFlagRule) return false;
      if (typeof s.pe !== 'number' || typeof s.pe5yMedian !== 'number' || s.pe5yMedian <= 0) {
        return false;
      }
      const above = (s.pe - s.pe5yMedian) / s.pe5yMedian;
      if (above < (c.valuation['pe_above_5y_median_pct'] as number)) return false;
    }

    if (typeof c.valuation['pe_percentile_10y_max'] === 'number') {
      // Trim/exit-side: fires when current PE is in the top X% of own history.
      if (!isRedFlagRule) return false;
      if (typeof s.pe10yPercentile !== 'number') return false;
      if (s.pe10yPercentile < (c.valuation['pe_percentile_10y_max'] as number)) return false;
    }

    if (typeof c.valuation['discount_to_intrinsic_min'] === 'number') {
      // We don't have a per-symbol intrinsic / DCF model yet. Until then,
      // rules requiring this gate must NOT fire — keep silent skip rather
      // than the previous "fires for everyone" behaviour. When DCF lands,
      // wire `s.discountToIntrinsic` and check it here.
      return false;
    }

    if (c.valuation['dcf_floor_required'] === true) {
      // Same reasoning as above — no DCF model yet → don't fire.
      return false;
    }
  }

  if (c.fundamentals) {
    const isRedFlagRule =
      rule.action === 'exit' || rule.action === 'trim_25' || rule.action === 'trim_50';
    if (typeof c.fundamentals['min_roce_5y_avg'] === 'number' && typeof s.roce5y === 'number') {
      if (s.roce5y < (c.fundamentals['min_roce_5y_avg'] as number)) return false;
    }
    if (
      typeof c.fundamentals['min_revenue_cagr_5y'] === 'number' &&
      typeof s.revenueCagr5y === 'number'
    ) {
      if (s.revenueCagr5y < (c.fundamentals['min_revenue_cagr_5y'] as number)) return false;
    }
    if (typeof c.fundamentals['max_net_debt_to_ebitda'] === 'number') {
      if (isRedFlagRule) {
        // Fire only when leverage data is present AND exceeds the threshold.
        if (typeof s.netDebtToEbitda !== 'number') return false;
        if (s.netDebtToEbitda <= (c.fundamentals['max_net_debt_to_ebitda'] as number)) return false;
      } else if (typeof s.netDebtToEbitda === 'number') {
        if (s.netDebtToEbitda > (c.fundamentals['max_net_debt_to_ebitda'] as number)) return false;
      }
    }
  }

  if (c.price_action) {
    if (typeof c.price_action['max_drawdown_from_52w_high'] === 'number') {
      const dd = pctDrawdown(s.currentPrice, s.high52w);
      const limit = c.price_action['max_drawdown_from_52w_high'] as number;
      if (dd === null) {
        // Unknown drawdown — don't fire drawdown-conditional rules.
        return false;
      }
      // limit is negative (e.g. -0.2). Rule fires when dd <= limit.
      if (dd > limit) return false;
    }
  }

  if (c.time_in_position) {
    if (
      typeof c.time_in_position['min_months_held'] === 'number' &&
      typeof s.monthsHeld === 'number'
    ) {
      if (s.monthsHeld < (c.time_in_position['min_months_held'] as number)) return false;
    }
  }

  if (c.narrative) {
    if (c.narrative['thesis_intact'] === true && s.thesisIntact === false) return false;
    if (c.narrative['thesis_intact'] === false && s.thesisIntact !== false) return false;
    if (typeof c.narrative['drawdown_cause'] === 'string' && s.drawdownCause) {
      if (s.drawdownCause !== c.narrative['drawdown_cause']) return false;
    }
    if (typeof c.narrative['cycle_phase'] === 'string' && s.cyclePhase) {
      if (s.cyclePhase !== c.narrative['cycle_phase']) return false;
    }
    // Red-flag handling. For exit/trim rules, a condition of `promoter_pledge`
    // (true OR false in the rule body) means "fires WHEN the red flag is
    // present on the symbol". For other actions, both values are treated as
    // exclusion guards: e.g., a buy rule with `promoter_pledge: false` should
    // not fire if the symbol is pledged.
    const isRedFlag =
      rule.action === 'exit' || rule.action === 'trim_25' || rule.action === 'trim_50';
    if ('promoter_pledge' in c.narrative) {
      if (isRedFlag) {
        // Fire only when symbol is flagged.
        if (s.promoterPledge !== true) return false;
      } else if (c.narrative['promoter_pledge'] === false && s.promoterPledge === true) {
        return false;
      } else if (c.narrative['promoter_pledge'] === true && s.promoterPledge !== true) {
        return false;
      }
    }
    if ('auditor_resigned' in c.narrative) {
      if (isRedFlag) {
        if (s.auditorResigned !== true) return false;
      } else if (c.narrative['auditor_resigned'] === false && s.auditorResigned === true) {
        return false;
      } else if (c.narrative['auditor_resigned'] === true && s.auditorResigned !== true) {
        return false;
      }
    }
  }

  return true;
}

export function scoreSymbol(
  state: SymbolState,
  library: RuleLibrary,
  styleWeights: StyleWeights,
): ScoreResult {
  const perAction: Record<RuleAction, number> = {
    fresh_buy: 0,
    add: 0,
    hold: 0.05, // tiny prior so a symbol with no fired rules defaults to hold
    trim_25: 0,
    trim_50: 0,
    exit: 0,
  };
  const fired: FiredRule[] = [];

  const totalStyleSum = Object.values(styleWeights).reduce((a, b) => a + b, 0) || 1;

  for (const rule of library.rules) {
    if (rule.weight <= 0) continue;
    if (!ruleApplies(rule, state)) continue;

    // Style scale: average style weight across supporting investors,
    // normalised by the total style sum so that an even mix => 1.
    const ws = rule.supporting_investors.map((s) => styleWeights[s.investor] ?? 0);
    if (rule.supporting_investors.length === 0) continue;
    const meanStyle = ws.reduce((a, b) => a + b, 0) / rule.supporting_investors.length;
    const styleScale = meanStyle / (totalStyleSum / Math.max(1, Object.keys(styleWeights).length));

    if (styleScale <= 0) continue;

    const contribution = rule.weight * styleScale;
    perAction[rule.action] += contribution;
    const ruleAny = rule as SynthesizedRule & { applicability_tags?: string[] };
    fired.push({
      ruleId: rule.id,
      action: rule.action,
      weight: Number(contribution.toFixed(4)),
      baseWeight: rule.weight,
      styleScale: Number(styleScale.toFixed(3)),
      tags: ruleAny.applicability_tags ?? [],
      why: explainWhy(rule, state),
    });
  }

  // Position-state guards.
  // - If not held, suppress add/trim/exit (you can't add to or trim something
  //   you don't own). fresh_buy stays valid.
  // - If held, suppress fresh_buy as a *winning action* (we treat it as
  //   "buy more" via the `add` bucket below) — but fresh_buy contributions
  //   are still credited to the add bucket so buy-quality-at-fair-price rules
  //   apply to held positions too.
  if (state.netQty <= 0) {
    perAction.add = 0;
    perAction.trim_25 = 0;
    perAction.trim_50 = 0;
    perAction.exit = 0;
  }

  // Fold fresh_buy contributions INTO the `add` bucket as the unified
  // "buy more" signal. Both held and not-held symbols benefit: a held
  // position with strong fresh_buy votes is still a buy-more candidate.
  // We keep the original `perAction.fresh_buy` value intact for storage /
  // debugging / fired-rule display so the granular vocabulary survives.
  const buyMoreScore = perAction.add + perAction.fresh_buy;

  // Pick winning action using the unified buy-more bucket.
  // Selection set:
  //   - When held:    add (= add + fresh_buy), hold, trim_25, trim_50, exit
  //   - When not held: fresh_buy (= add + fresh_buy), hold
  // For tie-breaking we reuse the original 6-action priority list and treat
  // the chosen buy bucket according to held-state.
  type SelectionAction = RuleAction;
  const candidates: { action: SelectionAction; score: number }[] = [];
  if (state.netQty > 0) {
    candidates.push({ action: 'add', score: buyMoreScore });
    candidates.push({ action: 'hold', score: perAction.hold });
    candidates.push({ action: 'trim_25', score: perAction.trim_25 });
    candidates.push({ action: 'trim_50', score: perAction.trim_50 });
    candidates.push({ action: 'exit', score: perAction.exit });
  } else {
    // Not held (watchlist / universe): the only meaningful actions are
    //   - fresh_buy (Add More) when buy-side conviction clears the threshold
    //   - hold      (renders as 'Pass / Wait' in the display layer)
    // The universal "long-duration hold / circle-of-competence" rules pile up
    // for every quality compounder; left in the candidate set they outweigh
    // the fresh_buy bucket and the symbol misleadingly resolves to "Retain".
    // We exclude `hold` from the head-to-head and gate fresh_buy on a small
    // floor so weak watchlist signals don't all show as "Add More".
    const FRESH_BUY_FLOOR = 1.5; // ~2 strong rules (~0.7-0.9 each)
    if (buyMoreScore >= FRESH_BUY_FLOOR) {
      candidates.push({ action: 'fresh_buy', score: buyMoreScore });
    } else {
      candidates.push({ action: 'hold', score: perAction.hold });
    }
  }

  // Highest score wins; ties broken by deterministic priority.
  const priority: RuleAction[] = ['exit', 'trim_50', 'trim_25', 'add', 'fresh_buy', 'hold'];
  let bestAction: RuleAction = 'hold';
  let bestScore = -Infinity;
  for (const c of candidates) {
    if (
      c.score > bestScore + 1e-9 ||
      (Math.abs(c.score - bestScore) < 1e-9 &&
        priority.indexOf(c.action) < priority.indexOf(bestAction))
    ) {
      if (c.score > bestScore || c.score === bestScore) {
        bestScore = c.score;
        bestAction = c.action;
      }
    }
  }
  void ALL_ACTIONS;

  return {
    symbol: state.symbol,
    action: bestAction,
    score: Number(bestScore.toFixed(4)),
    perAction,
    fired: fired.sort((a, b) => b.weight - a.weight),
  };
}

export function defaultStyleWeights(library: RuleLibrary): StyleWeights {
  const seen = new Set<string>();
  for (const r of library.rules) for (const s of r.supporting_investors) seen.add(s.investor);
  const slugs = [...seen];
  if (slugs.length === 0) return {};
  const w = 1 / slugs.length;
  const out: StyleWeights = {};
  for (const s of slugs) out[s] = w;
  return out;
}
