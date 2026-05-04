/**
 * Build the v0.2 Rule Library directly from the curated stalwart corpus
 * (`data/investor_stalwarts/*.md`), the cross-school consensus document
 * (`data/codex/synthesized/consensus.md`), and the framework backtest summary
 * (`data/codex/backtests/results/summary.json`).
 *
 * Strategy:
 *   1. Parse every stalwart MD: extract slug + name + style_tags from
 *      front-matter, then split section bodies into bullet "entries".
 *   2. Detect candidate rules per investor by matching bullet text against a
 *      curated theme catalogue (each theme = action + condition template +
 *      regex bank). Themes are seeded from the consensus doc's Convergent
 *      Core / Strong Consensus / Universal sections so the catalogue mirrors
 *      what the synthesis already proved is convergent.
 *   3. Aggregate per theme into a SynthesizedRule with supporting investors
 *      and inline citations (link → URL extracted from `[label](url)` markup).
 *   4. Weight = 0.5*consensus_score + 0.5*backtest_score, both ∈ [0,1].
 */

import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type {
  RuleAction,
  RuleConditions,
  RuleLibrary,
  RuleLibraryMeta,
  SynthesizedRule,
} from '@/lib/codex/synthesize';

export type CorpusInputs = {
  stalwartsRoot: string;
  consensusPath: string;
  backtestSummaryPath: string;
};

type Frontmatter = {
  slug: string;
  name: string;
  style_tags?: string[];
  primary_geo?: string;
};

type StalwartProfile = {
  fm: Frontmatter;
  sections: Record<string, string>; // section heading lowercased -> body
  raw: string;
};

type Theme = {
  id: string;
  statement: string;
  action: RuleAction;
  conditions: RuleConditions;
  // Where to look in the profile (lowercased section headings, fuzzy matched).
  sections: string[];
  // Positive matchers for body lines.
  positive: RegExp[];
  // Optional consensus theme keys this rule taps into (used for breadth weight).
  consensus_themes?: string[];
  applicability_tags: string[];
  schools: string[];
};

type BacktestSummary = {
  frameworks: Record<string, { xirr?: number; benchmark_vs_nifty50_xirr_delta?: number }>;
};

// Mapping framework-slug → investor-slug used in supporting_investors.
const FRAMEWORK_TO_INVESTOR: Record<string, string> = {
  agrawal: 'agrawal',
  buffett: 'buffett',
  greenblatt: 'greenblatt',
  graham: 'graham',
  lynch: 'lynch',
  marks: 'marks',
  mukherjea: 'mukherjea',
  naren: 'sankaran-naren',
  prasad: 'pulak-prasad',
};

// ---------------------------------------------------------------------------
// Theme catalogue. Designed for breadth across ALL action types and to mirror
// the consensus doc's organising principles. Add or tune themes here.
// ---------------------------------------------------------------------------

const SECTIONS_BUY = ['buy triggers'];
const SECTIONS_ADD = ['add triggers'];
const SECTIONS_TRIM = ['trim / exit triggers', 'trim/exit triggers', 'trim triggers'];
const SECTIONS_RED = ['red flags / avoid list', 'red flags', 'avoid list'];
const SECTIONS_PRINCIPLE = ['core principles', 'principles', 'investing style & edge'];
const SECTIONS_VAL = ['valuation approach', 'valuation'];
const SECTIONS_MENTAL = ['mental models & frameworks', 'mental models'];

