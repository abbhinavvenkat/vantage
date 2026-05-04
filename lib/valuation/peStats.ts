/**
 * Per-symbol valuation context — used by the score engine, the Compounder
 * Thesis Framework, and the per-stock detail page. Pure helpers, no I/O at
 * load (DB / fs reads happen behind the helper functions on demand).
 *
 * Pulls together:
 *   - Current PE  (from `fundamentals.current.pe`)
 *   - PEG          PE ÷ trailing 5y PAT-CAGR-percent
 *   - P/B          current price ÷ book value per share
 *   - Sector PE comparison      (current PE ÷ sector median PE)
 *   - Own historical PE  — daily trailing PE series, derived from EOD close ÷
 *     trailing EPS at each date. From that: 5y own median + 10y percentile.
 *   - Earnings yield vs. G-Sec  (1/PE − long-bond yield)
 *
 * History resolution: daily, using whatever EOD coverage `prices_eod` has.
 * If we only have ~6 years of close history we report "10y percentile" as
 * "available-history percentile" — the percentile value clamps to [0,1] so
 * downstream gates still work.
 */

import { sql } from 'drizzle-orm';

import type { Db } from '@/lib/db/client';
import { pricesEod } from '@/lib/db/schema';
import type { Fundamentals, AnnualRow } from '@/lib/decisions/growthForecast';

export const DEFAULT_GSEC_YIELD = 0.07; // 10y G-Sec — refresh quarterly via `data/refs/gsec_yield.json` once we wire that.

export type ValuationContext = {
  pe: number | null;
  pb: number | null;
  peg: number | null;
  /** Symbol's current PE divided by sector's median PE (e.g., 1.5 means 50% above sector). */
  peVsSectorMedian: number | null;
  /** Sector median PE used in the comparison. */
  peSectorMedian: number | null;
  /** Symbol's own 5y daily trailing-PE median. */
  pe5yMedian: number | null;
  /** Where the current PE sits in the symbol's own trailing-PE history (0..1, 1 = highest ever). */
  pe10yPercentile: number | null;
  /** Earnings yield (1/PE) minus G-Sec yield, in decimal (e.g., 0.02 = 200 bps premium). */
  earningsYieldMinusGsec: number | null;
};

/**
 * 5y compound annual growth of PAT, computed from the annual EPS column when
 * available, else from `pat_cr`. Returns decimal (e.g., 0.18 = +18% / yr) or
 * null if data is insufficient. Only positive growth produces a usable PEG;
 * declines map to null (PEG is undefined for negative growth in this codebase).
 */
function pat5yCagr(annual: Record<string, AnnualRow>): number | null {
  const ys = Object.keys(annual).sort();
  if (ys.length < 6) return null;
  const lastY = annual[ys[ys.length - 1]!];
  const fiveY = annual[ys[ys.length - 6]!];
  const startEps = fiveY?.eps ?? null;
  const endEps = lastY?.eps ?? null;
  if (typeof startEps === 'number' && typeof endEps === 'number' && startEps > 0 && endEps > 0) {
    return Math.pow(endEps / startEps, 1 / 5) - 1;
  }
  const startPat = fiveY?.pat_cr ?? null;
  const endPat = lastY?.pat_cr ?? null;
  if (typeof startPat === 'number' && typeof endPat === 'number' && startPat > 0 && endPat > 0) {
    return Math.pow(endPat / startPat, 1 / 5) - 1;
  }
  return null;
}

function peg(currentPe: number | null, growth: number | null): number | null {
  if (
    currentPe === null ||
    growth === null ||
    !Number.isFinite(currentPe) ||
    !Number.isFinite(growth) ||
    currentPe <= 0 ||
    growth <= 0
  ) {
    return null;
  }
  return currentPe / (growth * 100);
}

function pb(fund: Fundamentals): number | null {
  const price = fund.current?.price;
  const bvps = fund.current?.book_value_per_share;
  if (typeof price !== 'number' || typeof bvps !== 'number' || bvps <= 0) return null;
  return price / bvps;
}

/**
 * Build a daily trailing-PE series for a symbol over the last `lookbackYears`
 * years from `endDate`. For each EOD close date `d`, trailing-PE = close ÷
 * "best-known EPS as of d", where best-known is the EPS of the most recent
 * fully-reported FY whose period ends ≤ d. If a date precedes the earliest
 * reported FY, it's skipped.
 */
