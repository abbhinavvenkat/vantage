import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { windowXirr } from '@/lib/analytics/windowXirr';

/**
 * Returns the close-on-or-after `date` from a date→close map.
 * Used to forward-fill weekends/holidays to the next trading day.
 */
function closeOnOrAfter(date: string, series: Map<string, number>): number | null {
  if (series.has(date)) return series.get(date)!;
  // Linear scan over sorted keys; series is small (≤ ~5000 entries for 20y EOD).
  const keys = [...series.keys()].sort();
  for (const k of keys) {
    if (k >= date) return series.get(k)!;
  }
  return null;
}

/**
 * Mirror a portfolio's cashflows onto a hypothetical Nifty 50 position and compute XIRR.
 *
 * Semantics:
 *   - Outflow (amount < 0): "buy" |amount| / nifty_close_on_D units. Units accumulate.
 *   - Inflow  (amount > 0): "sell" units proportional to current MV at index_close_on_D.
 *                           Specifically: sell_fraction = amount / current_mv, capped at 1.
 *                           If sell_fraction > 1, we cap (cannot sell more than we own); the
 *                           extra inflow is dropped from the mirror — same-rupee benchmark
 *                           comparisons should not over-state index returns.
 *   - At terminalDate, residual units * currentNiftyClose is the final positive cashflow.
 *
 * Returns the annualised XIRR of the mirrored cashflows.
 */
export function computeBenchmarkXirr(
  cashflows: Cashflow[],
  niftySeries: Map<string, number>,
  currentNiftyClose: number,
  terminalDate: string,
): number {
  if (cashflows.length === 0) {
    throw new Error('computeBenchmarkXirr: no cashflows provided');
  }

  const sorted = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;
  const mirrored: Cashflow[] = [];

  for (const cf of sorted) {
    const close = closeOnOrAfter(cf.date, niftySeries);
    if (close == null || close <= 0) {
      throw new Error(
        `computeBenchmarkXirr: no Nifty close at or after ${cf.date} (cashflow ${cf.amount})`,
      );
    }

    if (cf.amount < 0) {
      const buyAmount = -cf.amount;
      const buyUnits = buyAmount / close;
      units += buyUnits;
      mirrored.push({ date: cf.date, amount: cf.amount });
    } else if (cf.amount > 0) {
      const currentMv = units * close;
      if (currentMv <= 0) {
        // Inflow with no position to sell from — skip rather than fabricate units.
        continue;
      }
      const sellFraction = Math.min(1, cf.amount / currentMv);
      const sellAmount = sellFraction * currentMv;
      units -= sellFraction * units;
      mirrored.push({ date: cf.date, amount: sellAmount });
    }
  }

  if (units > 0 && currentNiftyClose > 0) {
    mirrored.push({ date: terminalDate, amount: units * currentNiftyClose });
  }

  if (mirrored.length < 2) {
    throw new Error('computeBenchmarkXirr: fewer than 2 mirrored cashflows; cannot compute XIRR');
  }

  return xirr(mirrored);
}

/**
 * Mirror cashflows onto a benchmark series and report the residual units +
 * mirrored cashflows AT a window-start anchor (`asOf`). Used to build a
 * window XIRR for the benchmark: the units owned at `asOf` × close(asOf)
 * becomes the synthetic "buy at window start", and any cashflows after
 * `asOf` are mirrored to be added to the window XIRR series by the caller.
 *
 * Returns null if the benchmark series has no close at-or-before `asOf`
 * (window start before the index history begins).
 */
export function benchmarkUnitsOnDate(
  cashflows: Cashflow[],
  series: Map<string, number>,
  asOf: string,
): { units: number; closeAtAsOf: number } | null {
  const sorted = [...cashflows].sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;

  for (const cf of sorted) {
    if (cf.date > asOf) break;
    const close = closeOnOrAfter(cf.date, series);
    if (close == null || close <= 0) continue;
    if (cf.amount < 0) {
      units += -cf.amount / close;
    } else if (cf.amount > 0) {
      const currentMv = units * close;
      if (currentMv <= 0) continue;
      const sellFraction = Math.min(1, cf.amount / currentMv);
      units -= sellFraction * units;
    }
  }

  // Use the close ON or BEFORE `asOf` to value the position at the window
  // start (forward-looking lookup would price weekend window-starts at the
  // following Monday's close, biasing the anchor).
  let closeAtAsOf = 0;
  if (series.has(asOf)) {
    closeAtAsOf = series.get(asOf) ?? 0;
  } else {
    const keys = [...series.keys()].sort();
    let best: string | null = null;
    for (const k of keys) {
      if (k <= asOf) best = k;
      else break;
    }
    if (best != null) closeAtAsOf = series.get(best) ?? 0;
  }
  if (closeAtAsOf <= 0) return null;
  return { units, closeAtAsOf };
}

/**
 * Window XIRR for a benchmark. Mirrors the portfolio's pre-window cashflows
 * onto the index to find the benchmark units owned at `startDate`, anchors
 * those units × close(startDate) as the synthetic "buy at window start",
 * mirrors in-window cashflows, and values residual units at `currentClose`.
 */
export function computeBenchmarkWindowXirr(input: {
  cashflows: Cashflow[];
  series: Map<string, number>;
  startDate: string;
  endDate: string;
  currentClose: number;
}): number | null {
  const { cashflows, series, startDate, endDate, currentClose } = input;
  if (currentClose <= 0) return null;

  const opening = benchmarkUnitsOnDate(cashflows, series, startDate);
  if (!opening) return null;

  let units = opening.units;
  const startMv = units * opening.closeAtAsOf;

  const inWindow = [...cashflows]
    .filter((cf) => cf.date > startDate && cf.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));

  const mirrored: Cashflow[] = [];
  for (const cf of inWindow) {
    const close = closeOnOrAfter(cf.date, series);
    if (close == null || close <= 0) continue;
    if (cf.amount < 0) {
      const buyAmount = -cf.amount;
      units += buyAmount / close;
      mirrored.push({ date: cf.date, amount: cf.amount });
    } else if (cf.amount > 0) {
      const currentMv = units * close;
      if (currentMv <= 0) continue;
      const sellFraction = Math.min(1, cf.amount / currentMv);
      const sellAmount = sellFraction * currentMv;
      units -= sellFraction * units;
      mirrored.push({ date: cf.date, amount: sellAmount });
    }
  }

  const endMv = units * currentClose;
  return windowXirr({ cashflows: mirrored, startDate, startMv, endDate, endMv });
}
