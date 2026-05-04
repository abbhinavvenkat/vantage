/**
 * codex-synthesize — read all data/codex/distilled/*.json and produce a
 * cross-investor Rule Library v{semver} at data/codex/synthesized/v{semver}.json.
 *
 * Heuristic: cluster entries across investors by category + keyword overlap.
 * No LLM. Counterexamples = entries from other investors that match negation
 * patterns of the same theme.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { DistilledInvestor, DistilledEntry } from '@/lib/codex/distill';

export type RuleAction = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

export type RuleConditions = {
  valuation?: Record<string, number | string | boolean>;
  fundamentals?: Record<string, number | string | boolean>;
  narrative?: Record<string, string | boolean>;
  price_action?: Record<string, number | string | boolean>;
  time_in_position?: Record<string, number | string | boolean>;
};

export type SynthesizedRule = {
  id: string;
  statement: string;
  action: RuleAction;
  conditions: RuleConditions;
  supporting_investors: { investor: string; rule_ids: string[] }[];
  counterexamples: { investor: string; note: string }[];
  weight: number;
  evidence_strength: 'weak' | 'moderate' | 'strong';
  rationale_md: string;
  citations: { investor: string; source_url: string; quote: string; page_or_anchor: string }[];
  applicability_tags?: string[];
  consensus_tier?: 'convergent_core' | 'strong' | 'school_split' | 'india_specific' | 'none';
  consensus_investor_count?: number;
  backtest_alpha_avg?: number | null;
  schools?: string[];
};

export type RuleLibraryMeta = {
  investors_processed: number;
  rules_by_action: Record<RuleAction, number>;
  top_rules_by_weight: { id: string; weight: number; action: RuleAction }[];
  schools_represented: string[];
  backtest_contribution: Record<string, { xirr: number; alpha: number }>;
};

export type RuleLibrary = {
  version: string;
  generated_at: string;
  rules: SynthesizedRule[];
  _meta?: RuleLibraryMeta;
};

// ---------------------------------------------------------------------------
// Theme definitions: each theme = (statement, action, condition template,
// matchers across investor categories). A matcher returns the citation set.
// ---------------------------------------------------------------------------

type Theme = {
  id: string;
  statement: string;
  action: RuleAction;
  conditions: RuleConditions;
  positive: RegExp[];
  negative?: RegExp[];
  // Categories where supporting evidence usually lives, in order of preference.
  categories: (keyof DistilledInvestor)[];
  applicability_tags?: string[];
};

const THEMES: Theme[] = [
  {
    id: 'rule.universal.circle-of-competence',
    statement: 'Only invest in businesses you can understand and evaluate.',
    action: 'hold',
    conditions: { narrative: { thesis_intact: true, in_circle_of_competence: true } },
    positive: [
      /circle of competence/i,
      /\bunderstand the business\b/i,
      /\bonly buy what you understand\b/i,
    ],
    categories: ['principles', 'mental_models'],
    applicability_tags: ['all-markets', 'all-caps'],
  },
  {
    id: 'rule.universal.margin-of-safety',
    statement: 'Buy only with a margin of safety to intrinsic value.',
    action: 'fresh_buy',
    conditions: { valuation: { discount_to_intrinsic_min: 0.2 } },
    positive: [/margin of safety/i, /discount to (?:intrinsic|fair) value/i, /buy.*below.*fair/i],
    categories: ['principles', 'valuation_methods', 'buy_triggers'],
    applicability_tags: ['all-markets'],
  },
  {
    id: 'rule.compounder.buy-quality-fair-price',
    statement: 'Buy a quality compounder at a fair price; let it compound.',
    action: 'fresh_buy',
    conditions: {
      fundamentals: { min_roce_5y_avg: 0.15, min_revenue_cagr_5y: 0.1 },
      valuation: { max_pe: 40 },
    },
    positive: [
      /wonderful (?:business|company)/i,
      /quality (?:business|company)/i,
      /compound(?:er|ing)/i,
      /durable competitive advantage/i,
      /\bmoat\b/i,
      /QGLP/i,
    ],
    categories: ['principles', 'buy_triggers', 'valuation_methods'],
    applicability_tags: ['compounders'],
  },
  {
    id: 'rule.compounder.add-on-temporary-narrative-break',
    statement:
      'Add to a compounder when price falls on a temporary narrative concern that does not impair 5-year earnings power.',
    action: 'add',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.2 },
      narrative: { drawdown_cause: 'temporary_narrative', thesis_intact: true },
      fundamentals: { min_roce_5y_avg: 0.15 },
    },
    positive: [
      /average(?:d)? down/i,
      /temporary (?:setback|concern|narrative)/i,
      /add(?:ed)? to (?:our|the) position/i,
      /be (?:greedy|bold) when others/i,
    ],
    negative: [/averaging down on broken/i, /value trap/i],
    categories: ['add_triggers', 'principles'],
    applicability_tags: ['compounders'],
  },
  {
    id: 'rule.universal.mr-market-volatility',
    statement: 'Treat market volatility as your servant — buy when others are fearful.',
    action: 'fresh_buy',
    conditions: { price_action: { vol_regime: 'panic' }, narrative: { thesis_intact: true } },
    positive: [
      /Mr\.?\s+Market/i,
      /be (?:fearful|greedy) when/i,
      /panic/i,
      /volatility is (?:your|the investor)/i,
    ],
    categories: ['principles', 'mental_models', 'buy_triggers'],
    applicability_tags: ['all-markets'],
  },
  {
    id: 'rule.universal.trim-on-extreme-overvaluation',
    statement: 'Trim or sell when valuation is extreme even if the business remains good.',
    action: 'trim_50',
    conditions: { valuation: { pe_above_5y_median_pct: 0.5 } },
    positive: [/overvalued/i, /extreme valuation/i, /froth/i, /bubble/i, /trim(?:med)?/i],
    categories: ['trim_triggers', 'red_flags'],
    applicability_tags: ['all-markets'],
  },
  {
    id: 'rule.universal.exit-on-broken-thesis',
    statement:
      'Exit when the original thesis is broken or management quality has materially deteriorated.',
    action: 'exit',
    conditions: { narrative: { thesis_intact: false } },
    positive: [
      /thesis (?:broke|broken|invalidated)/i,
      /management (?:lied|misled|disappointed)/i,
      /capital allocation (?:errors?|mistakes?)/i,
      /sold (?:our|the) (?:position|stake)/i,
      /exit(?:ed)? (?:the|our) position/i,
    ],
    categories: ['exit_triggers'],
    applicability_tags: ['all-markets'],
  },
  {
    id: 'rule.universal.avoid-leverage-and-promoter-pledges',
    statement: 'Avoid companies with rising leverage, pledged promoter shares, or auditor changes.',
    action: 'exit',
    conditions: {
      fundamentals: { max_net_debt_to_ebitda: 3 },
      narrative: { promoter_pledge: false, auditor_resigned: false },
    },
    positive: [
      /promoter (?:pledg|sell)/i,
      /auditor (?:resign|change|qualif)/i,
      /accounting (?:fraud|red flag)/i,
      /related[- ]party transaction/i,
    ],
    categories: ['red_flags'],
    applicability_tags: ['indian-equities', 'all-markets'],
  },
  {
    id: 'rule.cycle.contrarian-bottom-buy',
    statement:
      'Buy cyclicals when they are at the bottom of the cycle and consensus is most pessimistic.',
    action: 'fresh_buy',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.4 },
      narrative: { cycle_phase: 'trough' },
    },
    positive: [/contrarian/i, /cycle/i, /capitulation/i, /second[- ]level thinking/i, /pendulum/i],
    categories: ['mental_models', 'principles', 'buy_triggers'],
    applicability_tags: ['cyclicals'],
  },
  {
    id: 'rule.universal.long-duration-hold',
    statement: 'Hold winners for the long term; do not over-trade.',
    action: 'hold',
    conditions: { time_in_position: { min_months_held: 24 } },
    positive: [
      /long[- ]term (?:invest|owner|hold)/i,
      /our favourite holding period is forever/i,
      /\bbuy[- ]and[- ]hold\b/i,
      /letting compounders/i,
    ],
    categories: ['principles'],
    applicability_tags: ['compounders'],
  },
  {
    id: 'rule.valuation.dcf-vs-multiples',
    statement: 'Anchor valuation in DCF / owner earnings rather than relative multiples alone.',
    action: 'hold',
    conditions: { valuation: { dcf_floor_required: true } },
    positive: [
      /discounted cash flow/i,
      /\bDCF\b/,
      /owner earnings/i,
      /intrinsic value/i,
      /terminal value/i,
    ],
    categories: ['valuation_methods'],
    applicability_tags: ['all-markets'],
  },
  {
    id: 'rule.position-sizing.concentrate-best-ideas',
    statement: 'Size best ideas larger; avoid over-diversification that dilutes conviction.',
    action: 'hold',
    conditions: { fundamentals: { min_position_pct_for_high_conviction: 0.05 } },
    positive: [
      /concentrat(?:e|ed|ion)/i,
      /position siz(?:e|ing)/i,
      /best ideas/i,
      /\d{1,2}%\s*(?:of|in)\s*(?:portfolio|positions)/i,
    ],
    categories: ['position_sizing_rules', 'principles'],
    applicability_tags: ['all-markets'],
  },
];

function entryMatchesTheme(entry: DistilledEntry, theme: Theme): boolean {
  return theme.positive.some((re) => re.test(entry.quote) || re.test(entry.statement));
}

function entryIsCounter(entry: DistilledEntry, theme: Theme): boolean {
  return Boolean(theme.negative?.some((re) => re.test(entry.quote)));
}

export function synthesizeFromDistilled(
  investors: DistilledInvestor[],
  version = '0.1.0',
): RuleLibrary {
  const rules: SynthesizedRule[] = [];

  for (const theme of THEMES) {
    const supporting: { investor: string; rule_ids: string[] }[] = [];
    const counterexamples: { investor: string; note: string }[] = [];
    const citations: SynthesizedRule['citations'] = [];

    for (const inv of investors) {
      const matchedIds: string[] = [];
      for (const cat of theme.categories) {
        const bucket = inv[cat];
        if (!Array.isArray(bucket)) continue;
        for (const e of bucket as DistilledEntry[]) {
          if (entryMatchesTheme(e, theme)) {
            matchedIds.push(e.id);
            citations.push({
              investor: inv.investor_slug,
              source_url: e.source_url,
              quote: e.quote,
              page_or_anchor: e.page_or_anchor,
            });
          }
        }
      }
      // Counterexamples — search broadly across all categories.
      let counterNote: string | null = null;
      for (const cat of [
        'principles',
        'mental_models',
        'buy_triggers',
        'add_triggers',
        'trim_triggers',
        'exit_triggers',
        'red_flags',
      ] as const) {
        const bucket = inv[cat] as DistilledEntry[];
        if (!Array.isArray(bucket)) continue;
        for (const e of bucket) {
          if (entryIsCounter(e, theme)) {
            counterNote = e.statement;
            break;
          }
        }
        if (counterNote) break;
      }
      if (matchedIds.length > 0) {
        supporting.push({ investor: inv.investor_slug, rule_ids: matchedIds });
      } else if (counterNote) {
        counterexamples.push({ investor: inv.investor_slug, note: counterNote });
      }
    }

    if (supporting.length === 0) continue;

    const evidence: 'weak' | 'moderate' | 'strong' =
      supporting.length >= 3 ? 'strong' : supporting.length === 2 ? 'moderate' : 'weak';

    // Weight: start at 0.5; bump for breadth and total citation count, dampen for
    // counterexamples.
    const breadthBoost = Math.min(0.3, 0.1 * supporting.length);
    const citationBoost = Math.min(0.15, 0.01 * citations.length);
    const counterPenalty = Math.min(0.1, 0.05 * counterexamples.length);
    const weight = Math.max(
      0.05,
      Math.min(0.95, 0.5 + breadthBoost + citationBoost - counterPenalty),
    );

    rules.push({
      id: theme.id,
      statement: theme.statement,
      action: theme.action,
      conditions: theme.conditions,
      supporting_investors: supporting,
      counterexamples,
      weight,
      evidence_strength: evidence,
      rationale_md: `${supporting.length} investor(s) converge: ${supporting
        .map((s) => s.investor)
        .join(', ')}. ${citations.length} citation(s).${
        counterexamples.length > 0
          ? ` Counterexamples: ${counterexamples.map((c) => c.investor).join(', ')}.`
          : ''
      }`,
      citations,
    });
  }

  return {
    version,
    generated_at: new Date().toISOString(),
    rules,
  };
}

export function loadAllDistilled(distilledRoot = 'data/codex/distilled'): DistilledInvestor[] {
  if (!existsSync(distilledRoot)) return [];
  const investors: DistilledInvestor[] = [];
  for (const f of readdirSync(distilledRoot)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(join(distilledRoot, f), 'utf-8')) as DistilledInvestor;
    investors.push(j);
  }
  return investors;
}

export function writeRuleLibrary(
  library: RuleLibrary,
  synthRoot = 'data/codex/synthesized',
): string {
  if (!existsSync(synthRoot)) mkdirSync(synthRoot, { recursive: true });
  const path = join(synthRoot, `v${library.version}.json`);
  writeFileSync(path, JSON.stringify(library, null, 2), 'utf-8');
  return path;
}
