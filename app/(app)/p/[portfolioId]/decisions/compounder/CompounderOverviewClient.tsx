'use client';

/**
 * Compounder overview — interactive layer (filter chips + sort + per-row
 * expand). Pure UI on top of pre-computed CompounderProfile rows. The
 * heavy lifting (factor evaluation) happened server-side in page.tsx.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import type { CompounderProfile, CompounderClassification } from '@/lib/compounder/score';

import { CompounderPanel } from '../CompounderPanel';

export type CompounderRowView = {
  symbol: string;
  sector: string;
  isHolding: boolean;
  isWatchlist: boolean;
  positionPct: number | null;
  profile: CompounderProfile;
  thesisVerdict: 'intact' | 'watch' | 'weakened' | 'broken' | 'untested';
};

type FilterKey = 'all' | CompounderClassification;
type SortKey = 'score' | 'symbol' | 'tenYear';

const CLASS_TONE: Record<CompounderClassification, 'pos' | 'info' | 'warning' | 'neg'> = {
  '7-9x candidate': 'pos',
  'solid compounder': 'info',
  mediocre: 'warning',
  broken: 'neg',
};

const STATUS_GLYPH = { pass: '☑', fail: '☒', partial: '◐', unknown: '?' } as const;

const THESIS_TONE: Record<
  'intact' | 'watch' | 'weakened' | 'broken' | 'untested',
  { color: string; label: string }
> = {
  intact: { color: 'var(--color-pos)', label: 'Intact' },
  watch: { color: 'var(--color-accent)', label: 'Watch' },
  weakened: { color: 'var(--color-warning)', label: 'Weakened' },
  broken: { color: 'var(--color-neg)', label: 'Broken' },
  untested: { color: 'var(--color-muted)', label: '—' },
};

function ThesisChip({
  verdict,
}: {
  verdict: 'intact' | 'watch' | 'weakened' | 'broken' | 'untested';
}) {
  const { color, label } = THESIS_TONE[verdict];
  return (
    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ color }}>
      {label}
    </span>
  );
}

function GlyphCell({ status }: { status: 'pass' | 'fail' | 'partial' | 'unknown' }) {
  const color =
    status === 'pass'
      ? 'var(--color-pos)'
      : status === 'fail'
        ? 'var(--color-neg)'
        : status === 'partial'
          ? 'var(--color-accent)'
          : 'var(--color-muted)';
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center text-base"
      style={{ color }}
      title={status}
    >
      {STATUS_GLYPH[status]}
    </span>
  );
}

export function CompounderOverviewClient({
  rows,
  portfolioId,
}: {
  rows: CompounderRowView[];
  portfolioId: string;
}) {
  const [tab, setTab] = useState<'holdings' | 'watchlist' | 'all'>('holdings');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('score');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const visible = useMemo(() => {
    let r = rows;
    if (tab === 'holdings') r = r.filter((x) => x.isHolding);
    else if (tab === 'watchlist') r = r.filter((x) => x.isWatchlist && !x.isHolding);
    if (filter !== 'all') r = r.filter((x) => x.profile.classification === filter);
    const sorted = [...r];
    sorted.sort((a, b) => {
      if (sortBy === 'symbol') return a.symbol.localeCompare(b.symbol);
      if (sortBy === 'tenYear')
        return b.profile.estimatedTenYearReturn - a.profile.estimatedTenYearReturn;
      return b.profile.weightedScore - a.profile.weightedScore;
    });
    return sorted;
  }, [rows, tab, filter, sortBy]);

  const factorIds = rows[0]?.profile.factors.map((f) => f.factor.id) ?? [];
  const factorLabels = rows[0]?.profile.factors.map((f) => f.factor.label) ?? [];

  function toggle(sym: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(sym)) n.delete(sym);
      else n.add(sym);
      return n;
    });
  }

  const counts = {
    holdings: rows.filter((r) => r.isHolding).length,
    watchlist: rows.filter((r) => r.isWatchlist && !r.isHolding).length,
    all: rows.length,
  };

  const FILTERS: FilterKey[] = ['all', '7-9x candidate', 'solid compounder', 'mediocre', 'broken'];
  const SORTS: { key: SortKey; label: string }[] = [
    { key: 'score', label: 'Score' },
    { key: 'tenYear', label: '10y multiple' },
    { key: 'symbol', label: 'Symbol' },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Tab bar */}
      <div className="flex flex-wrap items-center gap-2">
        {(['holdings', 'watchlist', 'all'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={
              'rounded-full border px-3 py-1.5 text-sm transition-colors ' +
              (tab === t
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
            }
          >
            {t === 'holdings' ? 'Holdings' : t === 'watchlist' ? 'Watchlist' : 'All'}{' '}
            <span className="text-[var(--color-muted)]">({counts[t]})</span>
          </button>
        ))}
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Classification
        </span>
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={
              'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
              (filter === f
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
            }
          >
            {f}
          </button>
        ))}
        <span className="ml-3 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          Sort
        </span>
        {SORTS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setSortBy(s.key)}
            className={
              'rounded-full border px-2.5 py-1 text-xs transition-colors ' +
              (sortBy === s.key
                ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
            }
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Factor table */}
      <Card padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-[var(--color-card)]">
              <tr className="border-b border-[var(--color-border)] text-[10px] tracking-wide text-[var(--color-muted)] uppercase">
                <th className="px-3 py-2 text-left">Symbol</th>
                {factorLabels.map((label, i) => (
                  <th key={factorIds[i]} className="px-1 py-2 text-center" title={label}>
                    {label.split(' ').map((w, j) => (
                      <div key={j}>{w}</div>
                    ))}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">Score</th>
                <th className="px-3 py-2 text-right">10y</th>
                <th className="px-2 py-2 text-center">Thesis</th>
                <th className="px-3 py-2 text-left">Class</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <RowGroup
                  key={row.symbol}
                  row={row}
                  expanded={expanded.has(row.symbol)}
                  onToggle={() => toggle(row.symbol)}
                  portfolioId={portfolioId}
                />
              ))}
              {visible.length === 0 ? (
                <tr>
                  <td
                    colSpan={factorIds.length + 5}
                    className="px-3 py-6 text-center text-[var(--color-muted)]"
                  >
                    No symbols match the current filter.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function RowGroup({
  row,
  expanded,
  onToggle,
  portfolioId,
}: {
  row: CompounderRowView;
  expanded: boolean;
  onToggle: () => void;
  portfolioId: string;
}) {
  const tenX = row.profile.estimatedTenYearReturn.toFixed(1);
  const cls = row.profile.classification;
  const factorCount = row.profile.factors.length;
  return (
    <>
      <tr
        className="cursor-pointer border-b border-[var(--color-border)] hover:bg-[var(--color-card-hover)]"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-medium tabular-nums">
          <div className="flex items-center gap-1.5">
            <Link
              href={`/p/${portfolioId}/symbol/${encodeURIComponent(row.symbol)}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:text-[var(--color-accent)]"
            >
              {row.symbol}
            </Link>
            {row.isWatchlist && !row.isHolding ? <Badge tone="info">watch</Badge> : null}
            <span className="text-[10px] text-[var(--color-muted)]">{expanded ? '▲' : '▼'}</span>
          </div>
          {row.positionPct !== null ? (
            <div className="text-[10px] text-[var(--color-muted)] tabular-nums">
              {(row.positionPct * 100).toFixed(1)}% wt
            </div>
          ) : null}
        </td>
        {row.profile.factors.map(({ factor, verdict }) => (
          <td
            key={factor.id}
            className="px-1 py-2 text-center"
            title={`${factor.label}: ${verdict.rationale}`}
          >
            <GlyphCell status={verdict.status} />
          </td>
        ))}
        <td className="px-3 py-2 text-right tabular-nums">
          {row.profile.weightedScore.toFixed(2)}
        </td>
        <td className="px-3 py-2 text-right tabular-nums">{tenX}×</td>
        <td className="px-2 py-2 text-center">
          <ThesisChip verdict={row.thesisVerdict} />
        </td>
        <td className="px-3 py-2">
          <Badge tone={CLASS_TONE[cls]}>{cls}</Badge>
        </td>
      </tr>
      {expanded ? (
        <tr className="border-b border-[var(--color-border)]">
          <td colSpan={factorCount + 5} className="bg-[var(--color-card-hover)]/40 px-3 py-3">
            <CompounderPanel profile={row.profile} />
          </td>
        </tr>
      ) : null}
    </>
  );
}
