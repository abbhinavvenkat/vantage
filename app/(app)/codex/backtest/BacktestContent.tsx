'use client';

import { useState } from 'react';
import { CodexNav } from '@/app/(app)/codex/CodexNav';
import type { BacktestData, FrameworkNarrative, NarrativePeriod, PortfolioRow } from './page';

const DATE_LABELS: Record<string, string> = {
  '2016-01-04': 'Jan 2016',
  '2020-01-02': 'Jan 2020',
  '2023-01-02': 'Jan 2023',
  '2026-05-03': 'May 2026',
};

function pct(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  return (n * 100).toFixed(decimals) + '%';
}

function signed(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  const s = (n * 100).toFixed(decimals) + '%';
  return n >= 0 ? '+' + s : s;
}

function colorClass(n: number | null): string {
  if (n === null) return 'text-[var(--color-muted)]';
  return n >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]';
}

function SectorTags({ dist }: { dist: Record<string, number> }) {
  const sorted = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);
  return (
    <div className="flex flex-wrap gap-1.5">
      {sorted.map(([sector, count]) => (
        <span
          key={sector}
          className="rounded-full bg-[var(--color-card)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-muted)] ring-1 ring-[var(--color-border)]"
        >
          {sector} <span className="text-[var(--color-accent)]">{count}</span>
        </span>
      ))}
    </div>
  );
}

