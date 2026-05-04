/**
 * Per-symbol running open-quantity timeline.
 *
 * For every symbol the user ever traded (post-aliases, post-intraday-net,
 * post-corp-actions), produce a chronological list of `(date, qty)` pairs
 * where `qty` is the open quantity AFTER the event on `date`. Lookups for
 * "what did I hold on date D?" are then a simple binary search for the
 * latest entry with `date <= D`.
 */

import type { NormalizedTrade } from '@/lib/parsers/types';
import { netSameDayIntraday, type CorporateAction } from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';

export type QtyPoint = { date: string; qty: number };
export type QtyTimeline = Map<string, QtyPoint[]>;

/**
 * Build the per-symbol qty timeline. The result is sorted ascending by date
 * within each symbol; ties are stable in event-arrival order. Same-day buy/sell
 * netting and bonus/split actions are reflected in qty deltas.
 */
export function runningOpenPositionsBySymbol(
  trades: NormalizedTrade[],
  corporateActions: CorporateAction[],
): QtyTimeline {
  const aliased = applySymbolAliases(trades);
  const netted = netSameDayIntraday(aliased);

  const bySymbol = new Map<string, NormalizedTrade[]>();
  for (const t of netted) {
    const arr = bySymbol.get(t.symbol);
    if (arr) arr.push(t);
    else bySymbol.set(t.symbol, [t]);
  }

  const actionsBySymbol = new Map<string, CorporateAction[]>();
  for (const a of corporateActions) {
    const arr = actionsBySymbol.get(a.symbol);
    if (arr) arr.push(a);
    else actionsBySymbol.set(a.symbol, [a]);
  }
  for (const arr of actionsBySymbol.values()) {
    arr.sort((x, y) => x.exDate.localeCompare(y.exDate));
  }

  const out: QtyTimeline = new Map();

  for (const [symbol, ts] of bySymbol) {
    const sorted = [...ts].sort((a, b) =>
      a.tradeDate !== b.tradeDate
        ? a.tradeDate.localeCompare(b.tradeDate)
        : a.rawRowIdx - b.rawRowIdx,
    );
    const pendingActions = [...(actionsBySymbol.get(symbol) ?? [])];
    let qty = 0;
    const points: QtyPoint[] = [];

    const pushPoint = (date: string, q: number): void => {
      // Coalesce same-date events into a single point representing the running qty.
      if (points.length > 0 && points[points.length - 1]!.date === date) {
        points[points.length - 1] = { date, qty: q };
      } else {
        points.push({ date, qty: q });
      }
    };

    const flushActionsUpTo = (date: string): void => {
      while (pendingActions.length > 0 && pendingActions[0]!.exDate <= date) {
        const action = pendingActions.shift()!;
        // For both split (×ratio) and bonus (×(1+ratio)) we apply against the
        // running aggregate qty — fidelity equivalent to lot-level scaling for
        // total qty (cost-basis tracking is not needed here).
        if (qty > 0) {
          if (action.type === 'split') qty = qty * action.ratio;
          else qty = qty * (1 + action.ratio);
        }
        pushPoint(action.exDate, qty);
      }
    };

    for (const t of sorted) {
      flushActionsUpTo(t.tradeDate);
      if (t.side === 'buy') qty += t.qty;
      else qty = Math.max(0, qty - t.qty);
      pushPoint(t.tradeDate, qty);
    }
    // Drain any remaining future-dated actions.
    while (pendingActions.length > 0) {
      const action = pendingActions.shift()!;
      if (qty > 0) {
        if (action.type === 'split') qty = qty * action.ratio;
        else qty = qty * (1 + action.ratio);
      }
      pushPoint(action.exDate, qty);
    }

    if (points.length > 0) out.set(symbol, points);
  }
  return out;
}

/**
 * Binary-search the qty held on `date` (inclusive) given a sorted timeline.
 * Returns 0 if `date` is before the first event.
 */
export function qtyOnDate(timeline: QtyPoint[], date: string): number {
  if (timeline.length === 0) return 0;
  let lo = 0;
  let hi = timeline.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid]!.date <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best === -1 ? 0 : timeline[best]!.qty;
}
