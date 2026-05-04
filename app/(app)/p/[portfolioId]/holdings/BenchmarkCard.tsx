import { db } from '@/lib/db/client';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { listDividendsForPortfolio } from '@/lib/db/queries/dividends';
import { getCloseHistory, getLatestPrices } from '@/lib/db/queries/prices';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import { runningOpenPositionsBySymbol } from '@/lib/analytics/runningPositions';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import type { NormalizedTrade } from '@/lib/parsers/types';
import { tradesAndDividendsToCashflows } from '@/lib/analytics/portfolioCashflows';
import { xirr, type Cashflow } from '@/lib/analytics/xirr';
import { computeBenchmarkXirr } from '@/lib/analytics/benchmarkXirr';
import {
  buildBenchmarkReturnSeries,
  buildPortfolioReturnSeries,
} from '@/lib/analytics/benchmarkSeries';
import {
  BENCHMARKS,
  fetchBenchmarkClose,
  getBenchmarkSeriesCached,
  type BenchmarkId,
} from '@/lib/pricing/benchmarks';
import {
  MF_BENCHMARKS,
  getMfNavSeriesCached,
  type MfBenchmarkId,
} from '@/lib/pricing/mfBenchmarks';
import { Card } from '@/components/ui/Card';
import { BenchmarkChartClient, type BenchmarkBundle } from './BenchmarkChartClient';

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pnlClass(n: number | null) {
  if (n == null) return 'text-[var(--color-muted)]';
  return n >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
}

function safeXirr(cfs: Cashflow[]): number | null {
  try {
    return xirr(cfs);
  } catch {
    return null;
  }
}

async function safeBenchmarkXirr(
  cfs: Cashflow[],
  series: Map<string, number>,
  currentClose: number,
  terminalDate: string,
): Promise<number | null> {
  try {
    return computeBenchmarkXirr(cfs, series, currentClose, terminalDate);
  } catch {
    return null;
  }
}

function safeBenchmarkSeries(
  cfs: Cashflow[],
  series: Map<string, number>,
  terminalDate: string,
  currentClose: number,
) {
  try {
    return buildBenchmarkReturnSeries(cfs, series, terminalDate, currentClose);
  } catch {
    return [];
  }
}