const THEMES: Theme[] = [
  // --- Quality / compounder buys ----------------------------------------
  {
    id: 'rule.compounder.buy-quality-fair-price',
    statement: 'Buy a quality compounder (high ROCE, durable moat) at a fair price.',
    action: 'fresh_buy',
    conditions: {
      fundamentals: { min_roce_5y_avg: 0.15, min_revenue_cagr_5y: 0.1 },
      valuation: { max_pe: 40 },
    },
    sections: [...SECTIONS_BUY, ...SECTIONS_PRINCIPLE, ...SECTIONS_VAL],
    positive: [
      /wonderful (?:business|company)/i,
      /quality (?:business|compounder)/i,
      /durable (?:competitive )?(?:advantage|moat)/i,
      /\bROCE\b\s*[>≥]\s*1[5-9]/i,
      /\bROCE\b\s*[>≥]\s*20/i,
      /\bcompound(?:er|ing)\b/i,
      /\bQGLP\b/,
      /three[- ]legged stool/i,
    ],
    consensus_themes: ['1.4', '1.6', '6'],
    applicability_tags: ['quality', 'compounder', 'all-markets'],
    schools: ['quality-growth', 'compounder'],
  },
  {
    id: 'rule.universal.margin-of-safety',
    statement: 'Buy only with a margin of safety to intrinsic value.',
    action: 'fresh_buy',
    conditions: { valuation: { discount_to_intrinsic_min: 0.2 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_VAL, ...SECTIONS_BUY],
    positive: [
      /margin of safety/i,
      /discount to (?:intrinsic|fair) value/i,
      /buy.*below.*(?:fair|intrinsic) value/i,
    ],
    consensus_themes: ['1.2', '2.4'],
    applicability_tags: ['value', 'all-markets'],
    schools: ['value', 'deep-value'],
  },
  {
    id: 'rule.deep-value.statistical-cheapness',
    statement: 'Buy a basket of statistically cheap stocks (NCAV / low P/B / Magic Formula).',
    action: 'fresh_buy',
    conditions: { valuation: { max_pb: 1.0, max_pe: 12 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_VAL, ...SECTIONS_BUY],
    positive: [
      /\bnet[- ]net\b/i,
      /\bNCAV\b/,
      /book value/i,
      /\bmagic formula\b/i,
      /\bdeep value\b/i,
    ],
    consensus_themes: ['3.1', '3.3'],
    applicability_tags: ['deep-value', 'cyclicals', 'all-markets'],
    schools: ['deep-value'],
  },
  {
    id: 'rule.cycle.contrarian-bottom-buy',
    statement: 'Buy cyclicals at the bottom of the cycle when consensus is most pessimistic.',
    action: 'fresh_buy',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.4 },
      narrative: { cycle_phase: 'trough' },
    },
    sections: [...SECTIONS_BUY, ...SECTIONS_MENTAL, ...SECTIONS_PRINCIPLE],
    positive: [
      /maximum pessimism/i,
      /\bcontrarian\b/i,
      /\bcapitulation\b/i,
      /pendulum/i,
      /second[- ]level thinking/i,
      /cycle (?:trough|bottom|low)/i,
    ],
    consensus_themes: ['2.5', '6'],
    applicability_tags: ['cyclicals', 'mean_reversion', 'all-markets'],
    schools: ['contrarian', 'cycle'],
  },
  {
    id: 'rule.macro.market-correction-tactical-entry',
    statement:
      'Deploy aggressively into market-wide corrections of 20–30%+ in a sound macro setup.',
    action: 'fresh_buy',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.2 },
      narrative: { thesis_intact: true },
    },
    sections: [...SECTIONS_BUY, ...SECTIONS_PRINCIPLE],
    positive: [
      /be (?:fearful|greedy) when/i,
      /Mr\.?\s*Market/i,
      /panic/i,
      /20[-–]30% (?:correction|decline)/i,
      /shooting[- ]fish[- ]in[- ]a[- ]barrel/i,
    ],
    consensus_themes: ['6'],
    applicability_tags: ['all-markets', 'tactical'],
    schools: ['value', 'opportunistic'],
  },
  {
    id: 'rule.india.preinstitutional-discovery',
    statement:
      'Buy quality businesses below ~₹5,000 Cr market cap before institutional coverage arrives.',
    action: 'fresh_buy',
    conditions: { fundamentals: { max_market_cap_cr: 5000, min_roce_5y_avg: 0.15 } },
    sections: [...SECTIONS_BUY, ...SECTIONS_PRINCIPLE],
    positive: [
      /pre[- ]institutional/i,
      /institutional discovery/i,
      /under[- ]researched/i,
      /no analyst coverage/i,
      /below.{0,12}₹?\s*5,?000\s*(?:cr|crore)/i,
      /micro[- ]cap.*discovery/i,
      /3G\b/,
    ],
    consensus_themes: ['4.4'],
    applicability_tags: ['indian-equities', 'small-cap', 'discovery'],
    schools: ['quality-growth', 'india-small-cap'],
  },
  {
    id: 'rule.india.peg-with-pe-ceiling',
    statement: 'Use PEG < 1.0 with an absolute P/E ceiling — quality cap-weighted.',
    action: 'fresh_buy',
    conditions: { valuation: { max_peg: 1.0, max_pe: 35 } },
    sections: [...SECTIONS_VAL, ...SECTIONS_BUY],
    positive: [/\bPEG\b/, /price[- ]earnings[- ]growth/i],
    consensus_themes: ['7.1', '4.4'],
    applicability_tags: ['indian-equities', 'GARP'],
    schools: ['quality-growth', 'GARP'],
  },

  // --- Add triggers -----------------------------------------------------
  {
    id: 'rule.compounder.add-on-temporary-narrative-break',
    statement:
      'Add to a quality compounder when price falls on a temporary narrative concern that does not impair 5-year earnings power.',
    action: 'add',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.2 },
      narrative: { drawdown_cause: 'temporary_narrative', thesis_intact: true },
      fundamentals: { min_roce_5y_avg: 0.15 },
    },
    sections: [...SECTIONS_ADD, ...SECTIONS_PRINCIPLE],
    positive: [
      /average(?:d)? down/i,
      /add(?:ed)? to (?:our|the) position/i,
      /temporary (?:setback|concern|narrative|disappointment)/i,
      /buy(?:ing)? more on weakness/i,
      /\bbruised blue chip\b/i,
      /50% below.*5[- ]year high/i,
    ],
    consensus_themes: ['6'],
    applicability_tags: ['compounder', 'quality'],
    schools: ['quality-growth'],
  },
  {
    id: 'rule.add.management-upgrade',
    statement:
      'Add when a competent new CEO/promoter materially improves a previously mediocre business.',
    action: 'add',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_ADD, ...SECTIONS_BUY],
    positive: [
      /new (?:CEO|management|leadership)/i,
      /management (?:change|upgrade)/i,
      /turnaround.*management/i,
    ],
    applicability_tags: ['special_situation', 'all-markets'],
    schools: ['turnaround'],
  },
  {
    id: 'rule.add.promoter-buying-during-distress',
    statement: 'Add when promoters buy aggressively in the open market during company distress.',
    action: 'add',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_ADD, ...SECTIONS_BUY, ...SECTIONS_PRINCIPLE],
    positive: [
      /promoter (?:open[- ]market )?buy(?:ing|s)?/i,
      /insider (?:buy|purchase)/i,
      /promoter[s']?? own[- ]market/i,
    ],
    applicability_tags: ['indian-equities', 'special_situation'],
    schools: ['value', 'india-mid-cap'],
  },

  // --- Hold -------------------------------------------------------------
  {
    id: 'rule.universal.long-duration-hold',
    statement: 'Hold quality compounders for the long term; do not over-trade.',
    action: 'hold',
    conditions: { time_in_position: { min_months_held: 24 } },
    sections: [...SECTIONS_PRINCIPLE],
    positive: [
      /our favourite holding period is forever/i,
      /\blong[- ]term (?:investor|holder|hold)/i,
      /\bbuy[- ]and[- ]hold\b/i,
      /\bcompound\b/i,
      /\bstubbornly hold\b/i,
    ],
    consensus_themes: ['1.3'],
    applicability_tags: ['compounder', 'quality'],
    schools: ['quality-growth'],
  },
  {
    id: 'rule.hold.thesis-driven',
    statement: 'Default to hold; sell only on thesis break, not on price decline.',
    action: 'hold',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_TRIM],
    positive: [
      /sell on (?:thesis break|fundamental change)/i,
      /price (?:decline|drop) is not a sell signal/i,
      /thesis break/i,
      /do[- ]nothing default/i,
      /never sold a position because.*fully valued/i,
    ],
    consensus_themes: ['1.9', '2.3'],
    applicability_tags: ['quality', 'compounder'],
    schools: ['quality-growth', 'value'],
  },
  {
    id: 'rule.position-sizing.concentrate-best-ideas',
    statement: 'Size best ideas larger; avoid over-diversification that dilutes conviction.',
    action: 'hold',
    conditions: { fundamentals: { min_position_pct_for_high_conviction: 0.05 } },
    sections: [...SECTIONS_PRINCIPLE],
    positive: [
      /\bconcentrat(?:e|ed|ion)\b/i,
      /position siz(?:e|ing)/i,
      /best ideas/i,
      /diversification.*ignorance/i,
    ],
    consensus_themes: ['1.8'],
    applicability_tags: ['concentration', 'all-markets'],
    schools: ['concentration', 'quality-growth'],
  },
  {
    id: 'rule.valuation.dcf-anchor',
    statement: 'Anchor valuation in DCF / owner earnings, not relative multiples alone.',
    action: 'hold',
    conditions: { valuation: { dcf_floor_required: true } },
    sections: [...SECTIONS_VAL],
    positive: [
      /discounted cash flow/i,
      /\bDCF\b/,
      /owner earnings/i,
      /intrinsic value/i,
      /terminal value/i,
    ],
    applicability_tags: ['all-markets'],
    schools: ['value', 'quality-growth'],
  },
  {
    id: 'rule.fcf-quality-check',
    statement: 'Require CFO/PAT > 0.7 sustained — earnings without cash are suspect.',
    action: 'hold',
    conditions: { fundamentals: { min_cfo_pat_ratio: 0.7 } },
    sections: [...SECTIONS_VAL, ...SECTIONS_PRINCIPLE, ...SECTIONS_RED],
    positive: [
      /CFO\s*\/?\s*PAT/i,
      /CFO\/EBITDA/i,
      /cash flow.*earnings/i,
      /free cash flow/i,
      /CFROIC/i,
      /accruals?/i,
    ],
    consensus_themes: ['1.5'],
    applicability_tags: ['quality', 'forensic'],
    schools: ['quality-growth', 'forensic'],
  },

  // --- Trim -------------------------------------------------------------
  {
    id: 'rule.universal.trim-on-extreme-overvaluation',
    statement: 'Trim 50% when valuation is extreme even if the business remains good.',
    action: 'trim_50',
    conditions: { valuation: { pe_above_5y_median_pct: 0.5 } },
    sections: [...SECTIONS_TRIM, ...SECTIONS_PRINCIPLE],
    positive: [
      /overvalued/i,
      /extreme valuation/i,
      /froth/i,
      /bubble/i,
      /trim(?:med)? (?:position|holding)/i,
      /reduce.*aggressive holdings/i,
    ],
    applicability_tags: ['all-markets', 'mean_reversion'],
    schools: ['value', 'cycle'],
  },
  {
    id: 'rule.trim.position-bloat',
    statement: 'Trim 25% when a single position has grown to dominate the portfolio (>20% weight).',
    action: 'trim_25',
    conditions: { fundamentals: { max_position_pct: 0.2 } },
    sections: [...SECTIONS_TRIM, ...SECTIONS_PRINCIPLE],
    positive: [/rebalanc/i, /position weight/i, /trim.*portfolio (?:weight|share)/i],
    applicability_tags: ['risk', 'all-markets'],
    schools: ['risk-management'],
  },
  {
    id: 'rule.trim.cycle-peak-pe-percentile',
    statement: 'Trim 25% when sector PE crosses the 80th percentile of its 10-year history.',
    action: 'trim_25',
    conditions: { valuation: { pe_percentile_10y_max: 0.8 } },
    sections: [...SECTIONS_TRIM, ...SECTIONS_PRINCIPLE],
    positive: [
      /80th percentile/i,
      /PE percentile/i,
      /sector PE/i,
      /elevated.*valuation/i,
      /reduce equity allocation/i,
    ],
    consensus_themes: ['2.5', '4.6'],
    applicability_tags: ['indian-equities', 'mean_reversion', 'cycle'],
    schools: ['cycle', 'macro'],
  },

  // --- Exit -------------------------------------------------------------
  {
    id: 'rule.universal.exit-on-broken-thesis',
    statement: 'Exit when the thesis is broken or management has materially failed.',
    action: 'exit',
    conditions: { narrative: { thesis_intact: false } },
    sections: [...SECTIONS_TRIM, ...SECTIONS_PRINCIPLE],
    positive: [
      /thesis (?:broke|broken|invalidated)/i,
      /management (?:lied|misled|disappointed)/i,
      /sold (?:our|the) (?:position|stake)/i,
      /exit(?:ed)? (?:the|our|that) position/i,
      /broken (?:business|story)/i,
      /capital allocation (?:errors?|mistakes?)/i,
    ],
    consensus_themes: ['1.9'],
    applicability_tags: ['all-markets'],
    schools: ['quality-growth', 'value'],
  },
  {
    id: 'rule.redflag.promoter-pledge',
    statement: 'Exit on material promoter pledge — hidden leverage destroys minority value.',
    action: 'exit',
    conditions: { narrative: { promoter_pledge: true } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE],
    positive: [/promoter (?:pledg|pledge)/i, /pledged.*shares/i, /promoter.*pledg/i],
    consensus_themes: ['4.1', '5'],
    applicability_tags: ['indian-equities', 'red_flag'],
    schools: ['governance', 'forensic'],
  },
  {
    id: 'rule.redflag.auditor-or-governance',
    statement:
      'Exit on auditor resignation, qualified opinion, or material related-party tunnelling.',
    action: 'exit',
    conditions: { narrative: { auditor_resigned: true } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE],
    positive: [
      /auditor (?:resign|change|qualif)/i,
      /qualified opinion/i,
      /related[- ]party transaction/i,
      /accounting (?:fraud|red flag|sharp practice)/i,
    ],
    consensus_themes: ['4.1', '5'],
    applicability_tags: ['indian-equities', 'red_flag', 'governance'],
    schools: ['forensic', 'governance'],
  },
  {
    id: 'rule.redflag.business-leverage',
    statement:
      'Exit cyclical businesses with net debt / EBITDA > 3× — leverage turns cyclical pain permanent.',
    action: 'exit',
    conditions: { fundamentals: { max_net_debt_to_ebitda: 3 } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE],
    positive: [
      /\bleverage\b/i,
      /\bdebt\b.*\bEBITDA\b/i,
      /balance[- ]sheet stress/i,
      /\binsolvency\b/i,
      /worst loans in the best of times/i,
    ],
    consensus_themes: ['1.10', '5'],
    applicability_tags: ['cyclicals', 'all-markets', 'red_flag'],
    schools: ['risk-management', 'value'],
  },
  {
    id: 'rule.redflag.cfo-pat-divergence',
    statement:
      'Exit when CFO/PAT < 0.6 for 3+ consecutive years — earnings quality has broken down.',
    action: 'exit',
    conditions: { fundamentals: { min_cfo_pat_ratio: 0.6 } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE],
    positive: [
      /CFO.*PAT.*0\.[567]/i,
      /persistent.*CFO/i,
      /accounting.*divergence/i,
      /cash flow.*paint/i,
    ],
    consensus_themes: ['1.5', '5'],
    applicability_tags: ['forensic', 'red_flag', 'indian-equities'],
    schools: ['forensic', 'governance'],
  },
  {
    id: 'rule.redflag.structural-decline',
    statement: 'Exit when secular demand destruction (not cyclical) impairs 5-year earnings power.',
    action: 'exit',
    conditions: { narrative: { thesis_intact: false } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE, ...SECTIONS_TRIM],
    positive: [
      /structural (?:decline|demand)/i,
      /secular decline/i,
      /technology (?:disruption|disrupted)/i,
      /pricing power lost/i,
    ],
    consensus_themes: ['1.9', '5'],
    applicability_tags: ['all-markets', 'red_flag'],
    schools: ['quality-growth'],
  },
  // --- Mental models / quality gates ------------------------------------
  {
    id: 'rule.universal.circle-of-competence',
    statement: 'Only invest within your circle of competence — what you can confidently project.',
    action: 'hold',
    conditions: { narrative: { in_circle_of_competence: true } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_MENTAL],
    positive: [
      /circle of competence/i,
      /\bunderstand the business\b/i,
      /only buy what you understand/i,
    ],
    consensus_themes: ['1.7'],
    applicability_tags: ['all-markets'],
    schools: ['quality-growth', 'value'],
  },
  {
    id: 'rule.universal.management-integrity-gate',
    statement: 'Pass on businesses where management integrity is in question — no exceptions.',
    action: 'exit',
    conditions: { narrative: { thesis_intact: false } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_RED],
    positive: [
      /management integrity/i,
      /promoter integrity/i,
      /one ethics violation/i,
      /never deal with a rascal/i,
      /character/i,
    ],
    consensus_themes: ['1.1', '4.1'],
    applicability_tags: ['all-markets', 'governance', 'indian-equities'],
    schools: ['governance', 'quality-growth'],
  },
  {
    id: 'rule.quality.high-roic-incremental',
    statement: 'Add when ROIC on incremental capital exceeds 20% with reinvestment runway.',
    action: 'add',
    conditions: { fundamentals: { min_roic_incremental: 0.2 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_VAL, ...SECTIONS_ADD],
    positive: [
      /incremental capital/i,
      /ROIC > ?20/i,
      /reinvestment runway/i,
      /three[- ]legged stool/i,
    ],
    consensus_themes: ['1.4', '6'],
    applicability_tags: ['quality', 'compounder'],
    schools: ['quality-growth'],
  },
  {
    id: 'rule.universal.permanent-loss-avoidance',
    statement: 'Risk = permanent loss of capital, not volatility — evaluate downside first.',
    action: 'hold',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_MENTAL],
    positive: [
      /permanent (?:loss|impairment)/i,
      /never (?:risk|lose) (?:permanent )?capital/i,
      /downside (?:scenario|first)/i,
      /asymmetric/i,
    ],
    consensus_themes: ['1.2'],
    applicability_tags: ['risk', 'all-markets'],
    schools: ['risk-management', 'value'],
  },
  // --- More buy themes --------------------------------------------------
  {
    id: 'rule.india.profit-to-gdp-buy',
    statement:
      'Buy aggressively when India profit-to-GDP < 4.5% (structural mean-reversion entry).',
    action: 'fresh_buy',
    conditions: { narrative: { macro_signal: 'profit_gdp_low' } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_BUY, ...SECTIONS_MENTAL],
    positive: [
      /profit[- ]to[- ]GDP/i,
      /profit[s]?\/GDP/i,
      /4(?:\.5)?% of GDP/i,
      /corporate profits.*GDP/i,
    ],
    consensus_themes: ['4.3'],
    applicability_tags: ['indian-equities', 'macro'],
    schools: ['macro', 'india-mid-cap'],
  },
  {
    id: 'rule.india.earnings-yield-vs-gsec',
    statement: 'Tactical buy when Nifty earnings yield exceeds 10y G-sec by 300+ bps.',
    action: 'fresh_buy',
    conditions: { valuation: { min_eyield_minus_gsec: 0.03 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_BUY, ...SECTIONS_VAL],
    positive: [
      /earnings yield/i,
      /G[- ]sec/i,
      /10[- ]year (?:G[- ]sec|government bond)/i,
      /spread.*equity.*bond/i,
    ],
    consensus_themes: ['4.6'],
    applicability_tags: ['indian-equities', 'macro', 'tactical'],
    schools: ['macro'],
  },
  {
    id: 'rule.lynch.peg-with-acceleration',
    statement: 'Buy when PEG < 0.8 and earnings acceleration is visible (Lynch GARP).',
    action: 'fresh_buy',
    conditions: { valuation: { max_peg: 0.8 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_BUY, ...SECTIONS_VAL],
    positive: [/\bPEG\b.*0\.[0-9]/, /earnings acceleration/i, /\bGARP\b/, /\bLynch\b/],
    consensus_themes: ['7.1'],
    applicability_tags: ['GARP', 'all-markets'],
    schools: ['GARP', 'lynch'],
  },
  {
    id: 'rule.value.bruised-blue-chip',
    statement: 'Add to a Blue Chip 50%+ below its 5-year high if business fundamentals are intact.',
    action: 'add',
    conditions: {
      price_action: { max_drawdown_from_52w_high: -0.5 },
      narrative: { thesis_intact: true },
    },
    sections: [...SECTIONS_ADD, ...SECTIONS_BUY, ...SECTIONS_MENTAL],
    positive: [/bruised blue chip/i, /50% below.*5[- ]year high/i, /blue[- ]chip.*falling/i],
    applicability_tags: ['indian-equities', 'compounder'],
    schools: ['quality-growth', 'india-mid-cap'],
  },
  {
    id: 'rule.universal.no-leverage-portfolio',
    statement:
      'Never use portfolio leverage — it converts a temporary problem into permanent loss.',
    action: 'hold',
    conditions: { fundamentals: { max_portfolio_leverage: 0 } },
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_MENTAL],
    positive: [
      /portfolio leverage/i,
      /never use leverage/i,
      /borrowed money/i,
      /margin (?:call|debt)/i,
    ],
    consensus_themes: ['1.10'],
    applicability_tags: ['risk', 'all-markets'],
    schools: ['risk-management', 'value'],
  },
  {
    id: 'rule.exit.opportunity-cost',
    statement: 'Trim when a better-quality opportunity is available at equivalent or lower risk.',
    action: 'trim_25',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_TRIM, ...SECTIONS_PRINCIPLE],
    positive: [
      /opportunity cost/i,
      /better.*opportunit/i,
      /reallocat(?:e|ion)/i,
      /redeploy.*capital/i,
    ],
    consensus_themes: ['1.9'],
    applicability_tags: ['all-markets'],
    schools: ['value'],
  },
  {
    id: 'rule.special.spinoff-or-rights',
    statement: 'Hunt special situations: spinoffs, rights issues, post-IPO discovery (1-2y aged).',
    action: 'fresh_buy',
    conditions: { narrative: { thesis_intact: true } },
    sections: [...SECTIONS_BUY, ...SECTIONS_PRINCIPLE, ...SECTIONS_MENTAL],
    positive: [/spin[- ]off/i, /rights issue/i, /post[- ]IPO/i, /special situation/i],
    applicability_tags: ['special_situation', 'all-markets'],
    schools: ['special-situations', 'value'],
  },
  {
    id: 'rule.redflag.aggressive-acquisitions',
    statement: 'Exit when growth is funded entirely by acquisitions without organic ROCE > 15%.',
    action: 'exit',
    conditions: { fundamentals: { min_roce_5y_avg: 0.15 } },
    sections: [...SECTIONS_RED, ...SECTIONS_PRINCIPLE],
    positive: [
      /acquisition[- ]led growth/i,
      /unrelated acquisition/i,
      /value[- ]destructive M&A/i,
      /serial acquirer/i,
    ],
    consensus_themes: ['5'],
    applicability_tags: ['all-markets', 'red_flag'],
    schools: ['quality-growth', 'forensic'],
  },
  {
    id: 'rule.macro.do-not-time',
    statement: 'Do not attempt macro market timing — stay invested through volatility.',
    action: 'hold',
    conditions: {},
    sections: [...SECTIONS_PRINCIPLE, ...SECTIONS_MENTAL],
    positive: [
      /macro is unknowable/i,
      /never bet against america/i,
      /stay invested/i,
      /time in the market/i,
      /macro.*forecast/i,
    ],
    applicability_tags: ['all-markets'],
    schools: ['quality-growth'],
  },
];