function PortfolioTable({ rows, date }: { rows: PortfolioRow[]; date: string }) {
  const isCurrent = date === '2026-05-03';
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
      <table className="w-full border-collapse text-sm">
        <thead className="bg-[var(--color-card)]">
          <tr>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-left text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
              Symbol
            </th>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-left text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
              Sector
            </th>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
              Score
            </th>
            <th className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
              Entry ₹
            </th>
            {!isCurrent && (
              <>
                <th className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
                  Exit ₹
                </th>
                <th className="border-b border-[var(--color-border)] px-3 py-2 text-right text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase">
                  Return
                </th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.symbol}
              className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-card-hover)]"
            >
              <td className="px-3 py-2.5 font-medium text-[var(--color-fg)]">
                <span className="font-mono text-xs">{row.symbol}</span>
                <span className="ml-2 text-xs text-[var(--color-muted)]">{row.company_name}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-[var(--color-muted)]">{row.sector}</td>
              <td className="px-3 py-2.5 text-right">
                <span className="rounded bg-[var(--color-accent-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-accent)]">
                  {row.score.toFixed(0)}
                </span>
              </td>
              <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--color-fg)]">
                {row.entry_price !== null ? row.entry_price.toFixed(2) : '—'}
              </td>
              {!isCurrent && (
                <>
                  <td className="px-3 py-2.5 text-right font-mono text-xs text-[var(--color-fg)]">
                    {row.exit_price !== null ? row.exit_price.toFixed(2) : '—'}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-xs font-semibold ${row.return_pct !== null ? (row.return_pct >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]') : 'text-[var(--color-muted)]'}`}
                  >
                    {row.return_pct !== null
                      ? (row.return_pct >= 0 ? '+' : '') + row.return_pct.toFixed(1) + '%'
                      : '—'}
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PeriodSummary({ period }: { period: NarrativePeriod }) {
  const s = period.period_stats;
  const isCurrent = period.date === '2026-05-03';
  return (
    <div className="space-y-3">
      {period.framework_rationale && (
        <p className="text-sm leading-relaxed text-[var(--color-fg)]">
          {period.framework_rationale}
        </p>
      )}
      {!isCurrent && s && (
        <div className="flex flex-wrap gap-3 text-xs">
          {s.avg_return_pct !== null && (
            <span
              className={`font-semibold ${s.avg_return_pct >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}`}
            >
              Avg {s.avg_return_pct >= 0 ? '+' : ''}
              {s.avg_return_pct.toFixed(1)}% over period
            </span>
          )}
          {s.best && (
            <span className="text-[var(--color-muted)]">
              Best:{' '}
              <span className="font-mono font-medium text-[var(--color-pos)]">{s.best.symbol}</span>{' '}
              +{s.best.return_pct.toFixed(0)}%
            </span>
          )}
          {s.worst && (
            <span className="text-[var(--color-muted)]">
              Worst:{' '}
              <span className="font-mono font-medium text-[var(--color-neg)]">
                {s.worst.symbol}
              </span>{' '}
              {s.worst.return_pct.toFixed(0)}%
            </span>
          )}
          <span className="text-[var(--color-muted)]">
            {s.n_winners}W / {s.n_losers}L
          </span>
        </div>
      )}
      {period.sector_distribution && Object.keys(period.sector_distribution).length > 0 && (
        <SectorTags dist={period.sector_distribution} />
      )}
      {period.top_picks_by_score?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold tracking-wider text-[var(--color-muted)] uppercase">
            Top picks by score
          </p>
          {period.top_picks_by_score.slice(0, 5).map((p) => (
            <div key={p.symbol} className="flex items-baseline gap-2 text-xs">
              <span className="w-24 shrink-0 font-mono font-medium text-[var(--color-fg)]">
                {p.symbol}
              </span>
              <span className="text-[var(--color-muted)]">{p.why}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Thesis2026({ thesis }: { thesis: NonNullable<FrameworkNarrative['thesis_2026']> }) {
  return (
    <div className="space-y-3 rounded-[var(--radius-md)] border border-[var(--color-accent)]/20 bg-[var(--color-accent-soft)]/20 p-4">
      <p className="text-[11px] font-bold tracking-wider text-[var(--color-accent)] uppercase">
        2026 Thesis
      </p>
      {thesis.narrative && (
        <p className="text-sm leading-relaxed text-[var(--color-fg)]">{thesis.narrative}</p>
      )}
      {thesis.key_themes?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {thesis.key_themes.map((t) => (
            <span
              key={t}
              className="rounded-full bg-[var(--color-accent-soft)] px-2.5 py-0.5 text-[11px] font-medium text-[var(--color-accent)]"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {thesis.top_picks?.length > 0 && (
        <div className="space-y-1">
          {thesis.top_picks.slice(0, 5).map((p) => (
            <div key={p.symbol} className="flex items-baseline gap-2 text-xs">
              <span className="w-24 shrink-0 font-mono font-medium text-[var(--color-fg)]">
                {p.symbol}
              </span>
              <span className="text-[var(--color-muted)]">{p.why}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FrameworkCard({
  fw,
  label,
  result,
  portfolios,
  narrative,
  decisionDates,
  isDone,
}: {
  fw: string;
  label: string;
  result: BacktestData['frameworks'][string] | undefined;
  portfolios: Record<string, PortfolioRow[]>;
  narrative: FrameworkNarrative | undefined;
  decisionDates: string[];
  isDone: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeDate, setActiveDate] = useState(decisionDates[0]);
  const [tab, setTab] = useState<'picks' | 'narrative'>('narrative');

  const xirr = result?.xirr ?? null;
  const deltaNifty = result?.benchmark_vs_nifty50_xirr_delta ?? null;
  const deltaBse = result?.benchmark_vs_bse500_xirr_delta ?? null;

  const activePeriod = narrative?.periods.find((p) => p.date === activeDate);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--color-card-hover)]"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-[var(--color-fg)]">{label}</span>
          {!isDone && (
            <span className="rounded-full bg-[var(--color-card)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
              running…
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {xirr !== null && (
            <div className="text-right">
              <div className={`text-base font-bold tabular-nums ${colorClass(xirr)}`}>
                {pct(xirr)}
              </div>
              <div className="text-[10px] text-[var(--color-muted)]">XIRR</div>
            </div>
          )}
          {deltaNifty !== null && (
            <div className="text-right">
              <div className={`text-sm font-semibold tabular-nums ${colorClass(deltaNifty)}`}>
                {signed(deltaNifty)}
              </div>
              <div className="text-[10px] text-[var(--color-muted)]">vs Nifty 50</div>
            </div>
          )}
          {deltaBse !== null && (
            <div className="text-right">
              <div className={`text-sm font-semibold tabular-nums ${colorClass(deltaBse)}`}>
                {signed(deltaBse)}
              </div>
              <div className="text-[10px] text-[var(--color-muted)]">vs BSE 500</div>
            </div>
          )}
          <span className="text-[var(--color-muted)]">{open ? '▲' : '▼'}</span>
        </div>
      </button>

      {open && (
        <div className="border-t border-[var(--color-border)] px-5 pt-4 pb-5">
          {/* Philosophy pill */}
          {narrative?.overall_philosophy && (
            <p className="mb-4 text-xs leading-relaxed text-[var(--color-muted)] italic">
              {narrative.overall_philosophy}
            </p>
          )}

          {/* Date tabs */}
          <div className="mb-4 flex flex-wrap gap-1">
            {decisionDates
              .filter(
                (dd) => portfolios[dd]?.length || narrative?.periods.find((p) => p.date === dd),
              )
              .map((dd) => (
                <button
                  key={dd}
                  type="button"
                  onClick={() => setActiveDate(dd)}
                  className={
                    'rounded-[var(--radius-md)] px-3 py-1.5 text-xs font-medium transition-colors ' +
                    (activeDate === dd
                      ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'text-[var(--color-muted)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]')
                  }
                >
                  {DATE_LABELS[dd] ?? dd}
                  {dd === '2026-05-03' && (
                    <span className="ml-1.5 rounded-full bg-[var(--color-accent)]/20 px-1 text-[10px] text-[var(--color-accent)]">
                      current
                    </span>
                  )}
                </button>
              ))}
          </div>

          {/* Inner tabs: narrative vs picks */}
          <div className="mb-4 flex gap-3 border-b border-[var(--color-border)] pb-0">
            {(['narrative', 'picks'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  '-mb-px border-b-2 pb-2 text-xs font-medium transition-colors ' +
                  (tab === t
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                    : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-fg)]')
                }
              >
                {t === 'narrative' ? 'Summary & Thesis' : 'All Picks'}
              </button>
            ))}
          </div>

          {/* 2026 thesis block (shown in narrative tab when current date is selected) */}
          {tab === 'narrative' && activeDate === '2026-05-03' && narrative?.thesis_2026 && (
            <div className="mb-4">
              <Thesis2026 thesis={narrative.thesis_2026} />
            </div>
          )}

          {/* Period narrative */}
          {tab === 'narrative' && activePeriod && activeDate !== '2026-05-03' && (
            <PeriodSummary period={activePeriod} />
          )}

          {/* 2026 picks in narrative tab */}
          {tab === 'narrative' &&
            activeDate === '2026-05-03' &&
            !narrative?.thesis_2026 &&
            activePeriod && <PeriodSummary period={activePeriod} />}

          {/* Full picks table */}
          {tab === 'picks' && activeDate && portfolios[activeDate]?.length ? (
            <PortfolioTable rows={portfolios[activeDate]!} date={activeDate} />
          ) : tab === 'picks' ? (
            <p className="text-sm text-[var(--color-muted)]">No data for this date yet.</p>
          ) : null}
        </div>
      )}
    </div>
  );
}

export function BacktestContent({
  data,
  frameworkLabels,
  allFrameworks,
}: {
  data: BacktestData;
  frameworkLabels: Record<string, string>;
  allFrameworks: string[];
}) {
  return (
    <div className="-mx-4 flex min-h-screen sm:-mx-6">
      <main className="min-w-0 flex-1 px-6 py-6 sm:px-8">
        {/* Page header */}
        <div className="mb-6 border-b border-[var(--color-border)] pb-6">
          <h1 className="text-2xl font-extrabold text-[var(--color-fg)]">Stalwarts Wisdom Codex</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            How 7 investor frameworks would have performed on Nifty 500 · 2016–2026
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="rounded-full bg-[var(--color-accent-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--color-accent)]">
              7 Frameworks
            </span>
            <span className="rounded-full bg-[var(--color-pos-soft)] px-3 py-1 text-[11px] font-semibold text-[var(--color-pos)]">
              Nifty 500 Universe
            </span>
            <span className="rounded-full bg-[var(--color-card)] px-3 py-1 text-[11px] font-semibold text-[var(--color-muted)] ring-1 ring-[var(--color-border)]">
              4 Decision Dates
            </span>
          </div>
          <CodexNav />
        </div>

        {data.status === 'not_started' && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-6 py-8 text-center">
            <p className="text-sm font-medium text-[var(--color-fg)]">Backtest not yet run</p>
            <p className="mt-1 text-xs text-[var(--color-muted)]">
              Run{' '}
              <code className="rounded bg-[var(--color-elevated)] px-1">
                python scripts/backtest/04_backtest.py
              </code>{' '}
              to generate results.
            </p>
          </div>
        )}

        {data.status === 'running' && (
          <div className="mb-6 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-4 py-3">
            <p className="text-sm text-[var(--color-muted)]">
              <span className="mr-2 font-medium text-[var(--color-fg)]">Backtest in progress</span>·{' '}
              {data.frameworks_done.length} of {allFrameworks.length} frameworks complete · Refresh
              to see more
            </p>
          </div>
        )}

        {/* XIRR summary table */}
        {data.status === 'complete' && (
          <div className="mb-8">
            <h2 className="mb-3 text-base font-semibold text-[var(--color-fg)]">XIRR Summary</h2>
            <div className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-[var(--color-card)]">
                  <tr>
                    {['Framework', 'XIRR', 'Total Return', 'vs Nifty 50', 'vs BSE 500'].map((h) => (
                      <th
                        key={h}
                        className={`border-b border-[var(--color-border)] px-4 py-2.5 text-[11px] font-bold tracking-wider text-[var(--color-muted)] uppercase ${h === 'Framework' ? 'text-left' : 'text-right'}`}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allFrameworks.map((fw) => {
                    const r = data.frameworks[fw];
                    const totalRet = r?.total_return_pct ?? null;
                    return (
                      <tr
                        key={fw}
                        className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-card-hover)]"
                      >
                        <td className="px-4 py-3 font-medium text-[var(--color-fg)]">
                          {frameworkLabels[fw]}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${colorClass(r?.xirr ?? null)}`}
                        >
                          {pct(r?.xirr ?? null)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono tabular-nums ${colorClass(totalRet !== null ? totalRet / 100 : null)}`}
                        >
                          {totalRet !== null
                            ? (totalRet >= 0 ? '+' : '') + totalRet.toFixed(1) + '%'
                            : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${colorClass(r?.benchmark_vs_nifty50_xirr_delta ?? null)}`}
                        >
                          {signed(r?.benchmark_vs_nifty50_xirr_delta ?? null)}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${colorClass(r?.benchmark_vs_bse500_xirr_delta ?? null)}`}
                        >
                          {signed(r?.benchmark_vs_bse500_xirr_delta ?? null)}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-card)]/50">
                    <td className="px-4 py-3 text-sm text-[var(--color-muted)]">Nifty 50</td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-muted)] tabular-nums">
                      {pct(data.benchmarks.nifty50_xirr)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-card)]/50">
                    <td className="px-4 py-3 text-sm text-[var(--color-muted)]">BSE 500</td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-muted)] tabular-nums">
                      {pct(data.benchmarks.bse500_xirr)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-sm text-[var(--color-muted)]">
                      Nifty 500 equal-weight
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[var(--color-muted)] tabular-nums">
                      {pct(data.benchmarks.nifty500_equal_weight_xirr)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-[var(--color-muted)]">
              Equal-weight 25-stock portfolios rebalanced at each decision date. Survivorship bias
              present (Nifty 500 current constituents). Run at: {data.run_at ?? '—'}.
            </p>
          </div>
        )}

        {/* Per-framework cards */}
        {(data.status === 'running' || data.status === 'complete') && (
          <div>
            <h2 className="mb-3 text-base font-semibold text-[var(--color-fg)]">
              Portfolio Snapshots
            </h2>
            <div className="space-y-3">
              {allFrameworks.map((fw) => (
                <FrameworkCard
                  key={fw}
                  fw={fw}
                  label={frameworkLabels[fw] ?? fw}
                  result={data.frameworks[fw]}
                  portfolios={data.portfolios[fw] ?? {}}
                  narrative={data.narratives[fw]}
                  decisionDates={data.decision_dates}
                  isDone={data.frameworks_done.includes(fw)}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