function yearsSince(iso: string, today: string): number {
  const a = Date.parse(`${iso}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return (b - a) / (365 * 86_400_000);
}

type Props = { portfolioId: string };

export async function BenchmarkCard({ portfolioId }: Props) {
  const trades = getTradesForPortfolio(db, portfolioId);
  if (trades.length === 0) return null;

  const dividends = listDividendsForPortfolio(db, portfolioId);
  const cashflows = tradesAndDividendsToCashflows(trades, dividends);
  if (cashflows.length === 0) return null;

  // Compute open positions via FIFO (matches the holdings page).
  const deliveryTrades = trades.filter((t) => t.isIntradayPairId === null);
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
  const prices = getLatestPrices(
    db,
    openPositions.map((h) => h.symbol),
  );

  const today = new Date().toISOString().slice(0, 10);
  const startDate = cashflows[0]!.date;
  const yearsInvested = Math.max(0, yearsSince(startDate, today));

  // Determine current portfolio MV — null if any open holding is missing CMP.
  let portfolioMv: number | null = 0;
  let missingCmpSymbol: string | null = null;
  for (const h of openPositions) {
    const p = prices.get(h.symbol);
    if (p?.close == null) {
      portfolioMv = null;
      missingCmpSymbol = h.symbol;
      break;
    }
    portfolioMv += p.close * h.qty;
  }

  // Portfolio stats.
  const portfolioCfs: Cashflow[] = [...cashflows];
  if (portfolioMv != null && portfolioMv > 0) {
    portfolioCfs.push({ date: today, amount: portfolioMv });
  }
  const portfolioRate = portfolioMv != null ? safeXirr(portfolioCfs) : null;

  // Live XIRR (Zerodha-style): per-lot cashflows for currently-held lots only,
  // plus dividends received during their holding window, plus current MV.
  // Per Zerodha docs: "Combines your current holdings... It does not take into
  // account historical buy and sell trades."
  let liveRate: number | null = null;
  if (portfolioMv != null && portfolioMv > 0) {
    const liveCfs: Cashflow[] = [];
    for (const p of openPositions) {
      for (const lot of p.lots) {
        liveCfs.push({ date: lot.date, amount: -lot.qty * lot.costPerShare });
      }
    }
    for (const d of dividends) {
      const pos = openPositions.find((p) => p.symbol === d.symbol);
      if (pos && d.exDate >= pos.firstBuyDate) {
        liveCfs.push({ date: d.exDate, amount: d.netAmount });
      }
    }
    liveCfs.push({ date: today, amount: portfolioMv });
    liveRate = safeXirr(liveCfs);
  }

  // Header: portfolio-only stats are always shown (even without CMP).
  const headerStats = (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile
        label="Live XIRR (held lots)"
        value={fmtPct(liveRate)}
        valueClass={pnlClass(liveRate)}
        sublabel="Currently-held lots only — matches Zerodha"
      />
      <StatTile
        label="All-time XIRR"
        value={fmtPct(portfolioRate)}
        valueClass={pnlClass(portfolioRate)}
        sublabel="Every trade + dividend across the full history"
      />
      <StatTile label="Years Invested" value={yearsInvested.toFixed(2)} />
    </div>
  );

  // If no CMP, show header + a hint. No chart.
  if (portfolioMv == null) {
    return (
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">Portfolio vs Benchmarks</h3>
              <p className="text-xs text-[var(--color-muted)]">
                Money-weighted XIRR on actual trades + dividends, against benchmarks.
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-card-hover)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-muted)]">
              Refresh prices to enable comparisons
              {missingCmpSymbol ? ` (${missingCmpSymbol} missing CMP)` : ''}
            </span>
          </div>
          {headerStats}
        </div>
      </Card>
    );
  }

  // Pre-fetch all 3 benchmark series in parallel. The shared rate-limiter
  // serialises actual HTTP requests so we don't hammer Yahoo.
  const seriesList = await Promise.all(
    BENCHMARKS.map((b) => getBenchmarkSeriesCached(b.id, startDate, today)),
  );
  const seriesById = new Map<BenchmarkId, Map<string, number>>(
    BENCHMARKS.map((b, i) => [b.id, seriesList[i] ?? new Map()]),
  );

  const closeList = await Promise.all(BENCHMARKS.map((b) => fetchBenchmarkClose(b.id, today)));
  const closeById = new Map<BenchmarkId, number | null>(
    BENCHMARKS.map((b, i) => [b.id, closeList[i] ?? null]),
  );

  // Build per-benchmark bundle (XIRR, CAGR, return series).
  const benchmarkBundles: BenchmarkBundle[] = await Promise.all(
    BENCHMARKS.map(async (b) => {
      const series = seriesById.get(b.id) ?? new Map<string, number>();
      const currentClose = closeById.get(b.id) ?? 0;
      const xirrRate =
        currentClose > 0 ? await safeBenchmarkXirr(cashflows, series, currentClose, today) : null;
      const points =
        currentClose > 0 ? safeBenchmarkSeries(cashflows, series, today, currentClose) : [];
      return {
        id: b.id,
        label: b.label,
        series: points,
        xirr: xirrRate,
      };
    }),
  );

  // Mutual-fund benchmarks (mfapi.in / AMFI). Same shape as index benchmarks —
  // `buildBenchmarkReturnSeries` and `computeBenchmarkXirr` are agnostic to
  // whether the date→close map is an index or a fund NAV. Funds whose history
  // begins after the user's first cashflow degrade gracefully via the
  // `safe*` wrappers (they catch and return null/[] rather than failing the
  // whole chart).
  const mfSeriesList = await Promise.all(
    MF_BENCHMARKS.map((b) => getMfNavSeriesCached(b.id, startDate, today)),
  );
  const mfSeriesById = new Map<MfBenchmarkId, Map<string, number>>(
    MF_BENCHMARKS.map((b, i) => [b.id, mfSeriesList[i] ?? new Map()]),
  );
  const mfBundles: BenchmarkBundle[] = await Promise.all(
    MF_BENCHMARKS.map(async (b) => {
      const series = mfSeriesById.get(b.id) ?? new Map<string, number>();
      // Most recent NAV in the cached series == "current close" for the fund.
      let currentClose = 0;
      let latestKey = '';
      for (const k of series.keys()) {
        if (k > latestKey) {
          latestKey = k;
          currentClose = series.get(k) ?? 0;
        }
      }
      const xirrRate =
        currentClose > 0 ? await safeBenchmarkXirr(cashflows, series, currentClose, today) : null;
      const points =
        currentClose > 0 ? safeBenchmarkSeries(cashflows, series, today, currentClose) : [];
      return {
        id: b.id,
        label: b.label,
        series: points,
        xirr: xirrRate,
      };
    }),
  );
  benchmarkBundles.push(...mfBundles);

  // Build the per-symbol qty timeline + load batched daily price history for
  // every symbol the user ever held. With these in hand the portfolio MV at
  // each emitted date is computed properly (no more flat 0% line).
  const qtyTimelines = runningOpenPositionsBySymbol(normalized, KNOWN_CORPORATE_ACTIONS);
  const allSymbols = [...qtyTimelines.keys()];
  const aliasedTrades = applySymbolAliases(normalized);
  const earliestTradeDate = aliasedTrades.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    aliasedTrades[0]?.tradeDate ?? startDate,
  );
  const closeHistByArr = getCloseHistory(db, allSymbols, earliestTradeDate, today);
  const priceHistories = new Map<string, Map<string, number>>();
  for (const [sym, rows] of closeHistByArr) {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.date, r.close);
    priceHistories.set(sym, m);
  }
  const symbolsMissingHistory = allSymbols.filter(
    (s) => !priceHistories.has(s) || priceHistories.get(s)!.size < 2,
  );
  if (symbolsMissingHistory.length > 0) {
    console.warn(
      `[BenchmarkCard] missing price history for ${symbolsMissingHistory.length} symbol(s); ` +
        `chart will fall back to flat-line for them. Run backfill: ${symbolsMissingHistory
          .slice(0, 8)
          .join(', ')}${symbolsMissingHistory.length > 8 ? ' …' : ''}`,
    );
  }

  const portfolioSeries = buildPortfolioReturnSeries(cashflows, portfolioMv, today, {
    priceHistories,
    qtyTimelines,
    monthlySamples: true,
  });

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-sm font-semibold">Portfolio vs Benchmarks</h3>
          <p className="text-xs text-[var(--color-muted)]">
            Money-weighted XIRR on actual trades + dividends, against the same rupees mirrored into
            each benchmark index on the same dates.
          </p>
        </div>

        {headerStats}

        <BenchmarkChartClient
          portfolio={{
            label: 'Portfolio',
            series: portfolioSeries,
            xirr: portfolioRate,
          }}
          benchmarks={benchmarkBundles}
          defaultSelected={['nifty50']}
        />
      </div>
    </Card>
  );
}

function StatTile({
  label,
  value,
  valueClass,
  sublabel,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 py-3">
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className={`tnum mt-1 text-xl font-semibold ${valueClass ?? ''}`}>{value}</div>
      {sublabel ? (
        <div className="mt-1 text-[10px] leading-snug text-[var(--color-subtle)]">{sublabel}</div>
      ) : null}
    </div>
  );
}
