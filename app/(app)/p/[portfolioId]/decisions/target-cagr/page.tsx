import Link from 'next/link';

import { getSession } from '@/lib/auth/session';
import { runCagrPlan } from '@/lib/cagr/run';
import type { CagrAction, CagrPlan } from '@/lib/cagr/portfolioPlan';
import type { ScreenedCandidate } from '@/lib/cagr/universeScreener';
import { db } from '@/lib/db/client';
import { latestCagrPlan } from '@/lib/db/queries/cagrPlans';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Sparkle, TrendingUp } from '@/components/ui/Icons';

import { RecomputeForm } from './RecomputeForm';

type Props = { params: Promise<{ portfolioId: string }> };

const ACTION_LABEL: Record<CagrAction['kind'], string> = {
  add: 'Add',
  keep: 'Keep',
  trim_partial: 'Trim ~35%',
  replace: 'Replace',
  fresh_buy: 'Fresh buy',
};

const ACTION_TONE: Record<CagrAction['kind'], 'pos' | 'info' | 'neutral' | 'warning' | 'neg'> = {
  add: 'pos',
  keep: 'info',
  trim_partial: 'warning',
  replace: 'neg',
  fresh_buy: 'pos',
};

function fmtPct(n: number, decimals = 1): string {
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtInr(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`;
}

export default async function TargetCagrPage({ params }: Props) {
  const { portfolioId } = await params;
  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';

  // Default request — 22% / 10y; if a stored plan exists, use its parameters
  // for the initial render so the user lands on what they last computed.
  const stored = latestCagrPlan(db, portfolioId);
  const targetCagrPct = stored?.targetCagrPct ?? 22;
  const horizonYears = stored?.horizonYears ?? 10;

  const { plan, candidates } = runCagrPlan({
    db,
    portfolioId,
    targetCagrPct,
    horizonYears,
  });

  const actionsByKind = groupBy(plan.actions, (a) => a.kind);
  const candidatesBySymbol = new Map<string, ScreenedCandidate>(
    candidates.map((c) => [c.symbol, c]),
  );

  const usedSymbols = new Set<string>();
  for (const a of plan.actions) {
    usedSymbols.add(a.symbol);
    if (a.kind === 'replace' && a.replacementSymbol) usedSymbols.add(a.replacementSymbol);
  }
  const freshBuyExtras = candidates.filter((c) => !usedSymbols.has(c.symbol)).slice(0, 10);

  return (
    <div className="flex flex-col gap-5">
      {/* Sub-tabs */}
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 px-4 py-3 text-sm">
          <Link
            href={`/p/${portfolioId}/decisions`}
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-[var(--color-muted)] hover:bg-[var(--color-card-hover)]"
          >
            Investor rules
          </Link>
          <Link
            href={`/p/${portfolioId}/decisions/target-cagr`}
            className="rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] px-3 py-1.5 font-medium text-[var(--color-accent)]"
          >
            <span className="inline-flex items-center gap-1.5">
              <TrendingUp size={14} />
              Target CAGR
            </span>
          </Link>
        </div>
      </Card>

      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              <Sparkle size={18} />
            </div>
            <div>
              <h2 className="text-base font-semibold">Target a 20-25% CAGR portfolio</h2>
              <p className="mt-0.5 text-sm text-[var(--color-muted)]">
                Concrete buy / add / trim / replace actions, including replacement candidates from
                the large/mid/top-small-cap universe with a buy thesis for each.
              </p>
            </div>
          </div>
        </div>
        <div className="mt-4">
          <RecomputeForm
            portfolioId={portfolioId}
            csrfToken={csrfToken}
            initialTargetCagrPct={targetCagrPct}
            initialHorizonYears={horizonYears}
          />
        </div>
      </Card>

      {/* Hero stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="Current portfolio forecast"
          value={fmtPct(plan.currentPortfolioForecastCagr)}
          tone="info"
          sub={`${plan.actions.length} action${plan.actions.length === 1 ? '' : 's'}`}
        />
        <Tile
          label="Proposed portfolio forecast"
          value={fmtPct(plan.proposedPortfolioForecastCagr)}
          tone="pos"
          sub={`Target ${plan.targetCagrPct}% over ${plan.horizonYears}y`}
        />
        <Tile
          label="Alpha uplift"
          value={(plan.alphaUplift >= 0 ? '+' : '') + fmtPct(plan.alphaUplift)}
          tone={plan.alphaUplift >= 0 ? 'pos' : 'warning'}
          sub="proposed − current"
        />
      </div>

      {/* Risk callouts */}
      {plan.unaccountedRiskNotes.length > 0 ? (
        <Card>
          <div className="text-sm font-medium">Risk callouts</div>
          <ul className="mt-2 flex flex-wrap gap-2">
            {plan.unaccountedRiskNotes.map((n, i) => (
              <li key={i}>
                <Badge tone="warning">{n}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {/* Section 1 — Action plan */}
      <Card padded={false}>
        <div className="border-b border-[var(--color-border)] px-5 py-3 text-sm font-medium">
          Action plan on existing positions
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {(['add', 'keep', 'trim_partial', 'replace', 'fresh_buy'] as CagrAction['kind'][]).map(
            (kind) => {
              const rows = actionsByKind.get(kind) ?? [];
              if (rows.length === 0) return null;
              return (
                <details key={kind} className="px-5 py-3" open={kind !== 'keep'}>
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <Badge tone={ACTION_TONE[kind]}>{ACTION_LABEL[kind]}</Badge>
                    <span className="text-xs text-[var(--color-muted)]">
                      {rows.length} position{rows.length === 1 ? '' : 's'}
                    </span>
                  </summary>
                  <ul className="mt-3 space-y-2">
                    {rows.map((a, idx) => (
                      <li
                        key={`${a.symbol}-${idx}`}
                        className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/p/${portfolioId}/symbol/${encodeURIComponent(a.symbol)}`}
                              className="font-medium hover:text-[var(--color-accent)]"
                            >
                              {a.symbol}
                            </Link>
                            {a.kind === 'replace' && a.replacementSymbol ? (
                              <span className="text-xs text-[var(--color-muted)]">
                                →{' '}
                                <Link
                                  href={`/p/${portfolioId}/symbol/${encodeURIComponent(a.replacementSymbol)}`}
                                  className="font-medium hover:text-[var(--color-accent)]"
                                >
                                  {a.replacementSymbol}
                                </Link>
                              </span>
                            ) : null}
                            {typeof a.forecastedCagr === 'number' ? (
                              <Badge tone="neutral">{fmtPct(a.forecastedCagr, 0)}</Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-[var(--color-muted)] tabular-nums">
                            {a.currentWeightPct !== undefined ? (
                              <>
                                {a.currentWeightPct.toFixed(1)}% → {a.targetWeightPct.toFixed(1)}%
                                ·{' '}
                              </>
                            ) : (
                              <>{a.targetWeightPct.toFixed(1)}% target · </>
                            )}
                            <span
                              className={
                                a.deltaInr >= 0
                                  ? 'text-[var(--color-pos)]'
                                  : 'text-[var(--color-neg)]'
                              }
                            >
                              {a.deltaInr >= 0 ? '+' : ''}
                              {fmtInr(a.deltaInr)}
                            </span>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-[var(--color-muted)]">{a.rationale}</p>
                        {a.thesisMd ? (
                          <p className="mt-2 text-xs whitespace-pre-line text-[var(--color-fg)]">
                            {a.thesisMd}
                          </p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            },
          )}
          {plan.actions.length === 0 ? (
            <div className="px-5 py-4 text-sm text-[var(--color-muted)]">
              No actions to take — your current portfolio already meets the target.
            </div>
          ) : null}
        </div>
      </Card>

      {/* Section 2 — Replacement candidates */}
      {(actionsByKind.get('replace') ?? []).length > 0 ? (
        <Card padded={false}>
          <div className="border-b border-[var(--color-border)] px-5 py-3 text-sm font-medium">
            Replacement candidates
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-card-hover)] text-left text-xs text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Replace</th>
                  <th className="px-4 py-2 font-medium">Buy</th>
                  <th className="px-4 py-2 font-medium">Sector</th>
                  <th className="px-4 py-2 font-medium">Mcap</th>
                  <th className="px-4 py-2 font-medium">Forecast CAGR</th>
                  <th className="px-4 py-2 font-medium">Frameworks</th>
                  <th className="px-4 py-2 font-medium">Entry zones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {(actionsByKind.get('replace') ?? []).map((a, i) => {
                  const cand = a.replacementSymbol
                    ? candidatesBySymbol.get(a.replacementSymbol)
                    : undefined;
                  return (
                    <tr key={`replace-${i}`}>
                      <td className="px-4 py-2 font-medium">
                        <Link
                          href={`/p/${portfolioId}/symbol/${encodeURIComponent(a.symbol)}`}
                          className="hover:text-[var(--color-accent)]"
                        >
                          {a.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-2 font-medium">
                        {a.replacementSymbol ? (
                          <Link
                            href={`/p/${portfolioId}/symbol/${encodeURIComponent(a.replacementSymbol)}`}
                            className="hover:text-[var(--color-accent)]"
                          >
                            {a.replacementSymbol}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-2">{cand?.sector ?? '—'}</td>
                      <td className="px-4 py-2">
                        <Badge tone="neutral">{cand?.marketCapBucket ?? 'unknown'}</Badge>
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {cand ? fmtPct(cand.forecastedCagr, 0) : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(cand?.frameworkSupport ?? []).map((f) => (
                            <Badge key={f.framework} tone="info">
                              {f.framework}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums">
                        {cand?.entryFairPrice
                          ? `Fair ₹${cand.entryFairPrice} · Strong ₹${cand.entryStrongBuy ?? '?'}`
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {/* Section 3 — Sector / mcap gaps */}
      {plan.gaps.length > 0 ? (
        <Card padded={false}>
          <div className="border-b border-[var(--color-border)] px-5 py-3 text-sm font-medium">
            Sector &amp; market-cap gaps
          </div>
          <ul className="divide-y divide-[var(--color-border)]">
            {plan.gaps.slice(0, 12).map((g, i) => {
              const delta = g.targetPct - g.currentPct;
              return (
                <li key={i} className="px-5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Badge tone={g.dimension === 'sector' ? 'info' : 'neutral'}>
                        {g.dimension}
                      </Badge>
                      <span className="font-medium">{g.key}</span>
                    </div>
                    <div className="text-xs text-[var(--color-muted)] tabular-nums">
                      {fmtPct(g.currentPct)} → {fmtPct(g.targetPct)}{' '}
                      <span
                        className={
                          delta >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'
                        }
                      >
                        ({delta >= 0 ? '+' : ''}
                        {fmtPct(delta)})
                      </span>
                    </div>
                  </div>
                  {g.suggestedSymbols.length > 0 ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {g.suggestedSymbols.map((s) => (
                        <Badge key={s} tone="neutral">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}

      {/* Section 4 — Fresh buy candidates */}
      {freshBuyExtras.length > 0 ? (
        <Card padded={false}>
          <div className="border-b border-[var(--color-border)] px-5 py-3 text-sm font-medium">
            Fresh buy candidates (universe screener)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-card-hover)] text-left text-xs text-[var(--color-muted)]">
                <tr>
                  <th className="px-4 py-2 font-medium">Symbol</th>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">Sector</th>
                  <th className="px-4 py-2 font-medium">Mcap</th>
                  <th className="px-4 py-2 font-medium">Composite</th>
                  <th className="px-4 py-2 font-medium">Forecast CAGR</th>
                  <th className="px-4 py-2 font-medium">Frameworks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {freshBuyExtras.map((c) => (
                  <tr key={c.symbol}>
                    <td className="px-4 py-2 font-medium">
                      <Link
                        href={`/p/${portfolioId}/symbol/${encodeURIComponent(c.symbol)}`}
                        className="hover:text-[var(--color-accent)]"
                      >
                        {c.symbol}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{c.companyName}</td>
                    <td className="px-4 py-2">{c.sector}</td>
                    <td className="px-4 py-2">
                      <Badge tone="neutral">{c.marketCapBucket}</Badge>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{c.compositeScore.toFixed(1)}</td>
                    <td className="px-4 py-2 tabular-nums">{fmtPct(c.forecastedCagr, 0)}</td>
                    <td className="px-4 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.frameworkSupport.map((f) => (
                          <Badge key={f.framework} tone="info">
                            {f.framework}
                          </Badge>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone: 'pos' | 'info' | 'warning';
}) {
  const toneClass =
    tone === 'pos'
      ? 'text-[var(--color-pos)]'
      : tone === 'warning'
        ? 'text-[var(--color-neg)]'
        : 'text-[var(--color-fg)]';
  return (
    <Card>
      <div className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
        {label}
      </div>
      <div className={'mt-1 text-2xl font-semibold tabular-nums ' + toneClass}>{value}</div>
      <div className="mt-0.5 text-xs text-[var(--color-muted)]">{sub}</div>
    </Card>
  );
}

function groupBy<T, K extends string>(arr: T[], keyFn: (x: T) => K): Map<K, T[]> {
  const out = new Map<K, T[]>();
  for (const x of arr) {
    const k = keyFn(x);
    const cur = out.get(k);
    if (cur) cur.push(x);
    else out.set(k, [x]);
  }
  return out;
}
