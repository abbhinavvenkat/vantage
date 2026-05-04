import type { NormalizedTrade } from '@/lib/parsers/types';

/**
 * Symbol renames + simple-ratio mergers known at parse time.
 *
 * `qtyRatio` is shares-after / shares-before. Applied to BOTH qty and inversely to price
 * (so total cost-basis per row is preserved).
 *
 * Sources:
 *  - LTI → LTIM (LarsenToubro Infotech merger, Nov 2022; effectively a 1:1 rename)
 *  - AMARAJABAT → ARE&M (Amara Raja rename, Sep 2023; 1:1)
 *  - HDFC → HDFCBANK (HDFC twins merger, Jul 2023; 42 HDFCBANK per 25 HDFC = 1.68)
 *
 * Yahoo cannot resolve the obsolete tickers, so without this map both pricing and
 * FIFO get wrong answers when a holding spans the corporate action.
 */
export type SymbolAlias = {
  toSymbol: string;
  qtyRatio: number;
};

export const SYMBOL_ALIASES: Record<string, SymbolAlias> = {
  LTI: { toSymbol: 'LTIM', qtyRatio: 1 },
  AMARAJABAT: { toSymbol: 'ARE&M', qtyRatio: 1 },
  HDFC: { toSymbol: 'HDFCBANK', qtyRatio: 42 / 25 },
};

export function applySymbolAliases(trades: NormalizedTrade[]): NormalizedTrade[] {
  return trades.map((t) => {
    const alias = SYMBOL_ALIASES[t.symbol];
    if (!alias) return t;
    return {
      ...t,
      symbol: alias.toSymbol,
      qty: t.qty * alias.qtyRatio,
      price: t.price / alias.qtyRatio,
    };
  });
}
