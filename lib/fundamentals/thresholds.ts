/**
 * Mechanical verdict mapping per fundamental metric.
 *
 * Each metric has a `direction`:
 *   - "higher_is_better" — green when value >= greenAt; red when value < redAt.
 *   - "lower_is_better"  — green when value <= greenAt; red when value > redAt.
 *
 * Thresholds are taken from the curated stalwart-profile bands in
 * data/investor_stalwarts/* and the cross-school synthesis in
 * data/codex/synthesized/consensus.md (see also stalwartCommentary.ts which
 * cites the source quote behind each band).
 *
 * No external API. No I/O. Pure function.
 */

export type Verdict = 'green' | 'amber' | 'red' | 'unknown';

export type MetricId =
  | 'revenue'
  | 'pat'
  | 'roce'
  | 'roe'
  | 'ebitda_margin'
  | 'debt_to_equity'
  | 'fcf_to_pat'
  | 'pe'
  | 'pb'
  | 'dividend_yield';

export type MetricDirection = 'higher_is_better' | 'lower_is_better';

export type MetricThreshold = {
  id: MetricId;
  label: string;
  /** human-readable unit suffix (`%`, `×`, `cr`) */
  unit: '%' | '×' | 'cr' | '' | 'INR';
  direction: MetricDirection;
  /** ≥ for higher_is_better; ≤ for lower_is_better */
  greenAt: number;
  /** the boundary between amber and red */
  redAt: number;
  /** short human description of how to read this metric */
  description: string;
};

export const METRIC_IDS: MetricId[] = [
  'revenue',
  'pat',
  'roce',
  'roe',
  'ebitda_margin',
  'debt_to_equity',
  'fcf_to_pat',
  'pe',
  'pb',
  'dividend_yield',
];

export const METRIC_THRESHOLDS: Record<MetricId, MetricThreshold> = {
  revenue: {
    id: 'revenue',
    label: 'Revenue',
    unit: 'cr',
    direction: 'higher_is_better',
    // 5y CAGR bands: green >= 10%, amber 5-10%, red < 5%
    greenAt: 0.1,
    redAt: 0.05,
    description: '5y revenue CAGR — proxy for top-line durability.',
  },
  pat: {
    id: 'pat',
    label: 'PAT',
    unit: 'cr',
    direction: 'higher_is_better',
    // 5y CAGR bands: green >= 12%, amber 5-12%, red < 5%
    greenAt: 0.12,
    redAt: 0.05,
    description: '5y profit CAGR — bottom-line compounding.',
  },
  roce: {
    id: 'roce',
    label: 'ROCE',
    unit: '%',
    direction: 'higher_is_better',
    greenAt: 18,
    redAt: 12,
    description:
      'Return on capital employed. Mukherjea/Akre gate quality compounders at sustained 18%+.',
  },
  roe: {
    id: 'roe',
    label: 'ROE',
    unit: '%',
    direction: 'higher_is_better',
    greenAt: 15,
    redAt: 10,
    description:
      'Return on equity. Buffett looks for 15%+ as evidence of an enduring earnings-power moat.',
  },
  ebitda_margin: {
    id: 'ebitda_margin',
    label: 'EBITDA margin',
    unit: '%',
    direction: 'higher_is_better',
    greenAt: 0.2,
    redAt: 0.1,
    description: 'Stable/expanding margins are evidence of pricing power (Akre).',
  },
  debt_to_equity: {
    id: 'debt_to_equity',
    label: 'Debt / Equity',
    unit: '×',
    direction: 'lower_is_better',
    greenAt: 0.5,
    redAt: 1.5,
    description: 'Buffett refuses leverage that can ruin the business in a bad year.',
  },
  fcf_to_pat: {
    id: 'fcf_to_pat',
    label: 'FCF / PAT',
    unit: '×',
    direction: 'higher_is_better',
    greenAt: 0.7,
    redAt: 0.4,
    description: 'Persistent < 0.7 means accounting earnings exceed cash earnings (Damodaran).',
  },
  pe: {
    id: 'pe',
    label: 'P/E',
    unit: '×',
    direction: 'lower_is_better',
    greenAt: 22,
    redAt: 35,
    description: 'Static cap on multiple paid; Marks treats >1.5× hist median as momentum risk.',
  },
  pb: {
    id: 'pb',
    label: 'P/B',
    unit: '×',
    direction: 'lower_is_better',
    greenAt: 3,
    redAt: 6,
    description: "Graham's defensive ceiling at 1.5× book is the cleanest historical anchor.",
  },
  dividend_yield: {
    id: 'dividend_yield',
    label: 'Dividend yield',
    unit: '%',
    direction: 'higher_is_better',
    greenAt: 0.015,
    redAt: 0.005,
    description: 'Lynch treats dividend yield as a tie-breaker, not a thesis.',
  },
};

export type ClassifiedMetric = {
  id: MetricId;
  value: number | null;
  verdict: Verdict;
};

function isNumeric(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function classifyMetric(id: MetricId, value: number | null | undefined): ClassifiedMetric {
  const t = METRIC_THRESHOLDS[id];
  if (!isNumeric(value)) return { id, value: null, verdict: 'unknown' };

  if (t.direction === 'higher_is_better') {
    if (value >= t.greenAt) return { id, value, verdict: 'green' };
    if (value >= t.redAt) return { id, value, verdict: 'amber' };
    return { id, value, verdict: 'red' };
  }
  // lower_is_better
  if (value <= t.greenAt) return { id, value, verdict: 'green' };
  if (value <= t.redAt) return { id, value, verdict: 'amber' };
  return { id, value, verdict: 'red' };
}
