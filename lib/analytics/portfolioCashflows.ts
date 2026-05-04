import type { Trade } from '@/lib/db/queries/trades';
import type { Dividend } from '@/lib/db/queries/dividends';
import type { Cashflow } from '@/lib/analytics/xirr';

/**
 * Convert delivery trades to portfolio-level cashflows for XIRR.
 *   - Buy  → outflow (-qty * price)
 *   - Sell → inflow  (+qty * price)
 * Intraday-paired rows (`isIntradayPairId != null`) are excluded so the cashflow
 * series matches the delivery-only holdings view.
 *
 * Same-date flows are netted to one entry per date for numerical stability.
 */
export function tradesToCashflows(trades: Trade[]): Cashflow[] {
  const byDate = new Map<string, number>();
  for (const t of trades) {
    if (t.isIntradayPairId != null) continue;
    const sign = t.side === 'buy' ? -1 : 1;
    const amount = sign * t.qty * t.price;
    byDate.set(t.tradeDate, (byDate.get(t.tradeDate) ?? 0) + amount);
  }
  return [...byDate.entries()]
    .filter(([, a]) => a !== 0)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Combine delivery trade cashflows with dividend inflows on their ex-dates.
 * (Zerodha records dividends at ex-date for tax purposes; pay-date is 30-45d later.
 * For XIRR we use ex-date — small difference, well within rate-precision.)
 *
 * Same-date flows are netted to one entry per date.
 */
export function tradesAndDividendsToCashflows(trades: Trade[], dividends: Dividend[]): Cashflow[] {
  const byDate = new Map<string, number>();
  for (const t of trades) {
    if (t.isIntradayPairId != null) continue;
    const sign = t.side === 'buy' ? -1 : 1;
    const amount = sign * t.qty * t.price;
    byDate.set(t.tradeDate, (byDate.get(t.tradeDate) ?? 0) + amount);
  }
  for (const d of dividends) {
    byDate.set(d.exDate, (byDate.get(d.exDate) ?? 0) + d.netAmount);
  }
  return [...byDate.entries()]
    .filter(([, a]) => a !== 0)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
