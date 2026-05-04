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

type Props = {
  portfolio: {
    label: string;
    series: BenchmarkPoint[];
    xirr: number | null;
  };
  benchmarks: BenchmarkBundle[];
  defaultSelected?: string[];
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
  defaultSelected = ['nifty50'],
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set(defaultSelected));

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Merge all selected series onto a single date axis.
  const chartData = useMemo(() => {
    const dateMap = new Map<string, Record<string, number>>();
    const include = (id: string, points: BenchmarkPoint[]) => {
      for (const p of points) {
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
  }, [portfolio.series, benchmarks, selected]);

  return (
    <div className="flex flex-col gap-4">
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
              <th className="px-4 py-2 text-right">XIRR</th>
              <th className="px-4 py-2 text-right">vs Portfolio</th>
            </tr>
          </thead>
          <tbody>
            {benchmarks.map((b) => {
              const delta =
                portfolio.xirr != null && b.xirr != null ? portfolio.xirr - b.xirr : null;
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
                  <td className={`tnum px-4 py-2 text-right ${pnlClass(b.xirr)}`}>
                    {fmtPct(b.xirr)}
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
          Chart Y-axis = cumulative return % since first buy. Computed as
          <code className="mx-1 rounded bg-[var(--color-card-hover)] px-1 font-mono text-[10px]">
            (mark-to-market value + cumulative sells + dividends) ÷ cumulative buys − 1
          </code>
          at each date. Negative dips reflect actual unrealised drawdowns through Yahoo EOD price
          history (e.g., the 2022 IT/midcap correction).
        </div>
      </div>
    </div>
  );
}
