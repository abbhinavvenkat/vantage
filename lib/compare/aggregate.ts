import type { OpenPosition } from '@/lib/analytics/fifoHoldings';
import type { LatestPrice, SymbolStats } from '@/lib/db/queries/prices';
import type { ARSummary, ConcallDigest, ThesisStressTest } from '@/lib/research/loadOutputs';

export const MAX_COMPARE_SYMBOLS = 5;
export const MIN_COMPARE_SYMBOLS = 2;

export type CompareInputs = {
  symbol: string;
  sector: string;
  inPortfolio: boolean;
  inWatchlist: boolean;
  position: OpenPosition | null;
  latestPrice: LatestPrice | null;
  stats: SymbolStats | null;
  arSummary: ARSummary | null;
  concall: ConcallDigest | null;
  stressTest: ThesisStressTest | null;
  /** ISO date string used for "today" — typically the latest price date. */
  asOfDate: string;
};

export type CompareKeyNumber = {
  key: string;
  label: string;
  value: number | null;
};

export type ComparePosition = {
  qty: number;
  avgCost: number;
  costBasis: number;
  marketValue: number | null;
  unrealizedPnl: number | null;
  pctReturn: number | null;
  /** Calendar days from first buy to asOfDate, or null if either is missing. */
  holdingPeriodDays: number | null;
  firstBuyDate: string;
};

export type ComparePrice = {
  cmp: number | null;
  priceDate: string | null;
  high52w: number | null;
  low52w: number | null;
  /** (cmp - high52w) / high52w; negative numbers mean below the high. Null if unavailable. */
  distanceFromHighPct: number | null;
  avgVolume30d: number | null;
};

export type CompareConcall = {
  fq: string;
  revenueGrowthYoy: number | null;
  ebitdaMargin: number | null;
  qualitative: string | null;
  managementToneScore: number | null;
};

export type CompareStressTest = {
  verdict: 'intact' | 'watch' | 'weakened' | 'broken';
  runAt: string;
  rationaleMd: string;
};

export type CompareColumn = {
  symbol: string;
  sector: string;
  inPortfolio: boolean;
  inWatchlist: boolean;
  price: ComparePrice;
  position: ComparePosition | null;
  /** AR-summary key_numbers, surfaced as a uniform list. Empty when no AR data. */
  fundamentals: CompareKeyNumber[];
  /** FY label for the AR summary that fed `fundamentals`, or null if none. */
  fundamentalsFy: string | null;
  concall: CompareConcall | null;
  stressTest: CompareStressTest | null;
};

const FUNDAMENTAL_LABELS: Record<string, string> = {
  revenue: 'Revenue',
  ebitda_margin: 'EBITDA margin',
  roce: 'ROCE',
  fcf: 'FCF',
  net_debt: 'Net debt',
};

function holdingPeriodDays(firstBuyDate: string | null, asOfDate: string): number | null {
  if (!firstBuyDate) return null;
  const start = Date.parse(firstBuyDate);
  const end = Date.parse(asOfDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  const days = Math.floor((end - start) / 86_400_000);
  return days < 0 ? 0 : days;
}

function readToneScore(tone: ConcallDigest['management_tone']): number | null {
  if (!tone) return null;
  const t = tone as Record<string, unknown>;
  const v1 = t['score_-2_to_+2'];
  if (typeof v1 === 'number') return v1;
  const v2 = t['score_2_to_2'];
  if (typeof v2 === 'number') return v2;
  return null;
}

function buildFundamentals(ar: ARSummary | null): {
  rows: CompareKeyNumber[];
  fy: string | null;
} {
  if (!ar) return { rows: [], fy: null };
  const numbers = ar.key_numbers ?? {};
  const rows: CompareKeyNumber[] = [];
  // Preferred ordering first, then any extras the skill emitted.
  const preferred = ['revenue', 'ebitda_margin', 'roce', 'fcf', 'net_debt'];
  for (const k of preferred) {
    if (k in numbers) {
      rows.push({
        key: k,
        label: FUNDAMENTAL_LABELS[k] ?? k,
        value: numbers[k] ?? null,
      });
    }
  }
  for (const [k, v] of Object.entries(numbers)) {
    if (preferred.includes(k)) continue;
    rows.push({ key: k, label: FUNDAMENTAL_LABELS[k] ?? k, value: v ?? null });
  }
  return { rows, fy: ar.fy };
}

export function buildCompareColumn(input: CompareInputs): CompareColumn {
  const cmp = input.latestPrice?.close ?? null;
  const high52w = input.stats?.high52w ?? null;
  const distanceFromHighPct =
    cmp != null && high52w != null && high52w > 0 ? (cmp - high52w) / high52w : null;

  const price: ComparePrice = {
    cmp,
    priceDate: input.latestPrice?.date ?? null,
    high52w,
    low52w: input.stats?.low52w ?? null,
    distanceFromHighPct,
    avgVolume30d: input.stats?.avgVolume30d ?? null,
  };

  let position: ComparePosition | null = null;
  if (input.position) {
    const p = input.position;
    const marketValue = cmp != null ? cmp * p.qty : null;
    const unrealizedPnl = marketValue != null ? marketValue - p.costBasis : null;
    const pctReturn =
      unrealizedPnl != null && p.costBasis > 0 ? (unrealizedPnl / p.costBasis) * 100 : null;
    position = {
      qty: p.qty,
      avgCost: p.avgCost,
      costBasis: p.costBasis,
      marketValue,
      unrealizedPnl,
      pctReturn,
      holdingPeriodDays: holdingPeriodDays(p.firstBuyDate, input.asOfDate),
      firstBuyDate: p.firstBuyDate,
    };
  }

  const fundamentals = buildFundamentals(input.arSummary);

  let concall: CompareConcall | null = null;
  if (input.concall) {
    const c = input.concall;
    concall = {
      fq: c.fq,
      revenueGrowthYoy: c.guidance?.revenue_growth_yoy ?? null,
      ebitdaMargin: c.guidance?.ebitda_margin ?? null,
      qualitative: c.guidance?.qualitative ?? null,
      managementToneScore: readToneScore(c.management_tone),
    };
  }

  const stressTest: CompareStressTest | null = input.stressTest
    ? {
        verdict: input.stressTest.verdict,
        runAt: input.stressTest.run_at,
        rationaleMd: input.stressTest.verdict_rationale_md ?? '',
      }
    : null;

  return {
    symbol: input.symbol,
    sector: input.sector,
    inPortfolio: input.inPortfolio,
    inWatchlist: input.inWatchlist,
    price,
    position,
    fundamentals: fundamentals.rows,
    fundamentalsFy: fundamentals.fy,
    concall,
    stressTest,
  };
}

/**
 * Parse a comma-separated `?symbols=` query value into a clean, deduped, uppercase list,
 * capped at MAX_COMPARE_SYMBOLS. Returns `[]` on empty input.
 */
export function parseSymbolsParam(raw: string | string[] | undefined): string[] {
  if (raw == null) return [];
  const flat = Array.isArray(raw) ? raw.join(',') : raw;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of flat.split(',')) {
    const s = piece.trim().toUpperCase();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= MAX_COMPARE_SYMBOLS) break;
  }
  return out;
}
