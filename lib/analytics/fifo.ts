import type { NormalizedTrade } from '@/lib/parsers/types';
import { applyBonus, applySplit, type Lot } from '@/lib/analytics/corporateActions';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';

export type CorporateAction = {
  symbol: string;
  exDate: string;
  type: 'split' | 'bonus';
  ratio: number;
};

export type RealizedTrade = {
  symbol: string;
  sellDate: string;
  qty: number;
  sellPrice: number;
  buyPrice: number;
  pnl: number;
  holdingDays: number;
};

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

function applyAction(lots: Lot[], action: CorporateAction): Lot[] {
  if (action.type === 'split') return applySplit(lots, action.ratio, action.exDate);
  return applyBonus(lots, action.ratio, action.exDate);
}

/**
 * Pairs same-day same-symbol buy/sell qty (intraday) and returns only the residue.
 * Same-day pairs are matched in exec_time / rawRowIdx order so the FIFO residue
 * is consistent with the order in which trades actually happened.
 */
export function netSameDayIntraday(trades: NormalizedTrade[]): NormalizedTrade[] {
  const bySymbolDate = new Map<string, NormalizedTrade[]>();
  for (const t of trades) {
    const key = `${t.symbol}|${t.tradeDate}`;
    const arr = bySymbolDate.get(key);
    if (arr) arr.push(t);
    else bySymbolDate.set(key, [t]);
  }
  const out: NormalizedTrade[] = [];
  const cmp = (a: NormalizedTrade, b: NormalizedTrade): number => {
    const at = a.execTime ?? '';
    const bt = b.execTime ?? '';
    if (at !== bt) return at.localeCompare(bt);
    return a.rawRowIdx - b.rawRowIdx;
  };
  for (const dayTrades of bySymbolDate.values()) {
    const buys = dayTrades.filter((t) => t.side === 'buy').sort(cmp);
    const sells = dayTrades.filter((t) => t.side === 'sell').sort(cmp);
    if (buys.length === 0 || sells.length === 0) {
      for (const t of dayTrades) out.push(t);
      continue;
    }
    const buyRem = buys.map((b) => ({ t: b, rem: b.qty }));
    const sellRem = sells.map((s) => ({ t: s, rem: s.qty }));
    let bi = 0;
    let si = 0;
    while (bi < buyRem.length && si < sellRem.length) {
      const b = buyRem[bi]!;
      const s = sellRem[si]!;
      const used = Math.min(b.rem, s.rem);
      b.rem -= used;
      s.rem -= used;
      if (b.rem === 0) bi++;
      if (s.rem === 0) si++;
    }
    for (const r of [...buyRem, ...sellRem]) {
      if (r.rem === 0) continue;
      if (r.rem === r.t.qty) out.push(r.t);
      else out.push({ ...r.t, qty: r.rem });
    }
  }
  out.sort((a, b) =>
    a.tradeDate !== b.tradeDate
      ? a.tradeDate.localeCompare(b.tradeDate)
      : a.rawRowIdx - b.rawRowIdx,
  );
  return out;
}

export function computeFifo(
  deliveryTrades: NormalizedTrade[],
  corporateActions: CorporateAction[],
): { lots: Lot[]; realized: RealizedTrade[] } {
  const aliased = applySymbolAliases(deliveryTrades);
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

  const allOpenLots: Lot[] = [];
  const realized: RealizedTrade[] = [];

  for (const [symbol, trades] of bySymbol) {
    const sorted = [...trades].sort((a, b) => {
      if (a.tradeDate !== b.tradeDate) return a.tradeDate.localeCompare(b.tradeDate);
      return a.rawRowIdx - b.rawRowIdx;
    });
    const pendingActions = [...(actionsBySymbol.get(symbol) ?? [])];
    let lots: Lot[] = [];

    const flushActionsUpTo = (date: string) => {
      while (pendingActions.length > 0 && pendingActions[0]!.exDate <= date) {
        const action = pendingActions.shift()!;
        lots = applyAction(lots, action);
      }
    };

    for (const t of sorted) {
      flushActionsUpTo(t.tradeDate);
      if (t.side === 'buy') {
        lots.push({ qty: t.qty, costPerShare: t.price, date: t.tradeDate });
        continue;
      }
      let remaining = t.qty;
      while (remaining > 0 && lots.length > 0) {
        const head = lots[0]!;
        const used = Math.min(head.qty, remaining);
        realized.push({
          symbol,
          sellDate: t.tradeDate,
          qty: used,
          sellPrice: t.price,
          buyPrice: head.costPerShare,
          pnl: used * (t.price - head.costPerShare),
          holdingDays: daysBetween(head.date, t.tradeDate),
        });
        head.qty -= used;
        remaining -= used;
        if (head.qty === 0) lots.shift();
      }
      if (remaining > 0) {
        throw new Error(
          `computeFifo: oversold ${symbol} on ${t.tradeDate} (short by ${remaining})`,
        );
      }
    }

    while (pendingActions.length > 0) {
      const action = pendingActions.shift()!;
      lots = applyAction(lots, action);
    }

    for (const lot of lots) allOpenLots.push(lot);
  }

  return { lots: allOpenLots, realized };
}
