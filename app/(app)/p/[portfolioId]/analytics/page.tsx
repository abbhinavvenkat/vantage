import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { computeFifo } from '@/lib/analytics/fifo';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import {
  aggregateByEntryFy,
  aggregateBySector,
  buildSymbolAggregates,
  type CohortRow,
  type SymbolAggregate,
} from '@/lib/analytics/cohorts';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { xirr } from '@/lib/analytics/xirr';
import { computeHHI, beta, portfolioBeta } from '@/lib/analytics/risk';
import { buildCompareColumn, parseSymbolsParam, type CompareColumn } from '@/lib/compare/aggregate';
import { db } from '@/lib/db/client';
import { getCloseHistory, getLatestPrices, getSymbolStats } from '@/lib/db/queries/prices';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { getNifty50SeriesCached } from '@/lib/pricing/nifty50';
import {
  loadARSummaries,
  loadConcallDigests,
  loadLatestThesisStressTest,
} from '@/lib/research/loadOutputs';
import { getSector } from '@/lib/sectors/map';
import { NIFTY50_AS_OF, getNiftyWeight, NIFTY50_SECTOR_WEIGHTS } from '@/lib/sectors/niftyWeights';
import type { NormalizedTrade } from '@/lib/parsers/types';

import { SectorVsNiftyChart, type SectorWeightRow } from '../risk/SectorVsNiftyChart';
import { CompareSymbolPicker } from '../compare/CompareSymbolPicker';

// ── shared helpers ────────────────────────────────────────────────────────────

function toNorm(t: Trade, i: number): NormalizedTrade {
  return {
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
  };
}

