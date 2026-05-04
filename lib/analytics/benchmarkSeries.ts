import type { Cashflow } from '@/lib/analytics/xirr';
import { qtyOnDate, type QtyPoint, type QtyTimeline } from '@/lib/analytics/runningPositions';

export type ReturnPoint = { date: string; returnPct: number; mv?: number; costBasis?: number };

/**
 * Find the close on or after `date` from a date→close map.
 * Forward-fills weekends/holidays to the next trading day.
 */
function closeOnOrAfter(date: string, series: Map<string, number>): number | null {
  if (series.has(date)) return series.get(date)!;
  const keys = [...series.keys()].sort();
  for (const k of keys) {
    if (k >= date) return series.get(k)!;
  }
  return null;
}

/**
 * Find the close on or before `date` (used for terminal-value lookups).
 */
function closeOnOrBefore(date: string, series: Map<string, number>): number | null {
  if (series.has(date)) return series.get(date)!;
  const keys = [...series.keys()].sort();
  let best: string | null = null;
  for (const k of keys) {
    if (k <= date) best = k;
    else break;
  }
  return best != null ? (series.get(best) ?? null) : null;
}

/** Sorted-array binary search for the largest key ≤ `date`. */
function priceOnOrBefore(
  sortedKeys: string[],
  series: Map<string, number>,
  date: string,
): number | null {
  if (sortedKeys.length === 0) return null;
  let lo = 0;
  let hi = sortedKeys.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sortedKeys[mid]! <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best === -1) return null;
  return series.get(sortedKeys[best]!) ?? null;
}

export type PortfolioSeriesOptions = {
  /** Per-symbol date→close maps from `prices_eod`. Forward-filled when missing. */
  priceHistories?: Map<string, Map<string, number>>;
  /** Per-symbol qty timeline from `runningOpenPositionsBySymbol`. */
  qtyTimelines?: QtyTimeline;
  /** Add monthly samples between cashflow dates for a smooth chart. Default true. */
  monthlySamples?: boolean;
};

/**
 * Build a cumulative-return time series for the user's portfolio.
 *
 * If `priceHistories` and `qtyTimelines` are provided, MV at each emitted date
 * D is computed properly:
 *
 *   MV(D)        = Σ qty_at(symbol, D) × close_on_or_before(symbol, D)
 *   costBasis(D) = Σ buys − Σ sells, summed over cashflows ≤ D
 *   returnPct(D) = (MV(D) + cumulative_inflows_up_to_D) / cumulative_outflows_up_to_D − 1
 *
 * Without histories, falls back to the legacy "approximate MV = net invested"
 * behaviour (which yields a flat 0% line until the terminal point).
 *
 * Emits one point per cashflow date plus monthly samples (when enabled) for a
 * smooth chart, plus a terminal point pinned to `currentMv`.
 */
