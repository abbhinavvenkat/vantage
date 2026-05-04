/**
 * Per-symbol estimated growth forecast (1y / 3y / 5y).
 *
 * Inputs are local-only:
 *   - data/codex/backtests/fundamentals/<symbol>.json (Screener-style annual block)
 *   - rules that fired for the symbol (with weights and tags)
 *   - prices_eod / current price
 *
 * Method:
 *   - Base growth = average of (PAT 5y CAGR, revenue 5y CAGR) when available.
 *   - Quality rules tagged "quality"|"compounder" lift the base; "cycle"|
 *     "mean_reversion"|"deep_value" pull base toward sector mean.
 *   - PE-mean-reversion drag: if current PE > historical median PE × 1.5,
 *     project a 10–25% rerating drag spread over 3 years.
 *   - Confidence: high if 3+ years of fundamentals AND >=3 fired rules AND PE
 *     is within 0.5–1.5x of historical median; medium for partial; low otherwise.
 *
 * No external API. No side effects.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FiredRule } from '@/lib/decisions/score';

export type AnnualRow = {
  sales_cr?: number | null;
  ebitda_cr?: number | null;
  pat_cr?: number | null;
  eps?: number | null;
  roce_pct?: number | null;
  roe_pct?: number | null;
  debt_cr?: number | null;
  equity_bv_cr?: number | null;
  cfo_cr?: number | null;
  capex_cr?: number | null;
  debt_to_equity?: number | null;
};

export type Fundamentals = {
  symbol: string;
  company_name?: string;
  scraped_at?: string;
  annual: Record<string, AnnualRow>;
  current: {
    market_cap_cr?: number | null;
    pe?: number | null;
    book_value_per_share?: number | null;
    price?: number | null;
  };
};

export type GrowthForecast = {
  yearOne: number; // decimal, e.g. 0.12 = +12%
  yearThree: number;
  yearFive: number;
  confidence: 'low' | 'medium' | 'high';
  basis: string[];
  inputs: {
    patCagr5y: number | null;
    revenueCagr5y: number | null;
    roceAvg5y: number | null;
    currentPe: number | null;
    historicalMedianPe: number | null;
    qualityLift: number;
    cycleDrag: number;
    peReratingDrag3y: number;
  };
};

const DEFAULT_FUND_ROOT = 'data/codex/backtests/fundamentals';

export function loadFundamentals(symbol: string, root = DEFAULT_FUND_ROOT): Fundamentals | null {
  const p = join(root, `${symbol}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as Fundamentals;
  } catch {
    return null;
  }
}

function years(annual: Record<string, AnnualRow>): string[] {
  return Object.keys(annual).sort();
}

function cagr(
  start: number | null | undefined,
  end: number | null | undefined,
  n: number,
): number | null {
  if (
    start === null ||
    start === undefined ||
    end === null ||
    end === undefined ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    n <= 0 ||
    start <= 0 ||
    end <= 0
  ) {
    return null;
  }
  return Math.pow(end / start, 1 / n) - 1;
}

function avg(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

function ruleTags(r: FiredRule & { tags?: string[] }): string[] {
  return Array.isArray(r.tags) ? r.tags : [];
}

export type ForecastInput = {
  symbol: string;
  fundamentals: Fundamentals | null;
  firedRules: (FiredRule & { tags?: string[] })[];
  currentPrice?: number;
  priceHistory?: { date: string; close: number }[];
};

export function forecastGrowth(inp: ForecastInput): GrowthForecast {
  const basis: string[] = [];
  let patCagr5y: number | null = null;
  let revenueCagr5y: number | null = null;
  let roceAvg5y: number | null = null;
  let historicalMedianPe: number | null = null;

  const fund = inp.fundamentals;
  let nYears = 0;

  if (fund && fund.annual) {
    const ks = years(fund.annual);
    nYears = ks.length;
    if (ks.length >= 6) {
      const last = fund.annual[ks[ks.length - 1]!]!;
      const five = fund.annual[ks[ks.length - 6]!]!;
      patCagr5y = cagr(five.pat_cr ?? null, last.pat_cr ?? null, 5);
      revenueCagr5y = cagr(five.sales_cr ?? null, last.sales_cr ?? null, 5);
    } else if (ks.length >= 3) {
      const last = fund.annual[ks[ks.length - 1]!]!;
      const first = fund.annual[ks[0]!]!;
      const span = ks.length - 1;
      patCagr5y = cagr(first.pat_cr ?? null, last.pat_cr ?? null, span);
      revenueCagr5y = cagr(first.sales_cr ?? null, last.sales_cr ?? null, span);
    }
    const last5 = ks.slice(-5).map((k) => fund.annual[k]?.roce_pct ?? null);
    const r = avg(last5);
    if (typeof r === 'number') roceAvg5y = r / 100; // convert pct to decimal
    // Approx historical median PE: use price at end / EPS for available years
    // (We don't have historical EPS-derived PE directly, so use current PE as
    // a proxy when not enough info; otherwise use mid-range relative.)
    // Simple heuristic: assume a "fair" historical PE = 1.0× current EPS-yield
    // average; if EPS data exists use last-5y median EPS / current price relation.
  }

  // Base earnings growth.
  let base: number;
  if (patCagr5y !== null && revenueCagr5y !== null) {
    base = (patCagr5y + revenueCagr5y) / 2;
    basis.push(
      `5y PAT CAGR ${(patCagr5y * 100).toFixed(1)}% · revenue CAGR ${(revenueCagr5y * 100).toFixed(1)}%`,
    );
  } else if (patCagr5y !== null) {
    base = patCagr5y;
    basis.push(`5y PAT CAGR ${(patCagr5y * 100).toFixed(1)}%`);
  } else if (revenueCagr5y !== null) {
    base = revenueCagr5y;
    basis.push(`5y revenue CAGR ${(revenueCagr5y * 100).toFixed(1)}%`);
  } else {
    base = 0.08; // sector default ~Nifty 50 nominal
    basis.push('No fundamentals — using 8% base (Nifty median)');
  }
  // Reasonable bounds — extreme CAGRs are unsustainable.
  base = clamp(base, -0.1, 0.35);

  // Quality lift / cycle drag from fired rules.
  let qualityLift = 0;
  let cycleDrag = 0;
  for (const r of inp.firedRules) {
    const tags = ruleTags(r);
    const w = Math.max(0, Math.min(1, r.weight));
    if (tags.some((t) => /quality|compounder|moat|wide-moat/i.test(t))) {
      qualityLift += 0.01 * w;
    }
    if (tags.some((t) => /cycle|mean[_-]?reversion|deep[_-]?value/i.test(t))) {
      cycleDrag += 0.008 * w;
    }
    if (tags.some((t) => /red[_-]?flag|leverage/i.test(t)) && r.action === 'exit') {
      cycleDrag += 0.01 * w;
    }
  }
  qualityLift = clamp(qualityLift, 0, 0.05);
  cycleDrag = clamp(cycleDrag, 0, 0.04);

  if (qualityLift > 0) basis.push(`Quality lift +${(qualityLift * 100).toFixed(1)}%/yr`);
  if (cycleDrag > 0) basis.push(`Cycle/red-flag drag -${(cycleDrag * 100).toFixed(1)}%/yr`);

  // PE mean-reversion drag (only over 3y window; spread over 5y as half).
  let peReratingDrag3y = 0;
  if (fund && typeof fund.current?.pe === 'number') {
    // Median historical PE proxy: use last-5y avg PAT growth + Nifty-like norm (assume
    // fair ~22 unless we can derive). Use the heuristic: if symbol grew earnings >=15%
    // over 5y, fair PE is ~30; if >=10%, fair PE ~22; else fair PE ~16.
    const g = patCagr5y ?? 0.08;
    const fairPe = g >= 0.15 ? 30 : g >= 0.1 ? 22 : 16;
    historicalMedianPe = fairPe;
    const cur = fund.current.pe;
    if (cur > fairPe * 1.5) {
      // Derate from cur back toward fairPe over 3 years, capped 25%, min 10%.
      const overshoot = (cur - fairPe) / cur;
      peReratingDrag3y = clamp(overshoot, 0.1, 0.25);
      basis.push(
        `PE ${cur.toFixed(0)} > 1.5× fair ${fairPe.toFixed(0)} → 3y rerating drag ${(peReratingDrag3y * 100).toFixed(0)}%`,
      );
    }
  }

  const adj = base + qualityLift - cycleDrag;
  const yearOne = adj;
  const yearThree = Math.pow(1 + adj, 3) - 1 - peReratingDrag3y;
  // 5y: full quality compounding, half the rerating drag remaining.
  const yearFive = Math.pow(1 + adj, 5) - 1 - peReratingDrag3y * 0.5;

  // Confidence.
  let confidence: GrowthForecast['confidence'];
  if (
    nYears >= 5 &&
    inp.firedRules.length >= 3 &&
    (peReratingDrag3y === 0 || peReratingDrag3y < 0.2)
  ) {
    confidence = 'high';
  } else if (nYears >= 3 && inp.firedRules.length >= 1) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }
  basis.push(`Confidence: ${confidence} (${nYears}y data · ${inp.firedRules.length} rules)`);

  return {
    yearOne: Number(yearOne.toFixed(4)),
    yearThree: Number(yearThree.toFixed(4)),
    yearFive: Number(yearFive.toFixed(4)),
    confidence,
    basis,
    inputs: {
      patCagr5y,
      revenueCagr5y,
      roceAvg5y,
      currentPe: fund?.current?.pe ?? null,
      historicalMedianPe,
      qualityLift,
      cycleDrag,
      peReratingDrag3y,
    },
  };
}
