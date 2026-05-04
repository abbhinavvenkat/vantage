import type { Trade } from '@/lib/db/queries/trades';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { computeBenchmarkXirr } from '@/lib/analytics/benchmarkXirr';
import { tradesToCashflowsForSymbol } from '@/lib/analytics/symbolCashflows';

export type SymbolBenchmarkResult = {
  /** Annualised XIRR of the user's actual cashflows on this symbol. */
  actualXirr: number | null;
  /** Annualised XIRR if the same rupees had been deployed into the benchmark on the same dates. */
  niftyXirr: number | null;
  /** actualXirr − niftyXirr; null if either side null. */
  alpha: number | null;
  /** Terminal MV the user actually has (currentMv passed in). */
  actualEndValue: number;
  /**
   * Terminal value of the mirrored Nifty position on `terminalDate`.
   * = residual_units * currentNiftyClose
   */
  niftyEndValue: number;
  /** Sum of buy outflows (positive number = total invested ex-sells). */
  totalInvested: number;
};

/**
 * Compare the user's per-symbol track record against a same-rupee, same-dates
 * Nifty mirror.
 *
 * Math:
 *   - Actual XIRR uses raw buy/sell cashflows + a terminal MV cashflow
 *     (`currentSymbolMv`). For closed positions pass `currentSymbolMv = 0`;
 *     XIRR is then computed from the realised cashflows alone.
 *   - Nifty XIRR mirrors each cashflow onto units of the index at the
 *     contemporaneous close (forward-fill weekends), with sells modelled as a
 *     proportional reduction of accumulated units. Residual units are valued at
 *     `currentNiftyClose` on `today`.
 *   - `niftyEndValue` is the final positive mirrored cashflow (residual units ×
 *     currentNiftyClose), or 0 if the position is fully closed in the mirror.
 *
 * Returns nulls for either XIRR if there are insufficient flows / no
 * convergence rather than throwing.
 */
export function compareSymbolToNifty(
  symbolTrades: Trade[],
  symbol: string,
  currentSymbolMv: number,
  niftySeries: Map<string, number>,
  currentNiftyClose: number,
  today: string,
): SymbolBenchmarkResult {
  // Raw realised buy/sell cashflows ONLY (no terminal MV). The terminal MV
  // is appended below for the actual XIRR; the mirror computes its own
  // residual terminal value.
  const rawCashflows = tradesToCashflowsForSymbol(symbolTrades, symbol, 0, today);

  const totalInvested = rawCashflows.filter((c) => c.amount < 0).reduce((s, c) => s + -c.amount, 0);

  // Cashflows for the user's actual XIRR = raw + terminal MV (if open position).
  const actualCashflows: Cashflow[] = [...rawCashflows];
  if (currentSymbolMv > 0) {
    const existing = actualCashflows.find((c) => c.date === today);
    if (existing) existing.amount += currentSymbolMv;
    else actualCashflows.push({ date: today, amount: currentSymbolMv });
    actualCashflows.sort((a, b) => a.date.localeCompare(b.date));
  }

  let actualXirr: number | null = null;
  if (
    actualCashflows.length >= 2 &&
    actualCashflows.some((c) => c.amount < 0) &&
    actualCashflows.some((c) => c.amount > 0)
  ) {
    try {
      actualXirr = xirr(actualCashflows);
    } catch {
      actualXirr = null;
    }
  }

  // Build mirror from raw cashflows (no synthetic terminal row); the mirror
  // appends its own residual-units terminal value internally.
  const { niftyXirr, niftyEndValue } = computeNiftyMirror(
    rawCashflows,
    niftySeries,
    currentNiftyClose,
    today,
  );

  const alpha = actualXirr != null && niftyXirr != null ? actualXirr - niftyXirr : null;

  return {
    actualXirr,
    niftyXirr,
    alpha,
    actualEndValue: currentSymbolMv,
    niftyEndValue,
    totalInvested,
  };
}

/**
 * Replays the user's cashflows on the Nifty index. Returns the mirrored XIRR
 * and the residual terminal MV. Identical accumulation semantics to
 * `computeBenchmarkXirr`, but exposes the terminal value separately for the
 * "If I had bought Niftybees instead" stat tile.
 */
function computeNiftyMirror(
  rawCashflows: Cashflow[],
  niftySeries: Map<string, number>,
  currentNiftyClose: number,
  terminalDate: string,
): { niftyXirr: number | null; niftyEndValue: number } {
  // Compute residual units locally so we can return niftyEndValue alongside
  // the XIRR.
  const sorted = [...rawCashflows].sort((a, b) => a.date.localeCompare(b.date));
  let units = 0;
  for (const cf of sorted) {
    const close = closeOnOrAfter(cf.date, niftySeries);
    if (close == null || close <= 0) {
      return { niftyXirr: null, niftyEndValue: 0 };
    }
    if (cf.amount < 0) {
      units += -cf.amount / close;
    } else if (cf.amount > 0) {
      const currentMv = units * close;
      if (currentMv <= 0) continue;
      const sellFraction = Math.min(1, cf.amount / currentMv);
      units -= sellFraction * units;
    }
  }
  const niftyEndValue = units > 0 && currentNiftyClose > 0 ? units * currentNiftyClose : 0;

  let niftyXirr: number | null = null;
  if (sorted.length >= 1) {
    try {
      niftyXirr = computeBenchmarkXirr(sorted, niftySeries, currentNiftyClose, terminalDate);
    } catch {
      niftyXirr = null;
    }
  }

  return { niftyXirr, niftyEndValue };
}

function closeOnOrAfter(date: string, series: Map<string, number>): number | null {
  if (series.has(date)) return series.get(date)!;
  const keys = [...series.keys()].sort();
  for (const k of keys) {
    if (k >= date) return series.get(k)!;
  }
  return null;
}
