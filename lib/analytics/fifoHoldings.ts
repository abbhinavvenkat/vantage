import type { NormalizedTrade } from '@/lib/parsers/types';
import {
  computeFifo,
  netSameDayIntraday,
  type CorporateAction,
  type RealizedTrade,
} from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { applyBonus, applySplit, type Lot } from '@/lib/analytics/corporateActions';

export type OpenLot = {
  qty: number;
  costPerShare: number;
  date: string;
};

export type OpenPosition = {
  symbol: string;
  qty: number;
  costBasis: number;
  avgCost: number;
  firstBuyDate: string;
  lots: OpenLot[];
};

/**
 * Returns one row per currently-held symbol, with FIFO open-lot quantity + cost basis.
 * Honours symbol aliases (e.g., HDFC→HDFCBANK), same-day intraday netting, and
 * bonus/split corporate actions provided by the caller.
 *
 * Symbols that go FIFO-negative (oversold given the data on hand) are silently dropped —
 * the caller should reconcile separately via `lib/analytics/fifoHoldings`'s sister
 * reconciliation helpers if needed.
 */
export function computeOpenPositions(
  trades: NormalizedTrade[],
  corporateActions: CorporateAction[],
): OpenPosition[] {
  const aliased = applySymbolAliases(trades);
  const netted = netSameDayIntraday(aliased);

  const bySymbol = new Map<string, NormalizedTrade[]>();
  for (const t of netted) {
    const arr = bySymbol.get(t.symbol) ?? [];
    arr.push(t);
    bySymbol.set(t.symbol, arr);
  }
  const actionsBySymbol = new Map<string, CorporateAction[]>();
  for (const a of corporateActions) {
    const arr = actionsBySymbol.get(a.symbol) ?? [];
    arr.push(a);
    actionsBySymbol.set(a.symbol, arr);
  }
  for (const arr of actionsBySymbol.values()) {
    arr.sort((x, y) => x.exDate.localeCompare(y.exDate));
  }

  const out: OpenPosition[] = [];
  for (const [symbol, ts] of bySymbol) {
    const sorted = [...ts].sort((a, b) =>
      a.tradeDate !== b.tradeDate
        ? a.tradeDate.localeCompare(b.tradeDate)
        : a.rawRowIdx - b.rawRowIdx,
    );
    const pendingActions = [...(actionsBySymbol.get(symbol) ?? [])];
    let lots: Lot[] = [];
    const flushActionsUpTo = (date: string): void => {
      while (pendingActions.length > 0 && pendingActions[0]!.exDate <= date) {
        const action = pendingActions.shift()!;
        if (action.type === 'split') lots = applySplit(lots, action.ratio, action.exDate);
        else lots = applyBonus(lots, action.ratio, action.exDate);
      }
    };
    let firstBuyDate = '';
    let oversold = false;
    for (const t of sorted) {
      flushActionsUpTo(t.tradeDate);
      if (t.side === 'buy') {
        if (!firstBuyDate) firstBuyDate = t.tradeDate;
        lots.push({ qty: t.qty, costPerShare: t.price, date: t.tradeDate });
      } else {
        let rem = t.qty;
        while (rem > 0 && lots.length > 0) {
          const head = lots[0]!;
          const used = Math.min(head.qty, rem);
          head.qty -= used;
          rem -= used;
          if (head.qty === 0) lots.shift();
        }
        if (rem > 0) {
          oversold = true;
          break;
        }
      }
    }
    if (oversold) continue;
    while (pendingActions.length > 0) {
      const action = pendingActions.shift()!;
      if (action.type === 'split') lots = applySplit(lots, action.ratio, action.exDate);
      else lots = applyBonus(lots, action.ratio, action.exDate);
    }
    const qty = lots.reduce((s, l) => s + l.qty, 0);
    const costBasis = lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
    if (qty <= 0) continue;
    out.push({
      symbol,
      qty,
      costBasis,
      avgCost: costBasis / qty,
      firstBuyDate,
      lots: lots.map((l) => ({ qty: l.qty, costPerShare: l.costPerShare, date: l.date })),
    });
  }
  return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
}

/**
 * Convenience: compute realized trades the same way the holdings table does,
 * so realized-page numbers stay aligned with holdings totals.
 */
export function computeRealizedTrades(
  trades: NormalizedTrade[],
  corporateActions: CorporateAction[],
): RealizedTrade[] {
  const aliased = applySymbolAliases(trades);
  return computeFifo(aliased, corporateActions).realized;
}
