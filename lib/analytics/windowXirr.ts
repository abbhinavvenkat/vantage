import { xirr, type Cashflow } from '@/lib/analytics/xirr';

export type WindowXirrInput = {
  cashflows: Cashflow[];
  startDate: string;
  startMv: number;
  endDate: string;
  endMv: number;
};

/**
 * Money-weighted XIRR over an arbitrary [startDate, endDate] window.
 *
 * Anchors the window with a synthetic "buy" of `startMv` at `startDate`
 * (representing capital already deployed at window start) and a synthetic
 * "sell" of `endMv` at `endDate`. In-window cashflows are kept; cashflows
 * outside the window are dropped. Returns null when the inputs cannot
 * support an XIRR computation (e.g. no capital deployed, or solver fails).
 */
export function windowXirr(input: WindowXirrInput): number | null {
  const { cashflows, startDate, startMv, endDate, endMv } = input;

  // Boundary policy: cashflows ON `startDate` are assumed to be already
  // reflected in `startMv` (which is built from a running-position timeline
  // whose points are post-event qty). Including them again would double-count.
  // Hence strict `>` on the left, inclusive `<=` on the right.
  const inWindow = cashflows.filter((cf) => cf.date > startDate && cf.date <= endDate);

  const series: Cashflow[] = [];
  if (startMv > 0) series.push({ date: startDate, amount: -startMv });
  series.push(...inWindow);
  if (endMv > 0) series.push({ date: endDate, amount: endMv });

  if (series.length < 2) return null;

  const hasNeg = series.some((cf) => cf.amount < 0);
  const hasPos = series.some((cf) => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  try {
    return xirr(series);
  } catch {
    return null;
  }
}
