'use client';

import { useMemo, useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from 'recharts';

export type BenchmarkPoint = { date: string; returnPct: number };

export type BenchmarkBundle = {
  id: string;
  label: string;
  series: BenchmarkPoint[];
  xirr: number | null;
};

export type WindowId = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL';

export type WindowBundle = {
  id: WindowId;
  label: string;
  startDate: string;
  portfolioXirr: number | null;
  benchmarkXirrs: Record<string, number | null>;
};

type Props = {
  portfolio: {
    label: string;
    series: BenchmarkPoint[];
    xirr: number | null;
  };
  benchmarks: BenchmarkBundle[];
  windows: WindowBundle[];
  defaultSelected?: string[];
  defaultWindow?: WindowId;
};

const SERIES_COLORS: Record<string, string> = {
  portfolio: 'var(--color-accent)',
  nifty50: '#16a34a',
  largemid250: '#f59e0b',
  bse500: '#a855f7',
  // Mutual-fund benchmarks
  'parag-parikh-flexi': '#2563eb', // blue
  'kotak-large-mid': '#dc2626', // red
  'axis-flexi': '#0891b2', // cyan
  'invesco-contra': '#9333ea', // purple
};

function fmtPct(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = n * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function pnlClass(n: number | null) {
  if (n == null) return 'text-[var(--color-muted)]';
  return n >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
}

export function BenchmarkChartClient({
  portfolio,
  benchmarks,
  windows,
  defaultSelected = ['nifty50'],
  defaultWindow = 'ALL',
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));
  const [windowId, setWindowId] = useState<WindowId>(defaultWindow);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const activeWindow = useMemo(
    () => windows.find((w) => w.id === windowId) ?? windows[windows.length - 1]!,
    [windows, windowId],
  );

  // Slice + rebase a single series to the selected window. Rebase = subtract
  // the value at-or-before windowStart so the line starts at 0% within the
  // window. For 'ALL', return the original series unchanged.
  const sliceAndRebase = (points: BenchmarkPoint[]): BenchmarkPoint[] => {
    if (windowId === 'ALL' || points.length === 0) return points;
    const startDate = activeWindow.startDate;
    // Find anchor: latest point with date <= startDate. If none, use the
    // earliest point that's >= startDate (i.e., the series starts mid-window).
    let anchor: number | null = null;
    for (const p of points) {
      if (p.date <= startDate) anchor = p.returnPct;
      else break;
    }
    const inWindow = points.filter((p) => p.date >= startDate);
    if (anchor == null) {
      anchor = inWindow[0]?.returnPct ?? 0;
    }
    const a = anchor;
    return inWindow.map((p) => ({ date: p.date, returnPct: p.returnPct - a }));
  };

  // Merge selected series (after slice + rebase) onto a single date axis.
  const chartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number>>();
    const include = (id: string, points: BenchmarkPoint[]) => {
      for (const p of sliceAndRebase(points)) {
        const row = dateMap.get(p.date) ?? {};
        row[id] = p.returnPct * 100;
        dateMap.set(p.date, row);
      }
    };
    include('portfolio', portfolio.series);
    for (const b of benchmarks) {
      if (selected.has(b.id)) include(b.id, b.series);
    }
    const dates = [...dateMap.keys()].sort();
    return dates.map((d) => ({ date: d, ...dateMap.get(d)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio.series, benchmarks, selected, windowId]);

  const windowLabel = activeWindow.label;
  const isAll = windowId === 'ALL';
  const windowXirrLabel = isAll ? 'Window XIRR (All)' : `Window XIRR (${windowLabel})`;

  return (
    <div className="flex flex-col gap-4">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Period:
        </span>
        {windows.map((w) => {
          const isOn = w.id === windowId;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => setWindowId(w.id)}
              className={
                'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (isOn
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)]')
              }
              aria-pressed={isOn}
            >
              {w.label}
            </button>
          );
        })}
      </div>

      {/* Window XIRR tile */}
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
        <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          {windowXirrLabel}
        </div>
        <div className={`tnum mt-1 text-xl font-semibold ${pnlClass(activeWindow.portfolioXirr)}`}>
          {fmtPct(activeWindow.portfolioXirr)}
        </div>
        <div className="mt-1 text-[10px] leading-snug text-[var(--color-subtle)]">
          {isAll
            ? 'Money-weighted XIRR across the full history.'
            : `Money-weighted XIRR over the last ${windowLabel}, with the position's MV at window start treated as a synthetic buy.`}
        </div>
      </div>

      {/* Multi-select chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Compare with:
        </span>
        {benchmarks.map((b) => {
          const isOn = selected.has(b.id);
          return (
            <button
              key={b.id}
              type="button"
              onClick={() => toggle(b.id)}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                (isOn
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)]')
              }
              aria-pressed={isOn}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: SERIES_COLORS[b.id] ?? 'var(--color-muted)' }}
              />
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Chart */}
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 28, left: 18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="date"
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              tickFormatter={(d: string) => (d.length >= 7 ? d.slice(0, 7) : d)}
              minTickGap={32}
              label={{
                value: 'Date',
                position: 'insideBottom',
                offset: -10,
                style: { fill: 'var(--color-muted)', fontSize: 11 },
              }}
            />
            <YAxis
              tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
              tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              width={56}
              label={{
                value: 'Cumulative return (%)',
                angle: -90,
                position: 'insideLeft',
                offset: 8,
                style: {
                  fill: 'var(--color-muted)',
                  fontSize: 11,
                  textAnchor: 'middle',
                },
              }}
            />
            <Tooltip
              contentStyle={{
                background: 'var(--color-card)',
                border: '1px solid var(--color-border)',
                borderRadius: 8,
                fontSize: 12,
              }}
              formatter={(value: number, name: string) => [`${Number(value).toFixed(2)}%`, name]}
              labelStyle={{ color: 'var(--color-muted)', fontSize: 11 }}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 4 }} iconType="plainline" />
            <Line
              type="monotone"
              dataKey="portfolio"
              name={portfolio.label}
              stroke={SERIES_COLORS.portfolio}
              strokeWidth={2.25}
              dot={false}
              connectNulls
            />
            {benchmarks
              .filter((b) => selected.has(b.id))
              .map((b) => (
                <Line
                  key={b.id}
                  type="monotone"
                  dataKey={b.id}
                  name={b.label}
                  stroke={SERIES_COLORS[b.id] ?? 'var(--color-muted)'}
                  strokeWidth={1.75}
                  dot={false}
                  connectNulls
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Per-benchmark mini-table */}
      <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-card-hover)]">
            <tr className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
              <th className="px-4 py-2 text-left">Benchmark</th>
              <th className="px-4 py-2 text-right">{isAll ? 'XIRR' : `XIRR (${windowLabel})`}</th>
              <th className="px-4 py-2 text-right">vs Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((b) => {
              const benchXirr = isAll ? b.xirr : (activeWindow.benchmarkXirrs[b.id] ?? null);
              const portXirr = isAll ? portfolio.xirr : activeWindow.portfolioXirr;
              const delta = portXirr != null && benchXirr != null ? portXirr - benchXirr : null;
              return (
                <tr key={b.id} className="border-t border-[var(--color-border)] first:border-0">
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: SERIES_COLORS[b.id] ?? 'var(--color-muted)' }}
                      />
                      {b.label}
                    </span>
                  </td>
                  <td className={`tnum px-4 py-2 text-right ${pnlClass(benchXirr)}`}>
                    {fmtPct(benchXirr)}
                  </td>
                  <td className={`tnum px-4 py-2 text-right ${pnlClass(delta)}`}>
                    {fmtPct(delta)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="border-t border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-[11px] text-[var(--color-muted)]">
          {isAll ? (
            <>
              Chart Y-axis = cumulative return % since first buy. Computed as
              <code className="mx-1 rounded bg-[var(--color-card-hover)] px-1 font-mono text-[10px]">
                (mark-to-market value + cumulative sells + dividends) ÷ cumulative buys − 1
              </code>
              at each date.
            </>
          ) : (
            <>
              Window selected: lines rebased to 0% at window start. Window XIRR uses the
              position&apos;s MV at window start as a synthetic buy plus all in-window cashflows.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