// ---------------------------------------------------------------------------
// Stalwart parsing
// ---------------------------------------------------------------------------

function parseFrontmatter(md: string): Frontmatter | null {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return null;
  const body = m[1] ?? '';
  const fm: Frontmatter = { slug: '', name: '' };
  for (const line of body.split('\n')) {
    const lm = /^([\w_-]+):\s*(.*)$/.exec(line.trim());
    if (!lm) continue;
    const k = lm[1]!;
    let v: string = lm[2] ?? '';
    if (k === 'slug') fm.slug = v.replace(/['"]/g, '').trim();
    else if (k === 'name') fm.name = v.replace(/['"]/g, '').trim();
    else if (k === 'primary_geo') fm.primary_geo = v.replace(/['"]/g, '').trim();
    else if (k === 'style_tags') {
      const arr = v
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      fm.style_tags = arr;
    }
  }
  return fm.slug && fm.name ? fm : null;
}

function splitSections(md: string): Record<string, string> {
  // Strip frontmatter.
  const stripped = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const lines = stripped.split('\n');
  const sections: Record<string, string> = {};
  let current = '';
  let buf: string[] = [];
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) sections[current.toLowerCase()] = buf.join('\n').trim();
      current = (m[1] ?? '').trim();
      buf = [];
    } else if (current) {
      buf.push(line);
    }
  }
  if (current) sections[current.toLowerCase()] = buf.join('\n').trim();
  return sections;
}

function loadStalwarts(root: string): StalwartProfile[] {
  if (!existsSync(root)) return [];
  const out: StalwartProfile[] = [];
  for (const f of readdirSync(root)) {
    if (!f.endsWith('.md')) continue;
    const md = readFileSync(join(root, f), 'utf-8');
    const fm = parseFrontmatter(md);
    if (!fm) continue;
    out.push({ fm, sections: splitSections(md), raw: md });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bullet extraction + matching
// ---------------------------------------------------------------------------

function bulletLines(body: string): string[] {
  if (!body) return [];
  const out: string[] = [];
  const lines = body.split('\n');
  let cur = '';
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (cur) out.push(cur);
      cur = line.replace(/^\s*[-*]\s+/, '');
    } else if (/^\s+/.test(line) && cur) {
      cur += ' ' + line.trim();
    } else if (line.trim() === '') {
      if (cur) {
        out.push(cur);
        cur = '';
      }
    } else if (cur) {
      cur += ' ' + line.trim();
    }
  }
  if (cur) out.push(cur);
  return out;
}

function findFirstUrl(line: string): { url: string; label: string } | null {
  const m = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.exec(line);
  if (!m) return null;
  return { label: m[1] ?? '', url: m[2] ?? '' };
}

function findFirstQuote(line: string): string | null {
  // Try a "..." or '...' quoted span.
  const m = /[“"']([^“”"']{15,})[”"']/.exec(line);
  return m ? (m[1] ?? null) : null;
}

function fuzzyGetSection(profile: StalwartProfile, candidates: string[]): string | null {
  for (const cand of candidates) {
    const exact = profile.sections[cand];
    if (exact) return exact;
  }
  // Fuzzy: any section heading that contains all words.
  for (const cand of candidates) {
    const words = cand.split(/\W+/).filter(Boolean);
    for (const k of Object.keys(profile.sections)) {
      if (words.every((w) => k.includes(w))) return profile.sections[k] ?? null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Consensus parsing — extract investor-counts per consensus subsection
// ---------------------------------------------------------------------------

type ConsensusSection = {
  key: string; // e.g. "1.4"
  title: string;
  investors: Set<string>; // slugs (best-effort)
};

function consensusInvestorSlugs(text: string): Set<string> {
  // The consensus document spells investor names rather than slugs. We map
  // common spellings to slugs by matching against the loaded stalwart list at
  // runtime; here we simply return the raw tokens lowercased.
  const out = new Set<string>();
  const re = /(?:agreement|investors? in full agreement)[^:]*:\s*([^\n]+)/i;
  const m = re.exec(text);
  if (!m) return out;
  const list = (m[1] ?? '').split(/[,;]/);
  for (const t of list) out.add(t.trim().toLowerCase());
  return out;
}

function parseConsensus(path: string): Map<string, ConsensusSection> {
  const out = new Map<string, ConsensusSection>();
  if (!existsSync(path)) return out;
  const md = readFileSync(path, 'utf-8');
  // Split on level-3 headings like "### 1.4 ROIC ..." and capture the body.
  const re = /^###\s+([0-9]+\.[0-9]+)\s+([^\n]+)\n([\s\S]*?)(?=^###\s|^##\s|\Z)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const key = m[1] ?? '';
    const title = m[2] ?? '';
    const body = m[3] ?? '';
    out.set(key, { key, title, investors: consensusInvestorSlugs(body) });
  }
  // Also include section 5 (red flags) and 6 (buy signals): count investors per row.
  const tableRe = /^##\s+(5|6)\.[^\n]*\n([\s\S]*?)(?=^##\s|\Z)/gm;
  let t: RegExpExecArray | null;
  while ((t = tableRe.exec(md)) !== null) {
    const sec = t[1] === '5' ? '5' : '6';
    const body = t[2] ?? '';
    const rows = body.split('\n').filter((l) => /^\|/.test(l));
    const inv = new Set<string>();
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim());
      if (cells.length < 3) continue;
      const cited = cells[2] ?? '';
      for (const tok of cited.split(/[,;]/)) {
        const v = tok.trim().toLowerCase();
        if (v && !v.startsWith('---') && !v.startsWith('cited')) inv.add(v);
      }
    }
    out.set(sec, {
      key: sec,
      title: sec === '5' ? 'Universal Red Flags' : 'Universal Buy Signals',
      investors: inv,
    });
  }
  return out;
}

// Rough name → slug lookup for consensus matching.
function nameToSlug(name: string, slugList: string[]): string | null {
  const n = name.toLowerCase().replace(/[.\s]/g, '-');
  for (const slug of slugList) {
    if (slug === n) return slug;
    // last name match
    const last = name.split(/\s+/).pop() ?? '';
    if (last && slug.includes(last.toLowerCase())) return slug;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main synthesis
// ---------------------------------------------------------------------------

function loadBacktestSummary(path: string): BacktestSummary | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as BacktestSummary;
  } catch {
    return null;
  }
}

function consensusScore(theme: Theme, consensus: Map<string, ConsensusSection>): number {
  if (!theme.consensus_themes || theme.consensus_themes.length === 0) return 0.3;
  let count = 0;
  for (const k of theme.consensus_themes) {
    const cs = consensus.get(k);
    if (cs) count = Math.max(count, cs.investors.size);
  }
  // 20+ investors → 1.0; below scales linearly.
  return Math.max(0.2, Math.min(1.0, count / 20));
}

function backtestScore(
  supporting: string[],
  summary: BacktestSummary | null,
): {
  score: number;
  alphaAvg: number | null;
} {
  if (!summary) return { score: 0.5, alphaAvg: null };
  const matched: number[] = [];
  for (const inv of supporting) {
    for (const [fk, fwSlug] of Object.entries(FRAMEWORK_TO_INVESTOR)) {
      if (fwSlug === inv) {
        const f = summary.frameworks?.[fk];
        if (f && typeof f.benchmark_vs_nifty50_xirr_delta === 'number') {
          matched.push(f.benchmark_vs_nifty50_xirr_delta);
        }
      }
    }
  }
  if (matched.length === 0) return { score: 0.5, alphaAvg: null };
  const avgAlpha = matched.reduce((a, b) => a + b, 0) / matched.length;
  // Normalise: alpha 0% → 0.5, alpha 10% → 1.0, alpha -5% → 0.25.
  const score = Math.max(0, Math.min(1, 0.5 + avgAlpha * 5));
  return { score, alphaAvg: avgAlpha };
}

export function synthesizeFromCorpus(inputs: CorpusInputs, version = '0.2.0'): RuleLibrary {
  const stalwarts = loadStalwarts(inputs.stalwartsRoot);
  const consensus = parseConsensus(inputs.consensusPath);
  const summary = loadBacktestSummary(inputs.backtestSummaryPath);
  const slugList = stalwarts.map((s) => s.fm.slug);

  const rules: SynthesizedRule[] = [];

  for (const theme of THEMES) {
    type Match = {
      slug: string;
      bulletIds: string[];
      citations: SynthesizedRule['citations'];
    };
    const matches: Match[] = [];

    for (const inv of stalwarts) {
      const matchedIds: string[] = [];
      const citations: SynthesizedRule['citations'] = [];
      for (const sec of theme.sections) {
        const body = fuzzyGetSection(inv, [sec]);
        if (!body) continue;
        const bullets = bulletLines(body);
        for (let i = 0; i < bullets.length; i += 1) {
          const b = bullets[i] ?? '';
          if (theme.positive.some((re) => re.test(b))) {
            matchedIds.push(`${inv.fm.slug}.${sec.replace(/\s+/g, '-')}.${i}`);
            const link = findFirstUrl(b);
            const quote = findFirstQuote(b) ?? b.slice(0, 220);
            citations.push({
              investor: inv.fm.slug,
              source_url: link?.url ?? '',
              quote: quote.slice(0, 280),
              page_or_anchor: link?.label ?? sec,
            });
            if (citations.length >= 3) break;
          }
        }
        if (citations.length >= 3) break;
      }
      if (matchedIds.length > 0) {
        matches.push({ slug: inv.fm.slug, bulletIds: matchedIds, citations });
      }
    }

    if (matches.length === 0) continue;

    // Augment supporting list with consensus-implied investors so weight reflects breadth.
    const supportingSlugs = new Set(matches.map((m) => m.slug));
    if (theme.consensus_themes) {
      for (const k of theme.consensus_themes) {
        const cs = consensus.get(k);
        if (!cs) continue;
        for (const tok of cs.investors) {
          const slug = nameToSlug(tok, slugList);
          if (slug) supportingSlugs.add(slug);
        }
      }
    }

    const supporting_investors = matches.map((m) => ({
      investor: m.slug,
      rule_ids: m.bulletIds,
    }));
    // Append consensus-only supporters with empty rule_ids.
    for (const slug of supportingSlugs) {
      if (!supporting_investors.find((s) => s.investor === slug)) {
        supporting_investors.push({ investor: slug, rule_ids: [] });
      }
    }

    const cScore = consensusScore(theme, consensus);
    const backtest = backtestScore(
      supporting_investors.map((s) => s.investor),
      summary,
    );
    const weight = Math.max(0.05, Math.min(0.99, 0.5 * cScore + 0.5 * backtest.score));

    const evidence: SynthesizedRule['evidence_strength'] =
      supporting_investors.length >= 5
        ? 'strong'
        : supporting_investors.length >= 2
          ? 'moderate'
          : 'weak';

    const allCitations = matches.flatMap((m) => m.citations).slice(0, 12);

    rules.push({
      id: theme.id,
      statement: theme.statement,
      action: theme.action,
      conditions: theme.conditions,
      supporting_investors,
      counterexamples: [],
      weight: Number(weight.toFixed(4)),
      evidence_strength: evidence,
      rationale_md: `${supporting_investors.length} investor(s); consensus_score ${cScore.toFixed(2)}, backtest_score ${backtest.score.toFixed(2)}.`,
      citations: allCitations,
      applicability_tags: theme.applicability_tags,
      consensus_tier:
        theme.consensus_themes && theme.consensus_themes.some((k) => /^[1-2]\./.test(k))
          ? 'convergent_core'
          : theme.consensus_themes && theme.consensus_themes.some((k) => /^4\./.test(k))
            ? 'india_specific'
            : theme.consensus_themes
              ? 'strong'
              : 'none',
      consensus_investor_count: cScore > 0 ? Math.round(cScore * 20) : 0,
      backtest_alpha_avg: backtest.alphaAvg,
      schools: theme.schools,
    });
  }

  // _meta
  const byAction: Record<RuleAction, number> = {
    fresh_buy: 0,
    add: 0,
    hold: 0,
    trim_25: 0,
    trim_50: 0,
    exit: 0,
  };
  for (const r of rules) byAction[r.action] += 1;
  const top = [...rules]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 10)
    .map((r) => ({ id: r.id, weight: r.weight, action: r.action }));
  const schools = new Set<string>();
  for (const r of rules) for (const s of r.schools ?? []) schools.add(s);
  const btContrib: Record<string, { xirr: number; alpha: number }> = {};
  if (summary) {
    for (const [fk, f] of Object.entries(summary.frameworks ?? {})) {
      btContrib[fk] = {
        xirr: f.xirr ?? 0,
        alpha: f.benchmark_vs_nifty50_xirr_delta ?? 0,
      };
    }
  }
  const meta: RuleLibraryMeta = {
    investors_processed: stalwarts.length,
    rules_by_action: byAction,
    top_rules_by_weight: top,
    schools_represented: [...schools].sort(),
    backtest_contribution: btContrib,
  };

  return {
    version,
    generated_at: new Date().toISOString(),
    rules,
    _meta: meta,
  };
}

export function writeCorpusLibrary(library: RuleLibrary, root = 'data/codex/synthesized'): string {
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const path = join(root, `v${library.version}.json`);
  writeFileSync(path, JSON.stringify(library, null, 2), 'utf-8');
  return path;
}
