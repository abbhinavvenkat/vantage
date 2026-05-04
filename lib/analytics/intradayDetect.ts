import type { NormalizedTrade } from '@/lib/parsers/types';

export function detectIntradayPairs(trades: NormalizedTrade[]): {
  pairs: Array<[NormalizedTrade, NormalizedTrade]>;
  delivery: NormalizedTrade[];
} {
  const buckets = new Map<string, NormalizedTrade[]>();
  for (const t of trades) {
    const key = `${t.symbol}|${t.tradeDate}`;
    const arr = buckets.get(key);
    if (arr) arr.push(t);
    else buckets.set(key, [t]);
  }

  const pairs: Array<[NormalizedTrade, NormalizedTrade]> = [];
  const pairedIds = new Set<NormalizedTrade>();

  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    const buys = arr.filter((t) => t.side === 'buy' && !pairedIds.has(t));
    const sells = arr.filter((t) => t.side === 'sell' && !pairedIds.has(t));
    for (const buy of buys) {
      if (pairedIds.has(buy)) continue;
      const match = sells.find((s) => !pairedIds.has(s) && s.qty === buy.qty);
      if (match) {
        pairs.push([buy, match]);
        pairedIds.add(buy);
        pairedIds.add(match);
      }
    }
  }

  const delivery = trades.filter((t) => !pairedIds.has(t));
  return { pairs, delivery };
}