export function buildPeSeries(
  db: Db,
  symbol: string,
  fund: Fundamentals,
  endDate: string, // 'YYYY-MM-DD'
  lookbackYears = 10,
): { date: string; pe: number }[] {
  // EPS by Indian FY end (Mar 31 of YYYY+1 for "FYxxxx" labelled as starting year? Standard convention here:
  // "FY2024" means the year ending 31-Mar-2024 — based on the file structure observed). We treat each FY's
  // EPS as in effect from Apr 1 of that calendar year through Mar 31 of the next.
  const fyEndsByYear = new Map<number, number>(); // Mar-31-YYYY → eps
  for (const [k, row] of Object.entries(fund.annual)) {
    const m = /^FY(\d{4})$/.exec(k);
    if (!m) continue;
    const fyEndYear = Number(m[1]);
    if (typeof row.eps === 'number' && row.eps > 0) {
      fyEndsByYear.set(fyEndYear, row.eps);
    }
  }
  if (fyEndsByYear.size === 0) return [];

  const startDate = new Date(endDate);
  startDate.setFullYear(startDate.getFullYear() - lookbackYears);
  const startIso = startDate.toISOString().slice(0, 10);

  const rows = db
    .select({ date: pricesEod.date, close: pricesEod.close })
    .from(pricesEod)
    .where(
      sql`${pricesEod.symbol} = ${symbol} and ${pricesEod.date} between ${startIso} and ${endDate}`,
    )
    .all();

  const out: { date: string; pe: number }[] = [];
  for (const r of rows) {
    if (r.close == null || r.close <= 0) continue;
    // Determine the most recent FY end that has reported (Apr 1 of fy_end_year is the typical results date;
    // we'll use Mar 31 to be conservative — assume EPS becomes "known" after FY end).
    const dt = new Date(r.date);
    const month = dt.getUTCMonth(); // 0..11
    const year = dt.getUTCFullYear();
    // If we're past Mar 31 of `year`, the FY ending in `year` is the freshest. Otherwise the FY ending
    // in `year - 1` is the freshest.
    const trailingFy = month >= 3 ? year : year - 1;
    let eps: number | undefined;
    for (let y = trailingFy; y >= trailingFy - 2; y--) {
      const e = fyEndsByYear.get(y);
      if (typeof e === 'number') {
        eps = e;
        break;
      }
    }
    if (eps === undefined) continue;
    out.push({ date: r.date, pe: r.close / eps });
  }
  return out;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Returns the percentile rank (0..1) of `value` within the sorted distribution `xs`. */
function percentileRank(xs: number[], value: number): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  let lo = 0;
  for (const x of s) {
    if (x <= value) lo += 1;
    else break;
  }
  return lo / s.length;
}

export type PeHistoryStats = {
  pe5yMedian: number | null;
  pe10yPercentile: number | null;
  nSamples5y: number;
  nSamples10y: number;
};

export function computePeHistoryStats(
  series: { date: string; pe: number }[],
  currentPe: number | null,
  endDate: string,
): PeHistoryStats {
  const cutoff5y = new Date(endDate);
  cutoff5y.setFullYear(cutoff5y.getFullYear() - 5);
  const cutoff5yIso = cutoff5y.toISOString().slice(0, 10);
  const last5y = series.filter((s) => s.date >= cutoff5yIso).map((s) => s.pe);
  const last10y = series.map((s) => s.pe);
  return {
    pe5yMedian: median(last5y),
    pe10yPercentile:
      currentPe !== null && Number.isFinite(currentPe) ? percentileRank(last10y, currentPe) : null,
    nSamples5y: last5y.length,
    nSamples10y: last10y.length,
  };
}

/**
 * Build the full ValuationContext for a symbol. Sector medians are passed in
 * (caller computes them once across the universe).
 */
export function buildValuationContext({
  db,
  symbol,
  fund,
  sectorMedian,
  endDate,
  gsecYield = DEFAULT_GSEC_YIELD,
}: {
  db: Db;
  symbol: string;
  fund: Fundamentals | null;
  sectorMedian: number | null;
  endDate: string;
  gsecYield?: number;
}): ValuationContext {
  if (!fund) {
    return {
      pe: null,
      pb: null,
      peg: null,
      peVsSectorMedian: null,
      peSectorMedian: sectorMedian,
      pe5yMedian: null,
      pe10yPercentile: null,
      earningsYieldMinusGsec: null,
    };
  }
  const pe = typeof fund.current?.pe === 'number' ? fund.current.pe : null;
  const series = buildPeSeries(db, symbol, fund, endDate, 10);
  const stats = computePeHistoryStats(series, pe, endDate);
  const growth = pat5yCagr(fund.annual);
  const earningsYield = pe !== null && pe > 0 ? 1 / pe : null;
  return {
    pe,
    pb: pb(fund),
    peg: peg(pe, growth),
    peVsSectorMedian:
      pe !== null && sectorMedian !== null && sectorMedian > 0 ? pe / sectorMedian : null,
    peSectorMedian: sectorMedian,
    pe5yMedian: stats.pe5yMedian,
    pe10yPercentile: stats.pe10yPercentile,
    earningsYieldMinusGsec: earningsYield !== null ? earningsYield - gsecYield : null,
  };
}
