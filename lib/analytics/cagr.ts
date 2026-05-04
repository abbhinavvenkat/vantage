import type { Cashflow } from '@/lib/analytics/xirr';

const DAYS_PER_YEAR = 365;

/**
 * Plain CAGR: (endValue/startValue)^(1/years) − 1.
 * Returns null if startValue ≤ 0 or years ≤ 0.
 */
export function cagr(startValue: number, endValue: number, years: number): number | null {
  if (!Number.isFinite(startValue) || !Number.isFinite(endValue) || !Number.isFinite(years))
    return null;
  if (startValue <= 0 || years <= 0) return null;
  if (endValue <= 0) return null;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

function yearsBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return (b - a) / (DAYS_PER_YEAR * 86_400_000);
}

/**
 * Net-deployed CAGR — the simplest annualised return that matches user intuition
 * for a portfolio with intermediate buys/sells/dividends:
 *
 *   ((currentMv + dividendsReceived) / netDeployed)^(1 / years) − 1
 *
 * where:
 *   netDeployed = total_outflows − non_dividend_inflows  (i.e., gross_buys − gross_sells)
 *   dividendsReceived = inflows that are dividend cashflows (kept as a "return", not a refund)
 *   years           = time from first outflow → today
 *
 * Intuition: "I have X rupees of net capital tied up; it grew to Y in Z years;
 * the annualised compounded rate is CAGR". Since sells return capital that's
 * usually recycled into other positions, treating gross_buys as the denominator
 * (the previous behaviour) double-counts and depresses the rate.
 *
 * This metric ignores the timing of buys (so it understates rates for
 * portfolios with most buys recent vs. early). Use XIRR for a time-weighted
 * answer; this CAGR is the "headline" annualised return.
 *
 * Cashflow convention used elsewhere in the codebase: outflows negative
 * (buys), inflows positive (sells + dividends). Pass dividend cashflows
 * separately via `dividendInflowsTotal` so the function can correctly
 * separate "capital returned" (sells, lower netDeployed) from "income"
 * (dividends, treated as part of the terminal value).
 *
 * Returns null if netDeployed ≤ 0 (more out than in — pathological) or if
 * (currentMv + dividends) ≤ 0.
 */
export function portfolioCagr(
  cashflows: Cashflow[],
  currentMv: number,
  dividendInflowsTotal = 0,
): number | null {
  if (cashflows.length === 0) return null;
  let totalOutflows = 0;
  let totalInflows = 0;
  let firstOutflowDate: string | null = null;
  let lastDate: string | null = null;
  for (const cf of cashflows) {
    if (cf.amount < 0) {
      totalOutflows += -cf.amount;
      if (firstOutflowDate == null || cf.date < firstOutflowDate) firstOutflowDate = cf.date;
    } else if (cf.amount > 0) {
      totalInflows += cf.amount;
    }
    if (lastDate == null || cf.date > lastDate) lastDate = cf.date;
  }
  if (firstOutflowDate == null) return null;

  // Inflows include sells AND dividends. Treat sells as "capital returned"
  // (reduce netDeployed); treat dividends as "income" (count toward terminal).
  const sellInflows = Math.max(0, totalInflows - dividendInflowsTotal);
  const netDeployed = totalOutflows - sellInflows;
  if (netDeployed <= 0) return null;

  const today = new Date().toISOString().slice(0, 10);
  const terminal = lastDate && lastDate > today ? lastDate : today;
  const years = yearsBetween(firstOutflowDate, terminal);
  if (years <= 0) return null;

  const endValue = currentMv + dividendInflowsTotal;
  return cagr(netDeployed, endValue, years);
}
