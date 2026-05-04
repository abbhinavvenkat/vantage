import type { Trade } from '@/lib/db/queries/trades';
import type { Cashflow } from '@/lib/analytics/xirr';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';

/**
 * Per-symbol cashflows for XIRR / benchmark comparisons.
 *
 *   - Buy  → outflow (-qty * price)
 *   - Sell → inflow  (+qty * price)
 *
 * Intraday-paired rows (`isIntradayPairId != null`) are excluded so the series
 * matches the delivery-only holdings view. Trades are pushed through
 * `applySymbolAliases` first, then filtered by the (post-alias) `symbol` so
 * obsolete tickers (e.g. HDFC → HDFCBANK) reconcile correctly.
 *
 * If `currentMv > 0`, a synthetic terminal positive cashflow is appended on
 * `terminalDate` representing the unrealised position. For closed positions
 * pass `currentMv = 0` and only realised buy/sell flows are emitted.
 *
 * Same-date flows are netted to one entry per date for numerical stability.
 */
export function tradesToCashflowsForSymbol(
  trades: Trade[],
  symbol: string,
  currentMv: number,
  terminalDate: string,
): Cashflow[] {
  const target = symbol.toUpperCase();

  // Convert DB trades to NormalizedTrade so we can run them through aliases.
  // We only use fields that aliases inspect (symbol/qty/price); the rest are
  // copied verbatim.
  const normalized: NormalizedTrade[] = trades
    .filter((t) => t.isIntradayPairId === null)
    .map((t) => ({
      brokerCode: 'zerodha',
      symbol: t.symbol,
      isin: t.isin ?? undefined,
      tradeDate: t.tradeDate,
      side: t.side as 'buy' | 'sell',
      qty: t.qty,
      price: t.price,
      currency: t.currency as 'INR' | 'USD',
      exchange: t.exchange ?? undefined,
      segment: t.segment ?? undefined,
      series: t.series ?? undefined,
      tradeId: t.tradeId ?? undefined,
      orderId: t.orderId ?? undefined,
      execTime: t.execTime ?? undefined,
      rawRowIdx: t.sourceRowIdx ?? 0,
    }));

  const aliased = applySymbolAliases(normalized);

  const byDate = new Map<string, number>();
  for (const t of aliased) {
    if (t.symbol !== target) continue;
    const sign = t.side === 'buy' ? -1 : 1;
    const amount = sign * t.qty * t.price;
    byDate.set(t.tradeDate, (byDate.get(t.tradeDate) ?? 0) + amount);
  }

  const cashflows: Cashflow[] = [...byDate.entries()]
    .filter(([, a]) => a !== 0)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (currentMv > 0) {
    // Net the terminal MV onto the same date if there's already a cashflow there.
    const existing = cashflows.find((c) => c.date === terminalDate);
    if (existing) existing.amount += currentMv;
    else cashflows.push({ date: terminalDate, amount: currentMv });
    cashflows.sort((a, b) => a.date.localeCompare(b.date));
  }

  return cashflows;
}
