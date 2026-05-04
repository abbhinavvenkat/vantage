'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type SectorWeightRow = {
  sector: string;
  yourPct: number;
  niftyPct: number;
};

type Props = { rows: SectorWeightRow[] };

export function SectorVsNiftyChart({ rows }: Props) {
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 16, bottom: 24, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="sector"
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            interval={0}
            angle={-25}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tick={{ fill: 'var(--color-muted)', fontSize: 11 }}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-card)',
              border: '1px solid var(--color-border)',
              borderRadius: 8,
              fontSize: 12,
            }}
            formatter={(value: number, name: string) => [`${Number(value).toFixed(1)}%`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="yourPct"
            name="Your weight"
            fill="var(--color-accent)"
            radius={[3, 3, 0, 0]}
          />
          <Bar dataKey="niftyPct" name="Nifty 50" fill="#94a3b8" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