export function buildPortfolioReturnSeries(
  cashflows: Cashflow[],
  currentMv: number,
  terminalDate: string,
  opts: PortfolioSeriesOptions = {},
): ReturnPoint[] {
  if (cashflows.length === 0) return [];
  const sorted = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));

  const hasHistory =
    opts.priceHistories != null &&
    opts.qtyTimelines != null &&
    opts.priceHistories.size > 0 &&
    opts.qtyTimelines.size > 0;

  // Pre-sort each price-history map's keys once for fast on-or-before lookups.
  const priceKeysBySymbol = new Map<string, string[]>();
  if (hasHistory) {
    for (const [sym, hist] of opts.priceHistories!) {
      priceKeysBySymbol.set(sym, [...hist.keys()].sort());
    }
  }

  const monthlySamples = opts.monthlySamples ?? true;

  // Build the set of dates at which we want to emit a point.
  const dateSet = new Set<string>();
  for (const cf of sorted) dateSet.add(cf.date);
  dateSet.add(terminalDate);
  if (monthlySamples && hasHistory) {
    const start = sorted[0]!.date;
    // Emit ~1 sample per month between start and terminalDate (1st of each month).
    const startTs = Date.parse(`${start}T00:00:00Z`);
    const endTs = Date.parse(`${terminalDate}T00:00:00Z`);
    if (Number.isFinite(startTs) && Number.isFinite(endTs) && endTs > startTs) {
      const startD = new Date(startTs);
      let y = startD.getUTCFullYear();
      let m = startD.getUTCMonth();
      // Step to the next month-start after `start`.
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      while (true) {
        const sample = new Date(Date.UTC(y, m, 1));
        if (sample.getTime() >= endTs) break;
        if (sample.getTime() > startTs) dateSet.add(sample.toISOString().slice(0, 10));
        m += 1;
        if (m > 11) {
          m = 0;
          y += 1;
        }
      }
    }
  }
  const allDates = [...dateSet].sort();

  // Pre-compute cumulative inflows/outflows by walking sorted cashflows.
  const cfByDate = new Map<string, number>();
  for (const cf of sorted) {
    cfByDate.set(cf.date, (cfByDate.get(cf.date) ?? 0) + cf.amount);
  }

  // For each emitted date D, compute MV via histories if available.
  const computeMv = (date: string): number | null => {
    if (!hasHistory) return null;
    let mv = 0;
    for (const [symbol, timeline] of opts.qtyTimelines!) {
      const q = qtyOnDate(timeline, date);
      if (q <= 0) continue;
      const hist = opts.priceHistories!.get(symbol);
      const keys = priceKeysBySymbol.get(symbol);
      if (!hist || !keys || keys.length === 0) {
        // No price history for this symbol → can't MTM; treat as 0 contribution
        // here. The terminal point will use `currentMv` to fix the final value.
        continue;
      }
      const px = priceOnOrBefore(keys, hist, date);
      if (px == null) continue;
      mv += q * px;
    }
    return mv;
  };

  let outflows = 0;
  let inflows = 0;
  const points: ReturnPoint[] = [];
  let cfIdx = 0;

  for (const date of allDates) {
    // Apply all cashflows on or before `date` that haven't been applied yet.
    while (cfIdx < sorted.length && sorted[cfIdx]!.date <= date) {
      const a = sorted[cfIdx]!.amount;
      if (a < 0) outflows += -a;
      else if (a > 0) inflows += a;
      cfIdx++;
    }

    let mv: number;
    if (date === terminalDate) {
      // Pin the terminal point to the live currentMv (most reliable number we
      // have). Avoids drift from stale or missing closes on the literal today.
      mv = currentMv;
    } else if (hasHistory) {
      const m = computeMv(date);
      mv = m == null ? Math.max(0, outflows - inflows) : m;
    } else {
      // Legacy approximation: MV = net invested → trace ≈ 0% intermediate return.
      mv = Math.max(0, outflows - inflows);
    }

    const costBasis = Math.max(0, outflows - inflows);
    const ret = outflows > 0 ? (mv + inflows) / outflows - 1 : 0;
    points.push({ date, returnPct: ret, mv, costBasis });
  }

  // Filter out leading dates with zero outflows (return is meaningless).
  return points.filter((p, i) => {
    // keep terminal regardless
    if (p.date === terminalDate) return true;
    // drop any date that comes before the first cashflow date — shouldn't happen.
    if (p.date < sorted[0]!.date) return false;
    // Always keep cashflow dates; for synthetic samples, keep only when at least
    // one outflow has happened by then.
    if (cfByDate.has(p.date)) return true;
    // For monthly samples between cashflows: include only if any cashflow ≤ p.date exists.
    return p.date >= sorted[0]!.date;
  });
}

/**
 * Build a cumulative-return time series for a benchmark, mirroring the
 * portfolio's cashflows onto the index using the same units-accumulation
 * logic as `computeBenchmarkXirr`.
 *
 * At each cashflow date and at `terminalDate`, compute:
 *   running_return = (units * close_at_date + cumulative_inflows) / cumulative_outflows − 1
 *
 * Returns one point per unique cashflow date plus the terminal point.
 * Throws if the series has no close at or after the first cashflow date.
 */
export function buildBenchmarkReturnSeries(
  cashflows: Cashflow[],
  benchmarkSeries: Map<string, number>,
  terminalDate: string,
  currentClose: number,
): ReturnPoint[] {
  if (cashflows.length === 0) return [];
  const sorted = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));

  let units = 0;
  let outflows = 0;
  let inflows = 0;
  const points: ReturnPoint[] = [];

  for (const cf of sorted) {
    const close = closeOnOrAfter(cf.date, benchmarkSeries);
    if (close == null || close <= 0) {
      throw new Error(`buildBenchmarkReturnSeries: no benchmark close at or after ${cf.date}`);
    }
    if (cf.amount < 0) {
      const buyAmount = -cf.amount;
      units += buyAmount / close;
      outflows += buyAmount;
    } else if (cf.amount > 0) {
      const currentMv = units * close;
      if (currentMv > 0) {
        const sellFraction = Math.min(1, cf.amount / currentMv);
        const sellAmount = sellFraction * currentMv;
        units -= sellFraction * units;
        inflows += sellAmount;
      }
      // If no position to sell, skip; do not fabricate units.
    }
    const mv = units * close;
    const ret = outflows > 0 ? (mv + inflows) / outflows - 1 : 0;
    points.push({ date: cf.date, returnPct: ret });
  }

  // Terminal point at currentClose (≈ today).
  if (outflows > 0) {
    const finalClose =
      currentClose > 0 ? currentClose : (closeOnOrBefore(terminalDate, benchmarkSeries) ?? 0);
    if (finalClose > 0) {
      const mv = units * finalClose;
      const ret = (mv + inflows) / outflows - 1;
      if (points.length === 0 || points[points.length - 1]!.date !== terminalDate) {
        points.push({ date: terminalDate, returnPct: ret });
      } else {
        points[points.length - 1] = { date: terminalDate, returnPct: ret };
      }
    }
  }
  return points;
}

// Re-export for downstream callers that want the type.
export type { QtyPoint, QtyTimeline };