function fmt(n: number, d = 2) {
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
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
function fmtPct(n: number | null | undefined, d = 2) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${fmt(n, d)}%`;
}
function fmtPctFrac(n: number | null | undefined, d = 1) {
  if (n == null) return '—';
  return `${n >= 0 ? '+' : ''}${fmt(n * 100, d)}%`;
}
function fmtFundamental(key: string, value: number | null) {
  if (value == null) return '—';
  const pctLike = /margin|roce|roe|growth|yield|payout/i.test(key);
  if (pctLike) return Math.abs(value) <= 1.5 ? `${fmt(value * 100, 1)}%` : `${fmt(value, 1)}%`;
  return fmt(value, 2);
}
function distanceTone(pct: number | null) {
  if (pct == null) return 'text-[var(--color-muted)]';
  if (pct >= -0.05) return 'text-[var(--color-pos)]';
  if (pct <= -0.2) return 'text-[var(--color-neg)]';
  return 'text-[var(--color-muted)]';
}
function verdictTone(
  v: 'intact' | 'watch' | 'weakened' | 'broken',
): 'pos' | 'info' | 'warning' | 'neg' {
  if (v === 'intact') return 'pos';
  if (v === 'watch') return 'info';
  if (v === 'weakened') return 'warning';
  return 'neg';
}

// ── sub-nav ───────────────────────────────────────────────────────────────────

const SECTIONS = [
  { label: 'Realized P&L', key: 'realized' },
  { label: 'Sectors', key: 'sectors' },
  { label: 'Risk', key: 'risk' },
  { label: 'Cohorts', key: 'cohorts' },
  { label: 'Compare', key: 'compare' },
];

function SubNav({ portfolioId, active }: { portfolioId: string; active: string }) {
  return (
    <nav className="flex gap-0 overflow-x-auto border-b border-[var(--color-border)]">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`/p/${portfolioId}/analytics?section=${s.key}`}
          className={[
            'shrink-0 px-4 py-2 text-sm font-medium whitespace-nowrap transition',
            active === s.key
              ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-fg)]'
              : 'text-[var(--color-muted)] hover:text-[var(--color-fg)]',
          ].join(' ')}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}

// ── page ─────────────────────────────────────────────────────────────────────

type Props = {
  params: Promise<{ portfolioId: string }>;
  searchParams: Promise<{ section?: string; symbols?: string | string[] }>;
};

export default async function AnalyticsPage({ params, searchParams }: Props) {
  const { portfolioId } = await params;
  const sp = await searchParams;
  const section = SECTIONS.some((s) => s.key === sp.section)
    ? (sp.section ?? 'realized')
    : 'realized';

  return (
    <div className="flex flex-col gap-5">
      <SubNav portfolioId={portfolioId} active={section} />
      {section === 'realized' && <RealizedSection portfolioId={portfolioId} />}
      {section === 'sectors' && <SectorsSection portfolioId={portfolioId} />}
      {section === 'risk' && <RiskSection portfolioId={portfolioId} />}
      {section === 'cohorts' && <CohortsSection portfolioId={portfolioId} />}
      {section === 'compare' && (
        <CompareSection portfolioId={portfolioId} symbols={parseSymbolsParam(sp.symbols)} />
      )}
    </div>
  );
}

// ── Realized P&L ──────────────────────────────────────────────────────────────

function fy(dateStr: string) {
  const [y, m] = dateStr.split('-').map(Number);
  return m! >= 4 ? `FY${(y! + 1).toString().slice(2)}` : `FY${y!.toString().slice(2)}`;
}

async function RealizedSection({ portfolioId }: { portfolioId: string }) {
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const normalized = allTrades.filter((t) => t.isIntradayPairId === null).map(toNorm);
  const { realized } = computeFifo(normalized, KNOWN_CORPORATE_ACTIONS);
  const sorted = [...realized].sort((a, b) => b.sellDate.localeCompare(a.sellDate));

  const totalPnl = sorted.reduce((s, r) => s + r.pnl, 0);
  const ltcg = sorted.filter((r) => r.holdingDays >= 365).reduce((s, r) => s + r.pnl, 0);
  const stcg = sorted.filter((r) => r.holdingDays < 365).reduce((s, r) => s + r.pnl, 0);

  const byFy = new Map<string, number>();
  for (const r of sorted) byFy.set(fy(r.sellDate), (byFy.get(fy(r.sellDate)) ?? 0) + r.pnl);
  const fyEntries = [...byFy.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="flex flex-col gap-6">
      {sorted.length > 0 && (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label: 'Total Realized P&L', value: totalPnl, bold: true },
            { label: 'LTCG (≥1yr)', value: ltcg, sub: 'Long-term capital gains' },
            { label: 'STCG (<1yr)', value: stcg, sub: 'Short-term capital gains' },
          ].map(({ label, value, bold, sub }) => (
            <Card key={label}>
              <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                {label}
              </div>
              <div
                className={`tnum mt-1.5 ${bold ? 'text-2xl' : 'text-xl'} font-semibold ${pnlClass(value)}`}
              >
                {value >= 0 ? '+' : ''}₹{fmt(value, 0)}
              </div>
              {sub && <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div>}
            </Card>
          ))}
        </section>
      )}

      {fyEntries.length > 1 && (
        <Card>
          <div className="mb-3 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            By Financial Year
          </div>
          <div className="flex flex-wrap gap-2">
            {fyEntries.map(([f, pnl]) => (
              <div
                key={f}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-card-hover)] px-3 py-1.5 text-xs"
              >
                <span className="font-medium text-[var(--color-fg)]">{f}</span>
                <span className={`tnum font-semibold ${pnlClass(pnl)}`}>
                  {pnl >= 0 ? '+' : ''}₹{fmt(pnl, 0)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Realized Trades ({sorted.length})</h2>
            <p className="text-xs text-[var(--color-muted)]">FIFO matched, delivery-only</p>
          </div>
        </div>
        {sorted.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No realized trades yet.
          </p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead className="bg-[var(--color-card)]">
                  <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    <th className="px-5 py-3 text-left">Symbol</th>
                    <th className="px-3 py-3 text-right">Sell Date</th>
                    <th className="px-3 py-3 text-right">Qty</th>
                    <th className="px-3 py-3 text-right">Buy ₹</th>
                    <th className="px-3 py-3 text-right">Sell ₹</th>
                    <th className="px-3 py-3 text-right">P&amp;L</th>
                    <th className="px-3 py-3 text-right">Held</th>
                    <th className="px-5 py-3 text-right">Type</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => (
                    <tr
                      key={i}
                      className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                    >
                      <td className="px-5 py-3 font-medium">{r.symbol}</td>
                      <td className="tnum px-3 py-3 text-right text-[var(--color-muted)]">
                        {r.sellDate}
                      </td>
                      <td className="tnum px-3 py-3 text-right">{fmt(r.qty, 0)}</td>
                      <td className="tnum px-3 py-3 text-right">₹{fmt(r.buyPrice)}</td>
                      <td className="tnum px-3 py-3 text-right">₹{fmt(r.sellPrice)}</td>
                      <td className={`tnum px-3 py-3 text-right font-semibold ${pnlClass(r.pnl)}`}>
                        {r.pnl >= 0 ? '+' : ''}₹{fmt(r.pnl, 0)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-xs text-[var(--color-muted)]">
                        {r.holdingDays}d
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone={r.holdingDays >= 365 ? 'info' : 'warning'}>
                          {r.holdingDays >= 365 ? 'LTCG' : 'STCG'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
              {sorted.map((r, i) => (
                <li key={i} className="flex items-start justify-between gap-3 px-5 py-4">
                  <div>
                    <div className="font-semibold">{r.symbol}</div>
                    <div className="tnum text-xs text-[var(--color-muted)]">
                      {r.sellDate} · {fmt(r.qty, 0)} qty · {r.holdingDays}d
                    </div>
                    <div className="mt-1">
                      <Badge tone={r.holdingDays >= 365 ? 'info' : 'warning'}>
                        {r.holdingDays >= 365 ? 'LTCG' : 'STCG'}
                      </Badge>
                    </div>
                  </div>
                  <div className={`tnum text-right text-sm font-semibold ${pnlClass(r.pnl)}`}>
                    {r.pnl >= 0 ? '+' : ''}₹{fmt(r.pnl, 0)}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}

// ── Sectors ───────────────────────────────────────────────────────────────────

const PALETTE = [
  'from-[#3b82f6] to-[#7c3aed]',
  'from-[#10b981] to-[#06b6d4]',
  'from-[#f59e0b] to-[#ef4444]',
  'from-[#8b5cf6] to-[#ec4899]',
  'from-[#14b8a6] to-[#22c55e]',
  'from-[#f97316] to-[#facc15]',
  'from-[#6366f1] to-[#0ea5e9]',
  'from-[#a855f7] to-[#d946ef]',
  'from-[#84cc16] to-[#16a34a]',
  'from-[#06b6d4] to-[#3b82f6]',
];
const sc = (i: number) => PALETTE[i % PALETTE.length];

async function SectorsSection({ portfolioId }: { portfolioId: string }) {
  const trades = getTradesForPortfolio(db, portfolioId);
  const normalized = trades.filter((t) => t.isIntradayPairId === null).map(toNorm);
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const prices = getLatestPrices(
    db,
    positions.map((p) => p.symbol),
  );

  const symbolRows = positions.map((p) => {
    const cmp = prices.get(p.symbol)?.close ?? p.avgCost;
    return {
      symbol: p.symbol,
      sector: getSector(p.symbol),
      qty: p.qty,
      invested: p.costBasis,
      marketValue: cmp * p.qty,
      pct: 0,
    };
  });
  const totalMv = symbolRows.reduce((s, r) => s + r.marketValue, 0);
  symbolRows.forEach((r) => {
    r.pct = totalMv > 0 ? (r.marketValue / totalMv) * 100 : 0;
  });
  symbolRows.sort((a, b) => b.marketValue - a.marketValue);

  const bySector = new Map<string, typeof symbolRows>();
  for (const r of symbolRows) {
    const a = bySector.get(r.sector) ?? [];
    a.push(r);
    bySector.set(r.sector, a);
  }
  const sectorRows = [...bySector.entries()]
    .map(([sector, syms]) => ({
      sector,
      symbols: syms,
      invested: syms.reduce((s, x) => s + x.invested, 0),
      marketValue: syms.reduce((s, x) => s + x.marketValue, 0),
      pct: totalMv > 0 ? (syms.reduce((s, x) => s + x.marketValue, 0) / totalMv) * 100 : 0,
      unrealized: syms.reduce((s, x) => s + x.marketValue - x.invested, 0),
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  const top5 = symbolRows.slice(0, 5).reduce((s, r) => s + r.pct, 0);
  const top10 = symbolRows.slice(0, 10).reduce((s, r) => s + r.pct, 0);
  const hhi = symbolRows.reduce((s, r) => s + (r.pct / 100) ** 2, 0);

  return (
    <div className="flex flex-col gap-6">
      {symbolRows.length > 0 && (
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Holdings', value: symbolRows.length.toString() },
            { label: 'Sectors', value: sectorRows.length.toString() },
            { label: 'Top 5 Weight', value: `${fmt(top5, 1)}%` },
            { label: 'HHI', value: fmt(hhi, 3), sub: `Top 10: ${fmt(top10, 1)}%` },
          ].map(({ label, value, sub }) => (
            <Card key={label}>
              <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                {label}
              </div>
              <div className="tnum mt-1.5 text-xl font-semibold">{value}</div>
              {sub && <div className="mt-1 text-xs text-[var(--color-muted)]">{sub}</div>}
            </Card>
          ))}
        </section>
      )}

      {sectorRows.length > 0 && (
        <Card>
          <div className="mb-3 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Allocation by Sector
          </div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
            {sectorRows.map((s, i) => (
              <div
                key={s.sector}
                className={`h-full bg-gradient-to-r ${sc(i)}`}
                style={{ width: `${s.pct}%` }}
                title={`${s.sector}: ${fmt(s.pct, 1)}%`}
              />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {sectorRows.map((s, i) => (
              <div key={s.sector} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-full bg-gradient-to-r ${sc(i)}`} />
                <span className="text-[var(--color-fg)]">{s.sector}</span>
                <span className="tnum text-[var(--color-muted)]">{fmt(s.pct, 1)}%</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Sector Breakdown</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Sectors mapped from the broker statement.
          </p>
        </div>
        {sectorRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No holdings to display.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-[var(--color-border)]">
            {sectorRows.map((s, i) => (
              <li key={s.sector} className="px-5 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-3 w-3 rounded-full bg-gradient-to-r ${sc(i)}`} />
                    <span className="font-semibold">{s.sector}</span>
                    <span className="text-xs text-[var(--color-muted)]">
                      {s.symbols.length} {s.symbols.length === 1 ? 'symbol' : 'symbols'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-3 text-sm">
                    <span className="tnum text-[var(--color-muted)]">{fmtCr(s.marketValue)}</span>
                    <span
                      className={`tnum text-xs ${s.unrealized >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}`}
                    >
                      {s.unrealized >= 0 ? '+' : ''}
                      {fmtCr(s.unrealized)}
                    </span>
                    <span className="tnum w-14 text-right font-semibold">{fmt(s.pct, 1)}%</span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${sc(i)} transition-[width] duration-300`}
                    style={{ width: `${Math.max(s.pct, 0.5)}%` }}
                  />
                </div>
                <ul className="mt-2 flex flex-col gap-1">
                  {s.symbols.map((sym) => (
                    <li
                      key={sym.symbol}
                      className="flex items-center justify-between gap-3 pl-5 text-xs"
                    >
                      <span className="text-[var(--color-muted)]">{sym.symbol}</span>
                      <div className="flex items-baseline gap-3">
                        <span className="tnum text-[var(--color-muted)]">
                          {fmtCr(sym.marketValue)}
                        </span>
                        <span className="tnum w-12 text-right">{fmt(sym.pct, 1)}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Risk ──────────────────────────────────────────────────────────────────────

function hhiLabel(hhi: number): { label: string; tone: 'pos' | 'warning' | 'neg' } {
  if (hhi < 0.15) return { label: 'Diversified', tone: 'pos' };
  if (hhi < 0.25) return { label: 'Moderate', tone: 'warning' };
  return { label: 'Concentrated', tone: 'neg' };
}

async function RiskSection({ portfolioId }: { portfolioId: string }) {
  const trades = getTradesForPortfolio(db, portfolioId);
  const normalized = trades.filter((t) => t.isIntradayPairId === null).map(toNorm);
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const symbols = positions.map((p) => p.symbol);
  const latestPrices = getLatestPrices(db, symbols);

  const symbolRows = positions.map((p) => {
    const cmp = latestPrices.get(p.symbol)?.close ?? p.avgCost;
    return {
      symbol: p.symbol,
      sector: getSector(p.symbol),
      qty: p.qty,
      cmp,
      marketValue: cmp * p.qty,
      pct: 0,
    };
  });
  const totalMv = symbolRows.reduce((s, r) => s + r.marketValue, 0);
  for (const r of symbolRows) r.pct = totalMv > 0 ? (r.marketValue / totalMv) * 100 : 0;
  symbolRows.sort((a, b) => b.marketValue - a.marketValue);

  if (symbolRows.length === 0) {
    return (
      <Card>
        <p className="px-2 py-8 text-center text-sm text-[var(--color-muted)]">
          Upload a tradebook to see concentration & risk metrics.
        </p>
      </Card>
    );
  }

  const hhi = computeHHI(symbolRows.map((r) => r.pct / 100));
  const top5 = symbolRows.slice(0, 5).reduce((s, r) => s + r.pct, 0);
  const top10 = symbolRows.slice(0, 10).reduce((s, r) => s + r.pct, 0);
  const hhiTag = hhiLabel(hhi);

  const sectorYourPct = new Map<string, number>();
  for (const r of symbolRows)
    sectorYourPct.set(r.sector, (sectorYourPct.get(r.sector) ?? 0) + r.pct);
  const sectorKeys = new Set([...sectorYourPct.keys(), ...Object.keys(NIFTY50_SECTOR_WEIGHTS)]);
  const sectorRows: SectorWeightRow[] = [...sectorKeys]
    .map((sector) => ({
      sector,
      yourPct: sectorYourPct.get(sector) ?? 0,
      niftyPct: getNiftyWeight(sector),
    }))
    .filter((r) => r.yourPct > 0 || r.niftyPct > 0)
    .sort((a, b) => b.yourPct + b.niftyPct - (a.yourPct + a.niftyPct));

  const today = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 365 * 2 * 86_400_000).toISOString().slice(0, 10);
  const symbolHist = getCloseHistory(db, symbols, start, today);
  let niftyMap: Map<string, number>;
  try {
    niftyMap = await getNifty50SeriesCached(start, today);
  } catch {
    niftyMap = new Map();
  }

  const betas = new Map<string, number | null>();
  for (const sym of symbols) {
    const hist = symbolHist.get(sym) ?? [];
    if (hist.length < 60 || niftyMap.size === 0) {
      betas.set(sym, null);
      continue;
    }
    const sc: number[] = [];
    const nc: number[] = [];
    for (const row of hist) {
      const n = niftyMap.get(row.date);
      if (n == null) continue;
      sc.push(row.close);
      nc.push(n);
    }
    betas.set(sym, beta(sc, nc));
  }
  const portBeta = portfolioBeta(
    symbolRows.map((r) => ({ symbol: r.symbol, marketValue: r.marketValue })),
    betas,
  );
  const betaRows = symbolRows.map((r) => {
    const b = betas.get(r.symbol) ?? null;
    return { ...r, beta: b, exposure: b == null ? null : r.marketValue * b };
  });
  const totalBetaExposure = betaRows.reduce((s, r) => s + (r.exposure ?? 0), 0);
  const coveredMv = betaRows.filter((r) => r.beta != null).reduce((s, r) => s + r.marketValue, 0);

  return (
    <div className="flex flex-col gap-6">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            HHI
          </div>
          <div className="tnum mt-1.5 text-xl font-semibold">{fmt(hhi, 3)}</div>
          <div className="mt-1">
            <Badge tone={hhiTag.tone}>{hhiTag.label}</Badge>
          </div>
        </Card>
        <Card>
          <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Top 5 Weight
          </div>
          <div className="tnum mt-1.5 text-xl font-semibold">{fmt(top5, 1)}%</div>
        </Card>
        <Card>
          <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Top 10 Weight
          </div>
          <div className="tnum mt-1.5 text-xl font-semibold">{fmt(top10, 1)}%</div>
        </Card>
        <Card>
          <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            Portfolio Beta
          </div>
          <div className="tnum mt-1.5 text-xl font-semibold">
            {portBeta == null ? 'n/a' : fmt(portBeta, 2)}
          </div>
          <div className="mt-1 text-xs text-[var(--color-muted)]">
            {portBeta == null
              ? 'Insufficient history'
              : `Covered: ${fmt((coveredMv / totalMv) * 100, 0)}% of MV`}
          </div>
        </Card>
      </section>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Sector vs Nifty 50</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Your sector weights compared with an approximate Nifty 50 sector composition (as of{' '}
            {NIFTY50_AS_OF}).
          </p>
        </div>
        <div className="p-5">
          <SectorVsNiftyChart rows={sectorRows} />
        </div>
        <div className="overflow-x-auto border-t border-[var(--color-border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-card-hover)]">
              <tr className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-4 py-2 text-left">Sector</th>
                <th className="px-4 py-2 text-right">Your Weight</th>
                <th className="px-4 py-2 text-right">Nifty 50</th>
                <th className="px-4 py-2 text-right">Δ (You − Nifty)</th>
              </tr>
            </thead>
            <tbody>
              {sectorRows.map((r) => {
                const delta = r.yourPct - r.niftyPct;
                return (
                  <tr key={r.sector} className="border-t border-[var(--color-border)]">
                    <td className="px-4 py-2">{r.sector}</td>
                    <td className="tnum px-4 py-2 text-right">{fmt(r.yourPct, 1)}%</td>
                    <td className="tnum px-4 py-2 text-right text-[var(--color-muted)]">
                      {fmt(r.niftyPct, 1)}%
                    </td>
                    <td
                      className={`tnum px-4 py-2 text-right font-medium ${delta >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}`}
                    >
                      {delta >= 0 ? '+' : ''}
                      {fmt(delta, 1)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Single-Name Concentration</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Top 10 holdings by market value. Names exceeding 10% of NAV are flagged.
          </p>
        </div>
        <ul className="flex flex-col divide-y divide-[var(--color-border)]">
          {symbolRows.slice(0, 10).map((r) => {
            const ow = r.pct > 10;
            return (
              <li key={r.symbol} className="px-5 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/p/${portfolioId}/symbol/${encodeURIComponent(r.symbol)}`}
                      className="font-medium hover:text-[var(--color-accent)]"
                    >
                      {r.symbol}
                    </Link>
                    <span className="text-xs text-[var(--color-muted)]">{r.sector}</span>
                    {ow && <Badge tone="neg">Overweight</Badge>}
                  </div>
                  <div className="flex items-baseline gap-3">
                    <span className="tnum text-xs text-[var(--color-muted)]">
                      {fmtCr(r.marketValue)}
                    </span>
                    <span
                      className={`tnum w-14 text-right font-semibold ${ow ? 'text-[var(--color-neg)]' : ''}`}
                    >
                      {fmt(r.pct, 1)}%
                    </span>
                  </div>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${ow ? 'bg-[var(--color-neg)]' : 'bg-[var(--color-accent)]'}`}
                    style={{ width: `${Math.min(Math.max(r.pct, 0.5), 100)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">Beta-Weighted Exposure</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Per-symbol qty × CMP × β. Symbols with insufficient history (β = n/a) excluded from
            total.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-card-hover)]">
              <tr className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-4 py-2 text-left">Symbol</th>
                <th className="px-4 py-2 text-right">Qty</th>
                <th className="px-4 py-2 text-right">CMP</th>
                <th className="px-4 py-2 text-right">Market Value</th>
                <th className="px-4 py-2 text-right">β</th>
                <th className="px-4 py-2 text-right">β-Adj Exposure</th>
              </tr>
            </thead>
            <tbody>
              {betaRows.map((r) => (
                <tr key={r.symbol} className="border-t border-[var(--color-border)]">
                  <td className="px-4 py-2 font-medium">
                    <Link
                      href={`/p/${portfolioId}/symbol/${encodeURIComponent(r.symbol)}`}
                      className="hover:text-[var(--color-accent)]"
                    >
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="tnum px-4 py-2 text-right">{fmt(r.qty, 0)}</td>
                  <td className="tnum px-4 py-2 text-right">₹{fmt(r.cmp, 2)}</td>
                  <td className="tnum px-4 py-2 text-right">{fmtCr(r.marketValue)}</td>
                  <td
                    className={`tnum px-4 py-2 text-right ${r.beta == null ? 'text-[var(--color-muted)]' : ''}`}
                  >
                    {r.beta == null ? 'n/a' : fmt(r.beta, 2)}
                  </td>
                  <td
                    className={`tnum px-4 py-2 text-right ${r.exposure == null ? 'text-[var(--color-muted)]' : 'font-medium'}`}
                  >
                    {r.exposure == null ? '—' : fmtCr(r.exposure)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--color-border-strong)] bg-[var(--color-card-hover)]">
                <td className="px-4 py-2 text-xs font-semibold tracking-wide uppercase" colSpan={3}>
                  Total β-Adjusted Exposure
                </td>
                <td className="tnum px-4 py-2 text-right">{fmtCr(coveredMv)}</td>
                <td className="tnum px-4 py-2 text-right">
                  {portBeta == null ? 'n/a' : fmt(portBeta, 2)}
                </td>
                <td className="tnum px-4 py-2 text-right font-semibold">
                  {fmtCr(totalBetaExposure)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Cohorts ───────────────────────────────────────────────────────────────────

function cohortXirr(
  symbolsInCohort: Set<string>,
  trades: NormalizedTrade[],
  cohortMv: number,
  asOfDate: string,
): number | null {
  const flowsByDate = new Map<string, number>();
  for (const t of trades) {
    if (!symbolsInCohort.has(t.symbol)) continue;
    const amt = (t.side === 'buy' ? -1 : 1) * t.qty * t.price;
    flowsByDate.set(t.tradeDate, (flowsByDate.get(t.tradeDate) ?? 0) + amt);
  }
  if (cohortMv > 0) flowsByDate.set(asOfDate, (flowsByDate.get(asOfDate) ?? 0) + cohortMv);
  const cf = [...flowsByDate.entries()]
    .filter(([, a]) => a !== 0)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (cf.length < 2 || !cf.some((c) => c.amount < 0) || !cf.some((c) => c.amount > 0)) return null;
  try {
    return xirr(cf);
  } catch {
    return null;
  }
}

async function CohortsSection({ portfolioId }: { portfolioId: string }) {
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const aliased = applySymbolAliases(
    allTrades.filter((t) => t.isIntradayPairId === null).map(toNorm),
  );
  const symbols = Array.from(new Set(aliased.map((t) => t.symbol)));
  const priceMap = getLatestPrices(db, symbols);
  const cmpBySymbol = new Map<string, number>();
  let latestPriceDate = '';
  for (const [sym, p] of priceMap) {
    cmpBySymbol.set(sym, p.close);
    if (p.date > latestPriceDate) latestPriceDate = p.date;
  }
  const asOfDate = latestPriceDate || new Date().toISOString().slice(0, 10);

  const aggregates = buildSymbolAggregates(
    allTrades.filter((t) => t.isIntradayPairId === null).map(toNorm),
    KNOWN_CORPORATE_ACTIONS,
    cmpBySymbol,
  );
  const fyRows = aggregateByEntryFy(aggregates);
  const sectorRowsRaw = aggregateBySector(aggregates);

  function sectorOf(a: SymbolAggregate): string | null {
    for (const r of sectorRowsRaw) {
      if (r.symbols.includes(a.symbol)) return r.bucket;
    }
    return null;
  }
  function groupByBucket(aggs: SymbolAggregate[], keyFn: (a: SymbolAggregate) => string) {
    const m = new Map<string, SymbolAggregate[]>();
    for (const a of aggs) {
      const k = keyFn(a);
      const arr = m.get(k);
      if (arr) arr.push(a);
      else m.set(k, [a]);
    }
    return m;
  }
  const fyAggs = groupByBucket(aggregates, (a) => a.firstBuyFy);
  const secAggs = groupByBucket(aggregates, (a) => sectorOf(a) ?? 'Unclassified');

  const fyRowsX = fyRows.map((r) => ({
    ...r,
    xirr: cohortXirr(
      new Set(fyAggs.get(r.bucket)?.map((a) => a.symbol) ?? []),
      aliased,
      r.marketValue,
      asOfDate,
    ),
  }));
  const secRowsX = sectorRowsRaw.map((r) => ({
    ...r,
    xirr: cohortXirr(
      new Set(secAggs.get(r.bucket)?.map((a) => a.symbol) ?? []),
      aliased,
      r.marketValue,
      asOfDate,
    ),
  }));

  const totalInvested = aggregates.reduce((s, a) => s + a.invested, 0);
  const totalRealized = aggregates.reduce((s, a) => s + a.realizedPnl, 0);
  const totalUnrealized = aggregates.reduce((s, a) => s + a.unrealizedPnl, 0);
  const totalMv = aggregates.reduce((s, a) => s + a.marketValue, 0);

  function CohortTable({
    rows,
    bucketLabel,
  }: {
    rows: (CohortRow & { xirr: number | null })[];
    bucketLabel: string;
  }) {
    return (
      <>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-card)]">
              <tr className="border-b border-[var(--color-border)] text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-5 py-3 text-left">{bucketLabel}</th>
                <th className="px-3 py-3 text-right">Symbols</th>
                <th className="px-3 py-3 text-right">Invested</th>
                <th className="px-3 py-3 text-right">Mkt Value</th>
                <th className="px-3 py-3 text-right">Realized</th>
                <th className="px-3 py-3 text-right">Unrealized</th>
                <th className="px-3 py-3 text-right">Return</th>
                <th className="px-3 py-3 text-right">XIRR</th>
                <th className="px-5 py-3 text-right">Weight</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.bucket}
                  className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-card-hover)]"
                >
                  <td className="px-5 py-3">
                    <div className="font-medium">{r.bucket}</div>
                    <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                      {r.symbols.slice(0, 5).join(', ')}
                      {r.symbols.length > 5 ? ` +${r.symbols.length - 5}` : ''}
                    </div>
                  </td>
                  <td className="tnum px-3 py-3 text-right">{r.symbols.length}</td>
                  <td className="tnum px-3 py-3 text-right text-[var(--color-muted)]">
                    {fmtCr(r.invested)}
                  </td>
                  <td className="tnum px-3 py-3 text-right font-medium">{fmtCr(r.marketValue)}</td>
                  <td className={`tnum px-3 py-3 text-right ${pnlClass(r.realizedPnl)}`}>
                    {r.realizedPnl !== 0
                      ? `${r.realizedPnl >= 0 ? '+' : ''}${fmtCr(r.realizedPnl)}`
                      : '—'}
                  </td>
                  <td className={`tnum px-3 py-3 text-right ${pnlClass(r.unrealizedPnl)}`}>
                    {r.unrealizedPnl !== 0
                      ? `${r.unrealizedPnl >= 0 ? '+' : ''}${fmtCr(r.unrealizedPnl)}`
                      : '—'}
                  </td>
                  <td
                    className={`tnum px-3 py-3 text-right font-semibold ${pnlClass(r.totalReturnPct)}`}
                  >
                    {r.totalReturnPct >= 0 ? '+' : ''}
                    {fmt(r.totalReturnPct, 1)}%
                  </td>
                  <td className={`tnum px-3 py-3 text-right ${pnlClass(r.xirr)}`}>
                    {r.xirr != null ? `${r.xirr >= 0 ? '+' : ''}${fmt(r.xirr * 100, 1)}%` : '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="inline-flex flex-col items-end gap-1">
                      <span className="tnum text-xs font-semibold">{fmt(r.weightPct, 1)}%</span>
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-[var(--color-border)]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[#7c3aed]"
                          style={{ width: `${Math.min(Math.max(r.weightPct, 0.5), 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="flex flex-col divide-y divide-[var(--color-border)] md:hidden">
          {rows.map((r) => (
            <li key={r.bucket} className="flex flex-col gap-2 px-5 py-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold">{r.bucket}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-muted)]">
                    {r.symbols.length} symbol{r.symbols.length === 1 ? '' : 's'} ·{' '}
                    {fmtCr(r.invested)} invested
                  </div>
                </div>
                <div className="text-right">
                  <div className="tnum text-sm font-medium">{fmtCr(r.marketValue)}</div>
                  <div className={`tnum text-xs font-semibold ${pnlClass(r.totalReturnPct)}`}>
                    {r.totalReturnPct >= 0 ? '+' : ''}
                    {fmt(r.totalReturnPct, 1)}%
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {r.realizedPnl !== 0 && (
                  <Badge tone={r.realizedPnl >= 0 ? 'pos' : 'neg'}>
                    Realized {r.realizedPnl >= 0 ? '+' : ''}
                    {fmtCr(r.realizedPnl)}
                  </Badge>
                )}
                {r.unrealizedPnl !== 0 && (
                  <Badge tone={r.unrealizedPnl >= 0 ? 'pos' : 'neg'}>
                    Unrealized {r.unrealizedPnl >= 0 ? '+' : ''}
                    {fmtCr(r.unrealizedPnl)}
                  </Badge>
                )}
                {r.xirr != null && (
                  <Badge tone={r.xirr >= 0 ? 'info' : 'warning'}>
                    XIRR {r.xirr >= 0 ? '+' : ''}
                    {fmt(r.xirr * 100, 1)}%
                  </Badge>
                )}
                <Badge>Weight {fmt(r.weightPct, 1)}%</Badge>
              </div>
            </li>
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {aggregates.length > 0 && (
        <section className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] shadow-[var(--shadow-sm)]">
          <div className="grid grid-cols-2 divide-x divide-[var(--color-border)] sm:grid-cols-4">
            {[
              { label: 'Symbols', value: aggregates.length.toString() },
              { label: 'Invested', value: fmtCr(totalInvested) },
              {
                label: 'Realized',
                value: `${totalRealized >= 0 ? '+' : ''}${fmtCr(totalRealized)}`,
                cls: pnlClass(totalRealized),
              },
              {
                label: 'Unrealized',
                value: `${totalUnrealized >= 0 ? '+' : ''}${fmtCr(totalUnrealized)}`,
                cls: pnlClass(totalUnrealized),
              },
            ].map(({ label, value, cls }) => (
              <div key={label} className="px-5 py-5">
                <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                  {label}
                </div>
                <div className={`tnum mt-1.5 text-xl font-semibold${cls ? ' ' + cls : ''}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">By Entry Financial Year</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Each symbol bucketed by FY of its first buy.
          </p>
        </div>
        {fyRowsX.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No positions yet.
          </p>
        ) : (
          <CohortTable rows={fyRowsX} bucketLabel="FY" />
        )}
      </Card>
      <Card padded={false} className="overflow-hidden">
        <div className="border-b border-[var(--color-border)] px-5 py-4">
          <h2 className="text-sm font-semibold">By Sector</h2>
          <p className="text-xs text-[var(--color-muted)]">
            Sector mapping curated from your Zerodha holdings statement.
          </p>
        </div>
        {secRowsX.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-[var(--color-muted)]">
            No positions yet.
          </p>
        ) : (
          <CohortTable rows={secRowsX} bucketLabel="Sector" />
        )}
      </Card>
    </div>
  );
}

// ── Compare ───────────────────────────────────────────────────────────────────

async function CompareSection({
  portfolioId,
  symbols,
}: {
  portfolioId: string;
  symbols: string[];
}) {
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const normalized = allTrades.filter((t) => t.isIntradayPairId === null).map(toNorm);
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const positionBySymbol = new Map(positions.map((p) => [p.symbol, p]));
  const portfolioSymbols = positions.map((p) => p.symbol);

  const watchlistEntries = listWatchlist(db, portfolioId);
  const watchlistSymbols = watchlistEntries.map((e) => e.symbol);
  const portfolioSet = new Set(portfolioSymbols);
  const watchlistSet = new Set(watchlistSymbols);

  const suggestions: Array<{ symbol: string; source: 'portfolio' | 'watchlist' }> = [];
  for (const s of portfolioSymbols) suggestions.push({ symbol: s, source: 'portfolio' });
  for (const s of watchlistSymbols) {
    if (!portfolioSet.has(s)) suggestions.push({ symbol: s, source: 'watchlist' });
  }

  const prices = symbols.length > 0 ? getLatestPrices(db, symbols) : new Map();
  const today = new Date().toISOString().slice(0, 10);
  const stats = symbols.length > 0 ? getSymbolStats(db, symbols, today) : new Map();

  const columns: CompareColumn[] = symbols.map((symbol) => {
    const arSummaries = loadARSummaries(symbol);
    const concalls = loadConcallDigests(symbol);
    const stressTest = loadLatestThesisStressTest(symbol);
    const latestPrice = prices.get(symbol) ?? null;
    return buildCompareColumn({
      symbol,
      sector: getSector(symbol),
      inPortfolio: portfolioSet.has(symbol),
      inWatchlist: watchlistSet.has(symbol),
      position: positionBySymbol.get(symbol) ?? null,
      latestPrice,
      stats: stats.get(symbol) ?? null,
      arSummary: arSummaries[0] ?? null,
      concall: concalls[0] ?? null,
      stressTest,
      asOfDate: latestPrice?.date ?? today,
    });
  });

  const fundamentalKeyOrder: string[] = [];
  const fundamentalLabels = new Map<string, string>();
  for (const col of columns) {
    for (const f of col.fundamentals) {
      if (!fundamentalLabels.has(f.key)) {
        fundamentalKeyOrder.push(f.key);
        fundamentalLabels.set(f.key, f.label);
      }
    }
  }
  const fundamentalLookup = new Map<string, Map<string, number | null>>();
  for (const col of columns) {
    const m = new Map<string, number | null>();
    for (const f of col.fundamentals) m.set(f.key, f.value);
    fundamentalLookup.set(col.symbol, m);
  }

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-3">
          <div>
            <h2 className="text-sm font-semibold">Compare</h2>
            <p className="text-xs text-[var(--color-muted)]">
              2–5 symbols side-by-side. Reads from local price cache + skill JSON outputs only.
            </p>
          </div>
          <CompareSymbolPicker
            portfolioId={portfolioId}
            selected={symbols}
            suggestions={suggestions}
          />
        </div>
      </Card>

      {symbols.length === 0 ? (
        <Card>
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm font-medium">No symbols selected</p>
            <p className="text-xs text-[var(--color-muted)]">
              Pick symbols from your portfolio, watchlist, or type a ticker above.
            </p>
          </div>
        </Card>
      ) : symbols.length < 2 ? (
        <Card>
          <p className="text-xs text-[var(--color-muted)]">
            Add at least one more symbol to start comparing.
          </p>
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="sticky left-0 z-10 bg-[var(--color-card)] px-4 py-3 text-left text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
                    Metric
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.symbol}
                      className="min-w-[180px] border-l border-[var(--color-border)] px-4 py-3 text-left align-top"
                    >
                      <div className="flex flex-col gap-1.5">
                        <Link
                          href={`/p/${portfolioId}/symbol/${encodeURIComponent(col.symbol)}`}
                          className="text-base font-semibold text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                        >
                          {col.symbol}
                        </Link>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge tone="neutral">{col.sector}</Badge>
                          {col.inPortfolio && <Badge tone="pos">in portfolio</Badge>}
                          {col.inWatchlist && !col.inPortfolio && (
                            <Badge tone="info">watchlist</Badge>
                          )}
                        </div>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                <SRow label="Price" n={columns.length} />
                <Row label="CMP" cols={columns}>
                  {(col) => (
                    <span className="tnum">
                      {col.price.cmp != null ? `₹${fmt(col.price.cmp)}` : '—'}
                      {col.price.priceDate ? (
                        <span className="ml-1 text-[10px] text-[var(--color-subtle)]">
                          {col.price.priceDate}
                        </span>
                      ) : null}
                    </span>
                  )}
                </Row>
                <Row label="52w high" cols={columns}>
                  {(col) => (
                    <span className="tnum">
                      {col.price.high52w != null ? `₹${fmt(col.price.high52w)}` : '—'}
                    </span>
                  )}
                </Row>
                <Row label="52w low" cols={columns}>
                  {(col) => (
                    <span className="tnum">
                      {col.price.low52w != null ? `₹${fmt(col.price.low52w)}` : '—'}
                    </span>
                  )}
                </Row>
                <Row label="Δ from 52w high" cols={columns}>
                  {(col) => (
                    <span className={`tnum ${distanceTone(col.price.distanceFromHighPct)}`}>
                      {fmtPctFrac(col.price.distanceFromHighPct, 1)}
                    </span>
                  )}
                </Row>
                <Row label="30d avg vol" cols={columns}>
                  {(col) => (
                    <span className="tnum text-[var(--color-muted)]">
                      {col.price.avgVolume30d != null ? fmt(col.price.avgVolume30d, 0) : '—'}
                    </span>
                  )}
                </Row>
                {columns.some((c) => c.position) && (
                  <>
                    <SRow label="Position (held only)" n={columns.length} />
                    <Row label="Qty" cols={columns}>
                      {(col) =>
                        col.position ? (
                          <span className="tnum">{fmt(col.position.qty, 0)}</span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                    <Row label="Avg cost" cols={columns}>
                      {(col) =>
                        col.position ? (
                          <span className="tnum">₹{fmt(col.position.avgCost)}</span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                    <Row label="Market value" cols={columns}>
                      {(col) =>
                        col.position?.marketValue != null ? (
                          <span className="tnum font-medium">
                            {fmtCr(col.position.marketValue)}
                          </span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                    <Row label="Unrealized %" cols={columns}>
                      {(col) =>
                        col.position?.pctReturn != null ? (
                          <span className={`tnum ${pnlClass(col.position.pctReturn)}`}>
                            {fmtPct(col.position.pctReturn)}
                          </span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                    <Row label="Holding period" cols={columns}>
                      {(col) =>
                        col.position?.holdingPeriodDays != null ? (
                          <span className="tnum text-[var(--color-muted)]">
                            {col.position.holdingPeriodDays}d
                            <span className="ml-1 text-[10px] text-[var(--color-subtle)]">
                              since {col.position.firstBuyDate}
                            </span>
                          </span>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                  </>
                )}
                <SRow
                  label={`Fundamentals${fundamentalKeyOrder.length === 0 ? ' (no AR summaries)' : ''}`}
                  n={columns.length}
                />
                {fundamentalKeyOrder.length === 0 ? (
                  <Row label="—" cols={columns}>
                    {() => (
                      <span className="text-xs text-[var(--color-subtle)]">
                        Run /annual-report-summarize to populate.
                      </span>
                    )}
                  </Row>
                ) : (
                  <>
                    <Row label="Source FY" cols={columns}>
                      {(col) =>
                        col.fundamentalsFy ? (
                          <Badge tone="info">{col.fundamentalsFy}</Badge>
                        ) : (
                          <span className="text-[var(--color-subtle)]">—</span>
                        )
                      }
                    </Row>
                    {fundamentalKeyOrder.map((k) => (
                      <Row key={k} label={fundamentalLabels.get(k) ?? k} cols={columns}>
                        {(col) => (
                          <span className="tnum">
                            {fmtFundamental(k, fundamentalLookup.get(col.symbol)?.get(k) ?? null)}
                          </span>
                        )}
                      </Row>
                    ))}
                  </>
                )}
                <SRow label="Latest concall" n={columns.length} />
                <Row label="Quarter" cols={columns}>
                  {(col) =>
                    col.concall ? (
                      <Badge tone="info">{col.concall.fq}</Badge>
                    ) : (
                      <span className="text-[var(--color-subtle)]">—</span>
                    )
                  }
                </Row>
                <Row label="Revenue guidance" cols={columns}>
                  {(col) => (
                    <span className="tnum">
                      {fmtPctFrac(col.concall?.revenueGrowthYoy ?? null, 1)}
                    </span>
                  )}
                </Row>
                <Row label="EBITDA guidance" cols={columns}>
                  {(col) => (
                    <span className="tnum">{fmtPctFrac(col.concall?.ebitdaMargin ?? null, 1)}</span>
                  )}
                </Row>
                <Row label="Mgmt tone" cols={columns}>
                  {(col) => {
                    const t = col.concall?.managementToneScore ?? null;
                    if (t == null) return <span className="text-[var(--color-subtle)]">—</span>;
                    return (
                      <Badge tone={t > 0 ? 'pos' : t < 0 ? 'neg' : 'neutral'}>
                        {t >= 0 ? '+' : ''}
                        {t}
                      </Badge>
                    );
                  }}
                </Row>
                <SRow label="Thesis stress test" n={columns.length} />
                <Row label="Verdict" cols={columns}>
                  {(col) =>
                    col.stressTest ? (
                      <Badge tone={verdictTone(col.stressTest.verdict)}>
                        {col.stressTest.verdict}
                      </Badge>
                    ) : (
                      <span className="text-[var(--color-subtle)]">—</span>
                    )
                  }
                </Row>
                <Row label="Run at" cols={columns}>
                  {(col) =>
                    col.stressTest ? (
                      <span className="text-xs text-[var(--color-muted)]">
                        {col.stressTest.runAt.slice(0, 10)}
                      </span>
                    ) : (
                      <span className="text-[var(--color-subtle)]">—</span>
                    )
                  }
                </Row>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function SRow({ label, n }: { label: string; n: number }) {
  return (
    <tr className="bg-[var(--color-card-hover)]">
      <td
        colSpan={n + 1}
        className="px-4 py-2 text-[11px] font-semibold tracking-wide text-[var(--color-muted)] uppercase"
      >
        {label}
      </td>
    </tr>
  );
}
function Row({
  label,
  cols,
  children,
}: {
  label: string;
  cols: CompareColumn[];
  children: (col: CompareColumn) => React.ReactNode;
}) {
  return (
    <tr>
      <td className="sticky left-0 z-[1] bg-[var(--color-card)] px-4 py-2.5 text-xs font-medium text-[var(--color-muted)]">
        {label}
      </td>
      {cols.map((col) => (
        <td
          key={col.symbol}
          className="border-l border-[var(--color-border)] px-4 py-2.5 align-top"
        >
          {children(col)}
        </td>
      ))}
    </tr>
  );
}
