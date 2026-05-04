/**
 * Plain-English explanation of WHY each fired rule applied to the symbol.
 *
 * Pulls together:
 *   - the rule's `why` array (already populated by score.ts) — the threshold
 *     conditions that fired ("ROCE 32% > 18% threshold AND PE 22 < 25").
 *   - the effective weight (baseWeight × styleScale) translated to an
 *     interpretable label ("Strong" / "Moderate" / "Weak").
 *   - any opposing rules from the same symbol (rules with action in the
 *     opposite direction that did NOT fire) so the user can see the
 *     counterweight.
 */

import type { FiredRuleView } from '@/app/(app)/p/[portfolioId]/decisions/DecisionsClient';

export type WeightLabel = 'Strong' | 'Moderate' | 'Weak';

export type RuleExplain = {
  ruleId: string;
  /** label rendered as headline: "Add to position — Buffett: buy quality at fair price" */
  headline: string;
  /** the matched threshold conditions explaining the trigger */
  triggers: string[];
  /** the human label of the weight quartile within this symbol */
  weightLabel: WeightLabel;
  /** weight tooltip body, e.g. "Effective weight 1.74 = library 0.92 × style 1.89" */
  weightTooltip: string;
  /** any rules from the OPPOSITE side that did not fire */
  counterweights: string[];
};

const ADD_ACTIONS = new Set(['fresh_buy', 'add']);
const TRIM_ACTIONS = new Set(['trim_25', 'trim_50', 'exit']);

function quartileLabel(weight: number, sorted: number[]): WeightLabel {
  if (sorted.length === 0) return 'Moderate';
  const idx = sorted.findIndex((w) => w >= weight);
  const rank = idx === -1 ? sorted.length : idx;
  const pct = rank / sorted.length;
  if (pct >= 0.75) return 'Strong';
  if (pct >= 0.25) return 'Moderate';
  return 'Weak';
}

function topInvestor(rule: FiredRuleView): string {
  if (rule.supporting_investors.length > 0) {
    const first = rule.supporting_investors[0]!;
    return first.charAt(0).toUpperCase() + first.slice(1);
  }
  return 'Library';
}

function shorten(statement: string, max = 80): string {
  if (statement.length <= max) return statement;
  return statement.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

export function explainFiredRules(rules: FiredRuleView[]): RuleExplain[] {
  // Sorted ascending so quartileLabel can rank.
  const sorted = rules.map((r) => r.weight).sort((a, b) => a - b);

  return rules.map((rule) => {
    const isAdd = ADD_ACTIONS.has(rule.action);
    const isTrim = TRIM_ACTIONS.has(rule.action);
    const opposites = rules.filter((other) => {
      if (other.ruleId === rule.ruleId) return false;
      if (isAdd && TRIM_ACTIONS.has(other.action)) return true;
      if (isTrim && ADD_ACTIONS.has(other.action)) return true;
      return false;
    });

    const counterweights =
      opposites.length > 0
        ? opposites.map((o) => `${topInvestor(o)} "${shorten(o.statement, 60)}" (also fired)`)
        : []; // counterweights are only "did not fire" *opposites*; with current data we only see fires.

    const weightLabel = quartileLabel(rule.weight, sorted);
    const weightTooltip = `Effective weight ${rule.weight.toFixed(2)} = library ${rule.baseWeight.toFixed(2)} × your style scale ${rule.styleScale.toFixed(2)}`;

    const headline = `${topInvestor(rule)}: ${shorten(rule.statement, 90)}`;

    const triggers = rule.why.length > 0 ? rule.why : ['No explicit threshold trace recorded.'];

    return {
      ruleId: rule.ruleId,
      headline,
      triggers,
      weightLabel,
      weightTooltip,
      counterweights,
    };
  });
}

/**
 * Group fired rules into a single conflict-card payload when both add-style
 * and trim-style rules fire for the same symbol.
 */
export type ConflictGroup = {
  isMixed: boolean;
  addCount: number;
  trimCount: number;
  netAction: 'add' | 'hold' | 'trim';
  addWeight: number;
  trimWeight: number;
};

export function groupConflicts(rules: FiredRuleView[]): ConflictGroup {
  let addCount = 0;
  let trimCount = 0;
  let addWeight = 0;
  let trimWeight = 0;
  for (const r of rules) {
    if (ADD_ACTIONS.has(r.action)) {
      addCount += 1;
      addWeight += r.weight;
    } else if (TRIM_ACTIONS.has(r.action)) {
      trimCount += 1;
      trimWeight += r.weight;
    }
  }
  const isMixed = addCount > 0 && trimCount > 0;
  let netAction: ConflictGroup['netAction'];
  if (addWeight > trimWeight * 1.2) netAction = 'add';
  else if (trimWeight > addWeight * 1.2) netAction = 'trim';
  else netAction = 'hold';
  return { isMixed, addCount, trimCount, netAction, addWeight, trimWeight };
}
