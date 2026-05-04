/**
 * Per-symbol Fundamentals + Stalwart Commentary card.
 *
 * Shared Server Component (no JS) used by:
 *   - Decisions page expandable rows (`DecisionsClient.tsx`)
 *   - Unified per-stock detail page (`/p/[id]/symbol/[ticker]/page.tsx`)
 *
 * Pure rendering; data is computed by `lib/fundamentals/buildTable.ts`.
 */

import type { FundamentalsTable } from '@/lib/fundamentals/buildTable';

function fmtMetric(v: number | null, unit: string): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (unit === '%') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'pct_raw') return `${v.toFixed(1)}%`;
  if (unit === 'cr') {
    if (Math.abs(v) >= 1_00_000) return `₹${(v / 1_00_000).toFixed(2)}L cr`;
    if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}k cr`;
    return `₹${v.toFixed(0)} cr`;
  }
  if (unit === 'x') return `${v.toFixed(2)}x`;
  return v.toFixed(2);
}

function VerdictDot({ verdict }: { verdict: 'green' | 'amber' | 'red' | 'unknown' }) {
  const color =
    verdict === 'green'
      ? 'var(--color-pos)'
      : verdict === 'amber'
        ? 'var(--color-accent)'
        : verdict === 'red'
          ? 'var(--color-neg)'
          : 'var(--color-muted)';
  return (
    <span
      aria-label={verdict}
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

export function FundamentalsCard({ table }: { table: FundamentalsTable }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)]">
      <div className="border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        Fundamentals + Stalwart Commentary
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--color-card)] text-left text-[10px] tracking-wide text-[var(--color-muted)] uppercase">
            <tr>
              <th className="px-3 py-1.5 font-medium">Metric</th>
              <th className="px-3 py-1.5 font-medium tabular-nums">Latest</th>
              <th className="px-3 py-1.5 font-medium tabular-nums">3y avg</th>
              <th className="px-3 py-1.5 font-medium tabular-nums">5y CAGR</th>
              <th className="px-3 py-1.5 font-medium">Stalwart commentary</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-border)]">
            {table.rows.map((r) => (
              <tr key={r.metricId}>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-1.5">
                    <VerdictDot verdict={r.verdict} />
                    <span className="font-medium text-[var(--color-fg)]">{r.label}</span>
                  </span>
                </td>
                <td className="px-3 py-2 tabular-nums">{fmtMetric(r.latest, r.unit)}</td>
                <td className="px-3 py-2 text-[var(--color-muted)] tabular-nums">
                  {fmtMetric(r.threeYearAvg, r.unit)}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)] tabular-nums">
                  {r.fiveYearCagr === null ? '—' : `${(r.fiveYearCagr * 100).toFixed(1)}%`}
                </td>
                <td className="px-3 py-2 text-[var(--color-muted)]">
                  {r.commentary ? (
                    <span>
                      <span className="font-medium text-[var(--color-fg)]">
                        {r.commentary.investor}:
                      </span>{' '}
                      <span className="italic">
                        “{r.commentary.quote.slice(0, 140)}
                        {r.commentary.quote.length > 140 ? '…' : ''}”
                      </span>
                      {r.commentary.source_url ? (
                        <>
                          {' '}
                          <a
                            href={r.commentary.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[var(--color-accent)] underline"
                          >
                            source
                          </a>
                        </>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-[var(--color-subtle,var(--color-muted))]">
                      No commentary mapped.
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
