import { xirr, type Cashflow } from '@/lib/analytics/xirr';

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
