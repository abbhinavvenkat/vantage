'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/Badge';

export type TradeRow = {
  id: string;
  tradeDate: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  isIntradayPairId: string | null;
};

function fmt(n: number, d = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(n);
}

const COLLAPSE_THRESHOLD = 20;

export function CollapsibleTradeHistory({ trades }: { trades: TradeRow[] }) {
  const longList = trades.length >= COLLAPSE_THRESHOLD;
  const [open, setOpen] = useState(!longList);

  if (trades.length === 0) {
    return (
      <div className="px-5 py-4 text-xs text-[var(--color-muted)]">
        No trade history for this symbol.
      </div>
    );
  }

  return (
    <>
      {longList ? (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-2 text-left text-xs text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
        >
          <span>{open ? 'Hide all trades' : `Show all ${trades.length} trades`}</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
      ) : null}
      {open ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-card)]">
              <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-5 py-3 text-left">Date</th>
                <th className="px-3 py-3 text-right">Side</th>
                <th className="px-3 py-3 text-right">Qty</th>
                <th className="px-3 py-3 text-right">Price</th>
                <th className="px-3 py-3 text-right">Value</th>
                <th className="px-5 py-3 text-right">Type</th>
              </tr>
            </thead>
            <tbody>
              {[...trades]
                .sort((a, b) => b.tradeDate.localeCompare(a.tradeDate))
                .map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                  >
                    <td className="tnum px-5 py-3 text-[var(--color-muted)]">{t.tradeDate}</td>
                    <td className="px-3 py-3 text-right">
                      <Badge tone={t.side === 'buy' ? 'pos' : 'neg'}>{t.side.toUpperCase()}</Badge>
                    </td>
                    <td className="tnum px-3 py-3 text-right">{fmt(t.qty, 0)}</td>
                    <td className="tnum px-3 py-3 text-right">₹{fmt(t.price)}</td>
                    <td className="tnum px-3 py-3 text-right font-medium">
                      ₹{fmt(t.qty * t.price, 0)}
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Badge tone={t.isIntradayPairId ? 'neutral' : 'info'}>
                        {t.isIntradayPairId ? 'Intraday' : 'Delivery'}
                      </Badge>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
