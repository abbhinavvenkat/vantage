import Link from 'next/link';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { getLatestPrices } from '@/lib/db/queries/prices';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { Card } from '@/components/ui/Card';
import { ArrowDown, ArrowUp, ChevronRight, Upload as UploadIcon } from '@/components/ui/Icons';
import { BackfillPricesButton } from './BackfillPricesButton';
import { BenchmarkCard } from './BenchmarkCard';
import { RefreshPricesButton } from './RefreshPricesButton';
import { SnapshotDownloadButton } from './SnapshotDownloadButton';
import { UploadForm } from './UploadForm';

type Props = { params: Promise<{ portfolioId: string }> };

function fmt(n: number, decimals = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n);
}

function fmtCr(n: number) {
  if (Math.abs(n) >= 1_00_00_000) return `₹${fmt(n / 1_00_00_000, 2)}Cr`;
  if (Math.abs(n) >= 1_00_000) return `₹${fmt(n / 1_00_000, 2)}L`;
  return `₹${fmt(n, 0)}`;
}

function pnlClass(n: number | null | undefined) {
  if (n == null) return 'text-[var(--color-muted)]';
  return n >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
}

export default async function HoldingsPage({ params }: Props) {
  const { portfolioId } = await params;
  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';

  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryTrades.map((t: Trade, i) => ({
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
    rawRowIdx: t.sourceRowIdx ?? i,
  }));
  const openPositions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const symbols = openPositions.map((h) => h.symbol);
  const prices = getLatestPrices(db, symbols);

  type Row = {
    symbol: string;
    netQty: number;
    avgCost: number;
    cmp: number | null;
    costBasis: number;
    marketValue: number | null;
    unrealizedPnl: number | null;
    pctReturn: number | null;
    firstBuy: string;
    priceDate: string | null;
  };

  const rows: Row[] = openPositions.map((h) => {
    const p = prices.get(h.symbol);
    const cmp = p?.close ?? null;
    const marketValue = cmp != null ? cmp * h.qty : null;
    const unrealizedPnl = marketValue != null ? marketValue - h.costBasis : null;
    const pctReturn =
      unrealizedPnl != null && h.costBasis > 0 ? (unrealizedPnl / h.costBasis) * 100 : null;

    return {
      symbol: h.symbol,
      netQty: h.qty,
      avgCost: h.avgCost,
      cmp,
      costBasis: h.costBasis,
      marketValue,
      unrealizedPnl,
      pctReturn,
      firstBuy: h.firstBuyDate,
      priceDate: p?.date ?? null,
    };
  });

  const totalCost = rows.reduce((s, r) => s + r.costBasis, 0);
  const totalMv = rows.reduce((s, r) => s + (r.marketValue ?? r.costBasis), 0);
  const totalPnl = totalMv - totalCost;
  const totalPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const positive = totalPnl >= 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Hero summary band */}
      {rows.length > 0 ? (
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-sm)]">
          <div className="grid grid-cols-2 divide-x divide-[var(--color-border)] sm:grid-cols-4">
            <Stat label="Invested" value={fmtCr(totalCost)} />
            <Stat label="Market Value" value={fmtCr(totalMv)} accent />
            <Stat
              label="Unrealized P&L"
              value={`${positive ? '+' : ''}${fmtCr(totalPnl)}`}
              valueClass={pnlClass(totalPnl)}
            />
            <Stat
              label="Return"
              value={`${positive ? '+' : ''}${fmt(totalPct)}%`}
              valueClass={pnlClass(totalPnl)}
              icon={
                positive ? (
                  <ArrowUp size={14} className="text-[var(--color-pos)]" />
                ) : (
                  <ArrowDown size={14} className="text-[var(--color-neg)]" />
                )
              }
            />
          </div>
        </section>
      ) : null}

      {/* Portfolio vs Nifty 50 benchmark */}
      {rows.length > 0 ? <BenchmarkCard portfolioId={portfolioId} /> : null}

      {/* Upload + actions row */}
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] sm:flex">
              <UploadIcon size={18} />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Upload Tradebook</h2>
              <p className="text-xs text-[var(--color-muted)]">
                Drop a Zerodha / Groww .xlsx or .csv file to ingest trades.
              </p>
            </div>
          </div>
          <UploadForm portfolioId={portfolioId} csrfToken={csrfToken} />
        </div>
      </Card>

      {/* Holdings table */}
      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Holdings ({rows.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">Open delivery positions</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <SnapshotDownloadButton
              portfolioId={portfolioId}
              defaultAsOf={new Date().toISOString().slice(0, 10)}
            />
            <RefreshPricesButton portfolioId={portfolioId} csrfToken={csrfToken} />
            <BackfillPricesButton portfolioId={portfolioId} csrfToken={csrfToken} />
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card-hover)] text-[var(--color-muted)]">
              <UploadIcon size={20} />
            </div>
            <p className="text-sm font-medium">No open positions yet</p>
            <p className="text-xs text-[var(--color-muted)]">
              Upload a tradebook above to see your holdings here.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--color-card)]">
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    <th className="px-5 py-3 text-left">Symbol</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Avg Cost</th>
                    <th className="px-3 py-3 text-right">CMP</th>
                    <th className="px-3 py-3 text-right">Cost Basis</th>
                    <th className="px-3 py-3 text-right">Mkt Value</th>
                    <th className="px-3 py-3 text-right">Unrealized</th>
                    <th className="px-3 py-3 text-right">%</th>
                    <th className="px-5 py-3 text-right">Since</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.symbol}
                      className="group border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/p/${portfolioId}/symbol/${encodeURIComponent(r.symbol)}`}
                          className="inline-flex items-center gap-1.5 font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                        >
                          {r.symbol}
                          <ChevronRight
                            size={12}
                            className="opacity-0 transition-opacity group-hover:opacity-100"
                          />
                        </Link>
                      </td>
                      <td className="tnum px-3 py-3 text-right">{fmt(r.netQty, 0)}</td>
                      <td className="tnum px-3 py-3 text-right">₹{fmt(r.avgCost)}</td>
                      <td className="tnum px-3 py-3 text-right">
                        {r.cmp != null ? (
                          <span title={r.priceDate ?? ''}>₹{fmt(r.cmp)}</span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-[var(--color-muted)]">
                        {fmtCr(r.costBasis)}
                      </td>
                      <td className="tnum px-3 py-3 text-right font-medium">
                        {r.marketValue != null ? fmtCr(r.marketValue) : '—'}
                      </td>
                      <td className={`tnum px-3 py-3 text-right ${pnlClass(r.unrealizedPnl)}`}>
                        {r.unrealizedPnl != null
                          ? `${r.unrealizedPnl >= 0 ? '+' : ''}${fmtCr(r.unrealizedPnl)}`
                          : '—'}
                      </td>
                      <td className={`tnum px-3 py-3 text-right ${pnlClass(r.pctReturn)}`}>
                        {r.pctReturn != null
                          ? `${r.pctReturn >= 0 ? '+' : ''}${fmt(r.pctReturn)}%`
                          : '—'}
                      </td>
                      <td className="tnum px-5 py-3 text-right text-xs text-[var(--color-muted)]">
                        {r.firstBuy}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
              {rows.map((r) => (
                <li key={r.symbol}>
                  <Link
                    href={`/p/${portfolioId}/symbol/${encodeURIComponent(r.symbol)}`}
                    className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-[var(--color-card-hover)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{r.symbol}</div>
                        <div className="tnum text-xs text-[var(--color-muted)]">
                          {fmt(r.netQty, 0)} qty · ₹{fmt(r.avgCost)} avg
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="tnum text-sm font-medium">
                          {r.marketValue != null ? fmtCr(r.marketValue) : fmtCr(r.costBasis)}
                        </div>
                        <div className={`tnum text-xs ${pnlClass(r.unrealizedPnl)}`}>
                          {r.unrealizedPnl != null
                            ? `${r.unrealizedPnl >= 0 ? '+' : ''}${fmtCr(r.unrealizedPnl)}`
                            : '—'}
                          {r.pctReturn != null
                            ? ` (${r.pctReturn >= 0 ? '+' : ''}${fmt(r.pctReturn)}%)`
                            : ''}
                        </div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  valueClass,
  icon,
  accent,
}: {
  label: string;
  value: string;
  valueClass?: string;
  icon?: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="px-5 py-5">
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div
        className={
          'tnum mt-1.5 flex items-baseline gap-1.5 ' +
          (accent ? 'text-2xl font-semibold' : 'text-xl font-semibold') +
          (valueClass ? ' ' + valueClass : '')
        }
      >
        {icon ? <span className="self-center">{icon}</span> : null}
        {value}
      </div>
    </div>
  );
}
