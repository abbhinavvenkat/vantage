import type { NormalizedTrade } from '@/lib/parsers/types';
import type { RealizedTrade, CorporateAction } from '@/lib/analytics/fifo';
import { computeFifo } from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { netSameDayIntraday } from '@/lib/analytics/fifo';
import { getSector } from '@/lib/sectors/map';

export type SymbolAggregate = {
  symbol: string;
  firstBuyDate: string;
  firstBuyFy: string;
  invested: number; // sum of buy qty * buy price (delivery, post-aliasing & post-intraday-net)
  sold: number; // sum of sell qty * sell price
  realizedPnl: number;
  openQty: number; // remaining open shares (post corporate-actions)
  openCostBasis: number; // sum(qty * costPerShare) across open lots
  marketValue: number; // sum(qty * cmp) across open lots; falls back to costBasis if no price
  unrealizedPnl: number; // marketValue - openCostBasis
};

export type CohortRow = {
  bucket: string; // FY string or sector label
  symbols: string[];
  invested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  marketValue: number;
  openCostBasis: number;
  totalReturnPct: number; // (realized + unrealized) / invested * 100
  weightPct: number; // marketValue / total marketValue * 100
};

/** FY-IN format used elsewhere in app (Apr-Mar, India). */
export function fyOf(dateStr: string): string {
  const [y, m] = dateStr.split('-').map(Number);
  if (y == null || m == null) throw new Error(`fyOf: bad date '${dateStr}'`);
  return m >= 4 ? `FY${(y + 1).toString().slice(2)}` : `FY${y.toString().slice(2)}`;
}

/**
 * Build per-symbol aggregates from delivery trades.
 * - Applies symbol aliases + same-day intraday netting (mirrors `computeFifo` inputs).
 * - Realized P&L comes from FIFO matching (with corporate actions).
 * - Open cost basis is the sum of remaining lot costs after FIFO; we re-run per-symbol
 *   so we can attribute each lot back to its symbol (computeFifo's combined `lots`
 *   array drops the symbol).
 */
export function buildSymbolAggregates(
  deliveryTrades: NormalizedTrade[],
  corporateActions: CorporateAction[],
  cmpBySymbol: Map<string, number>,
): SymbolAggregate[] {
  const aliased = applySymbolAliases(deliveryTrades);
  const netted = netSameDayIntraday(aliased);

  const bySymbol = new Map<string, NormalizedTrade[]>();
  for (const t of netted) {
    const arr = bySymbol.get(t.symbol);
    if (arr) arr.push(t);
    else bySymbol.set(t.symbol, [t]);
  }

  const out: SymbolAggregate[] = [];

  for (const [symbol, trades] of bySymbol) {
    const sorted = [...trades].sort((a, b) =>
      a.tradeDate !== b.tradeDate
        ? a.tradeDate.localeCompare(b.tradeDate)
        : a.rawRowIdx - b.rawRowIdx,
    );

    let invested = 0;
    let sold = 0;
    let firstBuyDate: string | null = null;
    for (const t of sorted) {
      if (t.side === 'buy') {
        invested += t.qty * t.price;
        if (firstBuyDate == null) firstBuyDate = t.tradeDate;
      } else {
        sold += t.qty * t.price;
      }
    }
    if (firstBuyDate == null) continue; // sells without buys would be a parse bug; skip

    const symbolActions = corporateActions.filter((a) => a.symbol === symbol);
    // Re-run FIFO scoped to this symbol so we get realized + open lots attributable.
    // Use already-aliased+netted trades; pass empty alias list inside computeFifo by
    // calling with the aliased trades directly (computeFifo will alias again — but
    // alias-of-alias is a no-op since the post-rename symbol is not a key in SYMBOL_ALIASES).
    const { realized, lots } = computeFifo(sorted, symbolActions);

    const realizedPnl = realized.reduce((s: number, r: RealizedTrade) => s + r.pnl, 0);
    const openQty = lots.reduce((s, l) => s + l.qty, 0);
    const openCostBasis = lots.reduce((s, l) => s + l.qty * l.costPerShare, 0);
    const cmp = cmpBySymbol.get(symbol);
    const marketValue = cmp != null ? cmp * openQty : openCostBasis;
    const unrealizedPnl = marketValue - openCostBasis;

    out.push({
      symbol,
      firstBuyDate,
      firstBuyFy: fyOf(firstBuyDate),
      invested,
      sold,
      realizedPnl,
      openQty,
      openCostBasis,
      marketValue,
      unrealizedPnl,
    });
  }

  return out;
}

/**
 * Group per-symbol aggregates into FY-of-first-buy cohorts.
 * Returns rows sorted by FY ascending.
 */
export function aggregateByEntryFy(aggregates: SymbolAggregate[]): CohortRow[] {
  return aggregateBy(aggregates, (a) => a.firstBuyFy).sort((a, b) =>
    a.bucket.localeCompare(b.bucket),
  );
}

/**
 * Group per-symbol aggregates by sector via the static `lib/sectors/map.ts` map.
 * Symbols not in the map land in the "Unclassified" bucket.
 * Returns rows sorted by marketValue descending.
 */
export function aggregateBySector(aggregates: SymbolAggregate[]): CohortRow[] {
  return aggregateBy(aggregates, (a) => getSector(a.symbol)).sort(
    (a, b) => b.marketValue - a.marketValue,
  );
}

function aggregateBy(
  aggregates: SymbolAggregate[],
  keyFn: (a: SymbolAggregate) => string,
): CohortRow[] {
  const groups = new Map<string, SymbolAggregate[]>();
  for (const a of aggregates) {
    const k = keyFn(a);
    const arr = groups.get(k);
    if (arr) arr.push(a);
    else groups.set(k, [a]);
  }

  const totalMv = aggregates.reduce((s, a) => s + a.marketValue, 0);

  const rows: CohortRow[] = [];
  for (const [bucket, items] of groups) {
    const invested = items.reduce((s, a) => s + a.invested, 0);
    const realizedPnl = items.reduce((s, a) => s + a.realizedPnl, 0);
    const unrealizedPnl = items.reduce((s, a) => s + a.unrealizedPnl, 0);
    const marketValue = items.reduce((s, a) => s + a.marketValue, 0);
    const openCostBasis = items.reduce((s, a) => s + a.openCostBasis, 0);
    const totalReturnPct = invested > 0 ? ((realizedPnl + unrealizedPnl) / invested) * 100 : 0;
    const weightPct = totalMv > 0 ? (marketValue / totalMv) * 100 : 0;

    rows.push({
      bucket,
      symbols: items.map((a) => a.symbol).sort(),
      invested,
      realizedPnl,
      unrealizedPnl,
      marketValue,
      openCostBasis,
      totalReturnPct,
      weightPct,
    });
  }
  return rows;
}
