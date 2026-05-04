'use client';

/**
 * Master decisions table — one row per stock, inline cells for every framework
 * (action / compounder / cagr / thesis health / growth / top rules / position).
 *
 * Filterable by Held / Watchlist / All; multi-select on action and compounder
 * classification; sortable headers. Click a row -> navigate to the unified
 * per-stock detail page at /p/<id>/symbol/<ticker>.
 */

import { Fragment, useRef, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

import {
  FINAL_ACTIONS,
  FINAL_ACTION_LABEL,
  FINAL_ACTION_PRIORITY,
  type FinalAction,
} from '@/lib/synthesis/finalRecommendation';
import {
  STALWART_DISPLAY_ACTIONS,
  STALWART_DISPLAY_LABEL,
  STALWART_DISPLAY_TONE,
  cagrToDisplayAction,
  finalToDisplayAction,
  toDisplayAction,
  type StalwartDisplayAction,
} from '@/lib/decisions/displayAction';

export type ActionKey = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

export type CompounderClass = '7-9x candidate' | 'solid compounder' | 'mediocre' | 'broken';

export type ThesisVerdict = 'intact' | 'watch' | 'weakened' | 'broken' | 'untested';

export type CagrKind = 'add' | 'keep' | 'trim_partial' | 'replace' | 'fresh_buy' | null;

export type ValuationStatus = 'pass' | 'partial' | 'fail' | 'unknown';

export type ValuationCell = {
  status: ValuationStatus;
  /** Composite score from valuationScore (-2..+2). */
  score: number;
  pe: number | null;
  peg: number | null;
  /** PE ÷ sector median PE. */
  peVsSectorMedian: number | null;
  /** Sector median PE used in the comparison. */
  peSectorMedian: number | null;
  /** PE ÷ symbol's own 5y trailing-PE median. */
  peVsOwn5yMedian: number | null;
  /** 0..1 — where current PE sits in own 10y trailing-PE history. */
  pe10yPercentile: number | null;
};

export type DecisionTableRow = {
  symbol: string;
  sector: string;
  isHolding: boolean;
  isWatchlist: boolean;
  /** True when this symbol is a CAGR-planner switch (replacement or fresh-buy candidate from the universe screener). */
  isCagrSwitch?: boolean;
  /** decision */
  action: ActionKey;
  score: number;
  /** compounder */
  compounderClass: CompounderClass | null;
  compounderScore: number | null; // 0..1
  compounderTenX: number | null;
  /** valuation framework verdict + raw axes for tooltips */
  valuation: ValuationCell | null;
  /** target-CAGR planner action for this symbol (if any) */
  cagrKind: CagrKind;
  cagrForecast: number | null; // forecast 5y CAGR (decimal, e.g. 0.18)
  /** thesis health */
  thesisVerdict: ThesisVerdict;
  /** growth forecast */
  growth: {
    yearOne: number;
    yearThree: number;
    yearFive: number;
    confidence: 'low' | 'medium' | 'high';
  } | null;
  /** top fired rules (already truncated to 2 by caller) */
  topRules: { ruleId: string; action: ActionKey; weight: number }[];
  /** position info */
  positionPct: number | null; // for holdings
  targetBuyPrice: number | null; // for watchlist
  /** Final synthesis output (across all 5 frameworks). */
  finalAction: FinalAction;
  /** -2..+2 composite score from synthesis. */
  finalScore: number;
  /** Confidence tier from synthesis. */
  finalConfidence: 'low' | 'medium' | 'high';
  /** Did any risk override fire (used for the small dot in the cell). */
  finalRiskCapped: boolean;
};

const ACTION_LABEL: Record<ActionKey, string> = {
  fresh_buy: 'Fresh Buy',
  add: 'Add',
  hold: 'Hold',
  trim_25: 'Trim 25',
  trim_50: 'Trim 50',
  exit: 'Exit',
};

const ACTION_TONE: Record<ActionKey, 'pos' | 'info' | 'neutral' | 'warning' | 'neg'> = {
  fresh_buy: 'pos',
  add: 'pos',
  hold: 'neutral',
  trim_25: 'warning',
  trim_50: 'warning',
  exit: 'neg',
};

const ACTION_PRIORITY: Record<ActionKey, number> = {
  fresh_buy: 0,
  add: 1,
  hold: 2,
  trim_25: 3,
  trim_50: 4,
  exit: 5,
};

const CLASS_TONE: Record<CompounderClass, 'pos' | 'info' | 'warning' | 'neg'> = {
  '7-9x candidate': 'pos',
  'solid compounder': 'info',
  mediocre: 'warning',
  broken: 'neg',
};

const CLASS_DOT: Record<CompounderClass, string> = {
  '7-9x candidate': '🟢',
  'solid compounder': '🟢',
  mediocre: '🟡',
  broken: '🔴',
};

const CLASS_SHORT: Record<CompounderClass, string> = {
  '7-9x candidate': '7-9×',
  'solid compounder': 'Solid',
  mediocre: 'Mediocre',
  broken: 'Broken',
};

const VERDICT_TONE: Record<ThesisVerdict, 'pos' | 'info' | 'warning' | 'neg' | 'neutral'> = {
  intact: 'pos',
  watch: 'info',
  weakened: 'warning',
  broken: 'neg',
  untested: 'neutral',
};

const VERDICT_LABEL: Record<ThesisVerdict, string> = {
  intact: 'Intact',
  watch: 'Watch',
  weakened: 'Weakened',
  broken: 'Broken',
  untested: 'Not tested',
};

// CAGR fit now uses the same 4-action display vocab as Stalwarts and Final
// (see lib/decisions/displayAction.ts#cagrToDisplayAction). Compounder Thesis
// and Thesis Health columns intentionally retain their classification
// vocabularies — they're states, not actions.

const VAL_TONE: Record<ValuationStatus, 'pos' | 'neutral' | 'warning' | 'neg'> = {
  pass: 'pos',
  partial: 'neutral',
  fail: 'neg',
  unknown: 'neutral',
};

const VAL_LABEL: Record<ValuationStatus, string> = {
  pass: 'Cheap',
  partial: 'Fair',
  fail: 'Expensive',
  unknown: '—',
};

type SortKey = 'final' | 'priority' | 'score' | 'compounder' | 'cagr' | 'symbol';
type Tab = 'all' | 'holdings' | 'watchlist' | 'switches';

// ── Per-step refresh progress ──────────────────────────────────────────────────

type RefreshStepItem = {
  id: string;
  step: number;
  name: string;
  status: 'running' | 'done' | 'skipped' | 'error';
  note?: string;
};

type RefreshProgressEvent =
  | { type: 'step_start'; step: number; name: string }
  | { type: 'step_done'; step: number; name: string }
  | { type: 'step_skipped'; step: number; name: string; reason: string }
  | { type: 'step_error'; step: number; name: string; message: string }
  | { type: 'done' }
  | { type: 'close'; code: number | null };

const STEP_GLYPH: Record<RefreshStepItem['status'], string> = {
  running: '⟳',
  done: '✓',
  skipped: '–',
  error: '✗',
};

const STEP_COLOR: Record<RefreshStepItem['status'], string> = {
  running: 'var(--color-accent)',
  done: 'var(--color-pos)',
  skipped: 'var(--color-muted)',
  error: 'var(--color-neg)',
};

// ─────────────────────────────────────────────────────────────────────────────

function fmtPct(x: number | null | undefined, digits = 0): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(digits)}%`;
}

function fmtInr(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

function ConfDot({ confidence }: { confidence: 'low' | 'medium' | 'high' }) {
  const color =
    confidence === 'high'
      ? 'var(--color-pos)'
      : confidence === 'medium'
        ? 'var(--color-accent)'
        : 'var(--color-muted)';
  return (
    <span
      title={`Confidence: ${confidence}`}
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{ background: color }}
    />
  );
}

/** Pure: filter + sort. Exported for tests. */
export function applyTableFilters(
  rows: DecisionTableRow[],
  opts: {
    tab: Tab;
    /**
     * Stalwarts filter expressed in the collapsed 4-action display vocab
     * (add_more / retain / sell_partial / sell_full). The filter compares
     * against `toDisplayAction(row.action)` so the UI exposes only the
     * unified vocabulary even though the row still carries the granular tag.
     */
    actions: Set<StalwartDisplayAction>;
    classifications: Set<CompounderClass>;
    finalActions?: Set<FinalAction>;
    sort: SortKey;
    sortDir: 'asc' | 'desc';
  },
): DecisionTableRow[] {
  let out = rows;
  if (opts.tab === 'holdings') out = out.filter((r) => r.isHolding);
  else if (opts.tab === 'watchlist') out = out.filter((r) => r.isWatchlist && !r.isHolding);
  else if (opts.tab === 'switches') out = out.filter((r) => r.isCagrSwitch === true);

  if (opts.actions.size > 0)
    out = out.filter((r) => opts.actions.has(toDisplayAction(r.action, { held: r.isHolding })));
  if (opts.classifications.size > 0)
    out = out.filter(
      (r) => r.compounderClass !== null && opts.classifications.has(r.compounderClass),
    );
  if (opts.finalActions && opts.finalActions.size > 0)
    out = out.filter((r) => opts.finalActions!.has(r.finalAction));

  const dir = opts.sortDir === 'asc' ? 1 : -1;
  const sorted = [...out];
  sorted.sort((a, b) => {
    switch (opts.sort) {
      case 'final': {
        // Default: enter_position, buy_more, hold, sell_partial, sell_full.
        // sortDir flips this whole ordering; tie-break by composite score desc.
        const d = FINAL_ACTION_PRIORITY[a.finalAction] - FINAL_ACTION_PRIORITY[b.finalAction];
        if (d !== 0) return d * dir;
        return b.finalScore - a.finalScore;
      }
      case 'priority': {
        const d = ACTION_PRIORITY[a.action] - ACTION_PRIORITY[b.action];
        if (d !== 0) return d;
        return (b.score - a.score) * 1; // tie-break: higher score first regardless of dir
      }
      case 'score':
        return (a.score - b.score) * dir;
      case 'compounder':
        return ((a.compounderScore ?? -1) - (b.compounderScore ?? -1)) * dir;
      case 'cagr':
        return ((a.cagrForecast ?? -1) - (b.cagrForecast ?? -1)) * dir;
      case 'symbol':
        return a.symbol.localeCompare(b.symbol) * dir;
      default:
        return 0;
    }
  });
  return sorted;
}

function HeaderCell({
  label,
  sortKey,
  currentSort,
  currentDir,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey?: SortKey;
  currentSort: SortKey;
  currentDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const justify =
    align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  const active = sortKey && currentSort === sortKey;
  if (!sortKey) {
    return (
      <th
        className={`px-3 py-2 text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase`}
      >
        <div className={`flex items-center gap-1 ${justify}`}>{label}</div>
      </th>
    );
  }
  return (
    <th className="px-3 py-2 text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`flex w-full items-center gap-1 ${justify} cursor-pointer hover:text-[var(--color-fg)]`}
      >
        <span>{label}</span>
        {active ? <span aria-hidden>{currentDir === 'asc' ? '▲' : '▼'}</span> : null}
      </button>
    </th>
  );
}

function GrowthPill({ g }: { g: DecisionTableRow['growth'] }) {
  if (!g) return <span className="text-xs text-[var(--color-muted)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap tabular-nums">
      <span className={g.yearOne >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}>
        {fmtPct(g.yearOne)}
      </span>
      <span className="text-[var(--color-muted)]">·</span>
      <span className={g.yearThree >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}>
        {fmtPct(g.yearThree)}
      </span>
      <span className="text-[var(--color-muted)]">·</span>
      <span className={g.yearFive >= 0 ? 'text-[var(--color-pos)]' : 'text-[var(--color-neg)]'}>
        {fmtPct(g.yearFive)}
      </span>
      <ConfDot confidence={g.confidence} />
    </span>
  );
}

export function DecisionsTable({
  rows,
  portfolioId,
}: {
  rows: DecisionTableRow[];
  portfolioId: string;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('all');
  const [actions, setActions] = useState<Set<StalwartDisplayAction>>(new Set());
  const [classifications, setClassifications] = useState<Set<CompounderClass>>(new Set());
  const [finalActions, setFinalActions] = useState<Set<FinalAction>>(new Set());
  const [sort, setSort] = useState<SortKey>('final');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  function toggleAction(a: StalwartDisplayAction) {
    setActions((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  }
  function toggleClassification(c: CompounderClass) {
    setClassifications((s) => {
      const n = new Set(s);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  }
  function toggleFinalAction(a: FinalAction) {
    setFinalActions((s) => {
      const n = new Set(s);
      if (n.has(a)) n.delete(a);
      else n.add(a);
      return n;
    });
  }
  function onSort(k: SortKey) {
    if (sort === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(k);
      // 'final' and 'symbol' sort ascending by default; everything else desc.
      setSortDir(k === 'symbol' || k === 'final' ? 'asc' : 'desc');
    }
  }

  // ── Refresh queue ────────────────────────────────────────────────────────────
  const queueRef = useRef<string[]>([]);
  const processingRef = useRef(false);
  const processNextRef = useRef<() => Promise<void>>(async () => {});
  const [symbolSteps, setSymbolSteps] = useState<Map<string, RefreshStepItem[]>>(new Map());
  const [refreshCurrent, setRefreshCurrent] = useState<string | null>(null);

  function upsertStep(sym: string, item: RefreshStepItem) {
    setSymbolSteps((prev) => {
      const next = new Map(prev);
      const steps = [...(next.get(sym) ?? [])];
      const idx = steps.findIndex((s) => s.id === item.id);
      if (idx >= 0) steps[idx] = { ...steps[idx]!, ...item };
      else steps.push(item);
      next.set(sym, steps);
      return next;
    });
  }

  async function processNext() {
    if (processingRef.current) return;
    const sym = queueRef.current.shift();
    if (!sym) {
      router.refresh();
      return;
    }
    processingRef.current = true;
    setRefreshCurrent(sym);
    try {
      const res = await fetch(`/api/p/${portfolioId}/research/${encodeURIComponent(sym)}/refresh`, {
        method: 'POST',
      });
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const frames = buf.split('\n\n');
          buf = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              const ev = JSON.parse(dataLine.slice(6)) as RefreshProgressEvent;
              const id = 'step' in ev ? `${ev.step}:${ev.name}` : '';
              if (ev.type === 'step_start')
                upsertStep(sym, { id, step: ev.step, name: ev.name, status: 'running' });
              else if (ev.type === 'step_done')
                upsertStep(sym, { id, step: ev.step, name: ev.name, status: 'done' });
              else if (ev.type === 'step_skipped')
                upsertStep(sym, {
                  id,
                  step: ev.step,
                  name: ev.name,
                  status: 'skipped',
                  note: ev.reason,
                });
              else if (ev.type === 'step_error')
                upsertStep(sym, {
                  id,
                  step: ev.step,
                  name: ev.name,
                  status: 'error',
                  note: ev.message,
                });
              else if (ev.type === 'done' || ev.type === 'close') break outer;
            } catch {
              // malformed JSON
            }
          }
        }
      }
    } finally {
      processingRef.current = false;
      setRefreshCurrent(null);
      setTimeout(() => processNextRef.current(), 0);
    }
  }
  processNextRef.current = processNext;

  function enqueue(syms: string[]) {
    for (const s of syms) {
      if (!queueRef.current.includes(s) && s !== refreshCurrent) queueRef.current.push(s);
    }
    void processNextRef.current();
  }

  // ─────────────────────────────────────────────────────────────────────────────

  const filtered = useMemo(
    () =>
      applyTableFilters(rows, {
        tab,
        actions,
        classifications,
        finalActions,
        sort,
        sortDir,
      }),
    [rows, tab, actions, classifications, finalActions, sort, sortDir],
  );

  const tabCounts = useMemo(
    () => ({
      all: rows.length,
      holdings: rows.filter((r) => r.isHolding).length,
      watchlist: rows.filter((r) => r.isWatchlist && !r.isHolding).length,
      switches: rows.filter((r) => r.isCagrSwitch === true).length,
    }),
    [rows],
  );

  return (
    <Card padded={false}>
      {/* Filter bar */}
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {(['all', 'holdings', 'watchlist', 'switches'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' +
                  (tab === t
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                }
              >
                {t === 'all'
                  ? 'All'
                  : t === 'holdings'
                    ? 'Holdings'
                    : t === 'watchlist'
                      ? 'Watchlist'
                      : '⚡ Switches by AI'}{' '}
                <span className="text-[var(--color-muted)]">({tabCounts[t]})</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => enqueue(rows.map((r) => r.symbol))}
            disabled={refreshCurrent !== null}
            className={
              'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ' +
              (refreshCurrent !== null
                ? 'cursor-not-allowed border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)]'
                : 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] hover:opacity-80')
            }
          >
            {refreshCurrent ? `↻ ${refreshCurrent}…` : '↻ Refresh all'}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Final
          </span>
          {FINAL_ACTIONS.map((a) => {
            const active = finalActions.has(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleFinalAction(a)}
                className={
                  'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                  (active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:text-[var(--color-fg)]')
                }
              >
                {FINAL_ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Stalwarts
          </span>
          {STALWART_DISPLAY_ACTIONS.map((a) => {
            const active = actions.has(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggleAction(a)}
                className={
                  'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                  (active
                    ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:text-[var(--color-fg)]')
                }
              >
                {STALWART_DISPLAY_LABEL[a]}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold tracking-wide text-[var(--color-muted)] uppercase">
            Compounder
          </span>
          {(['7-9x candidate', 'solid compounder', 'mediocre', 'broken'] as CompounderClass[]).map(
            (c) => {
              const active = classifications.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleClassification(c)}
                  className={
                    'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors ' +
                    (active
                      ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-muted)] hover:text-[var(--color-fg)]')
                  }
                >
                  {CLASS_DOT[c]} {CLASS_SHORT[c]}
                </button>
              );
            },
          )}
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1280px] text-sm">
          <thead className="sticky top-0 z-10 bg-[var(--color-card)]">
            <tr className="border-b border-[var(--color-border)]">
              <HeaderCell
                label="Symbol"
                sortKey="symbol"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="Final"
                sortKey="final"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="Stalwarts"
                sortKey="score"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="Valuation"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="Compounder"
                sortKey="compounder"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="CAGR fit"
                sortKey="cagr"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell label="Thesis" currentSort={sort} currentDir={sortDir} onSort={onSort} />
              <HeaderCell
                label="Growth 1y · 3y · 5y"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
              />
              <HeaderCell
                label="Position"
                currentSort={sort}
                currentDir={sortDir}
                onSort={onSort}
                align="right"
              />
            </tr>
          </thead>
          <tbody data-testid="decisions-table-body">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-8 text-center text-xs text-[var(--color-muted)]">
                  No symbols match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((row) => {
                const steps = symbolSteps.get(row.symbol);
                const isActive = refreshCurrent === row.symbol;
                const isQueued = queueRef.current.includes(row.symbol);
                return (
                  <Fragment key={row.symbol}>
                    <tr
                      data-symbol={row.symbol}
                      onClick={() =>
                        router.push(`/p/${portfolioId}/symbol/${encodeURIComponent(row.symbol)}`)
                      }
                      className="cursor-pointer border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-card-hover)]"
                    >
                      {/* Symbol */}
                      <td className="px-3 py-3">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium tabular-nums">{row.symbol}</span>
                            {row.isHolding ? (
                              <Badge tone="pos">Held</Badge>
                            ) : row.isWatchlist ? (
                              <Badge tone="info">Watch</Badge>
                            ) : null}
                            {row.isCagrSwitch && !row.isHolding ? (
                              <Badge tone="warning">Switch</Badge>
                            ) : !row.isHolding && !row.isWatchlist ? (
                              <Badge tone="neutral">Universe</Badge>
                            ) : null}
                            <button
                              type="button"
                              title={`Refresh ${row.symbol}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                enqueue([row.symbol]);
                              }}
                              disabled={isActive || isQueued}
                              className="ml-auto shrink-0 rounded px-1 py-0.5 text-[11px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              <span className={isActive ? 'inline-block animate-spin' : ''}>↻</span>
                            </button>
                          </div>
                          <span className="text-[10px] text-[var(--color-muted)]">
                            {row.sector}
                          </span>
                        </div>
                      </td>
                      {/* Final synthesis — visually emphasized as the headline column */}
                      <td className="bg-[var(--color-accent-soft)] px-3 py-3 ring-1 ring-[var(--color-accent)]/30 ring-inset">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const da = finalToDisplayAction(row.finalAction, {
                              held: row.isHolding,
                            });
                            return (
                              <Badge tone={STALWART_DISPLAY_TONE[da]}>
                                <span className="text-[12px] font-bold">
                                  {STALWART_DISPLAY_LABEL[da]}
                                </span>
                              </Badge>
                            );
                          })()}
                          <span
                            className="text-[11px] font-semibold text-[var(--color-fg)] tabular-nums"
                            title={`composite ${row.finalScore.toFixed(2)} · ${row.finalConfidence} confidence${row.finalRiskCapped ? ' · risk-capped' : ''}`}
                          >
                            {row.finalScore >= 0 ? '+' : ''}
                            {row.finalScore.toFixed(2)}
                          </span>
                          <ConfDot confidence={row.finalConfidence} />
                          {row.finalRiskCapped ? (
                            <span
                              title="Risk override applied"
                              className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-warning,#d97706)]"
                            />
                          ) : null}
                        </div>
                      </td>
                      {/* Stalwarts (fired-rules) action + score — collapsed to the
                          4-action display vocab; granular action is preserved on
                          `row.action` and surfaced on rule-card chips below. */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          {(() => {
                            const da = toDisplayAction(row.action, { held: row.isHolding });
                            return (
                              <Badge tone={STALWART_DISPLAY_TONE[da]}>
                                {STALWART_DISPLAY_LABEL[da]}
                              </Badge>
                            );
                          })()}
                          <span className="text-xs text-[var(--color-muted)] tabular-nums">
                            {row.score.toFixed(2)}
                          </span>
                        </div>
                      </td>
                      {/* Valuation — PEG, sector relative, own 5y/10y */}
                      <td className="px-3 py-3">
                        {row.valuation ? (
                          (() => {
                            const v = row.valuation;
                            const tooltip = [
                              v.pe != null ? `PE ${v.pe.toFixed(1)}` : null,
                              v.peg != null ? `PEG ${v.peg.toFixed(2)}` : null,
                              v.peVsSectorMedian != null && v.peSectorMedian != null
                                ? `${v.peVsSectorMedian.toFixed(2)}× sector ${v.peSectorMedian.toFixed(0)}`
                                : null,
                              v.peVsOwn5yMedian != null
                                ? `${v.peVsOwn5yMedian.toFixed(2)}× own 5y med`
                                : null,
                              v.pe10yPercentile != null
                                ? `${(v.pe10yPercentile * 100).toFixed(0)}th pctile own 10y`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ');
                            return (
                              <div className="flex flex-col gap-0.5" title={tooltip}>
                                <Badge tone={VAL_TONE[v.status]}>{VAL_LABEL[v.status]}</Badge>
                                <span className="text-[10px] text-[var(--color-muted)] tabular-nums">
                                  {v.peg != null ? `PEG ${v.peg.toFixed(2)}` : 'PEG —'}
                                  {v.peVsSectorMedian != null
                                    ? ` · ${v.peVsSectorMedian.toFixed(2)}×sec`
                                    : ''}
                                  {v.peVsOwn5yMedian != null
                                    ? ` · ${v.peVsOwn5yMedian.toFixed(2)}×5y`
                                    : ''}
                                  {v.pe10yPercentile != null
                                    ? ` · ${(v.pe10yPercentile * 100).toFixed(0)}p10y`
                                    : ''}
                                </span>
                              </div>
                            );
                          })()
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                      {/* Compounder */}
                      <td className="px-3 py-3">
                        {row.compounderClass ? (
                          <div className="flex items-center gap-2">
                            <Badge tone={CLASS_TONE[row.compounderClass]}>
                              {CLASS_DOT[row.compounderClass]} {CLASS_SHORT[row.compounderClass]}
                            </Badge>
                            {row.compounderTenX != null ? (
                              <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                                {row.compounderTenX.toFixed(1)}× / 10y
                              </span>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                      {/* CAGR fit — uses 4-action display vocab for visual consistency with Stalwarts + Final */}
                      <td className="px-3 py-3">
                        {row.cagrKind ? (
                          (() => {
                            const da = cagrToDisplayAction(row.cagrKind, {
                              held: row.isHolding,
                            });
                            return (
                              <div className="flex items-center gap-2">
                                <Badge tone={STALWART_DISPLAY_TONE[da]}>
                                  {STALWART_DISPLAY_LABEL[da]}
                                </Badge>
                                {row.cagrForecast != null ? (
                                  <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                                    {fmtPct(row.cagrForecast)}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })()
                        ) : row.cagrForecast != null ? (
                          <span className="text-[11px] text-[var(--color-muted)] tabular-nums">
                            {fmtPct(row.cagrForecast)}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                      {/* Thesis */}
                      <td className="px-3 py-3">
                        <Badge tone={VERDICT_TONE[row.thesisVerdict]}>
                          {VERDICT_LABEL[row.thesisVerdict]}
                        </Badge>
                      </td>
                      {/* Growth */}
                      <td className="px-3 py-3">
                        <GrowthPill g={row.growth} />
                      </td>
                      {/* Position */}
                      <td className="px-3 py-3 text-right">
                        {row.isHolding && row.positionPct != null ? (
                          <span className="text-xs font-medium tabular-nums">
                            {(row.positionPct * 100).toFixed(1)}%
                          </span>
                        ) : row.isWatchlist && row.targetBuyPrice != null ? (
                          <span className="text-xs text-[var(--color-muted)] tabular-nums">
                            {fmtInr(row.targetBuyPrice)}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                    {steps && steps.length > 0 && (
                      <tr className="border-b border-[var(--color-border)] bg-[var(--color-card-hover)]">
                        <td colSpan={8} className="px-4 py-2">
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            {steps.map((s) => (
                              <span key={s.id} className="flex items-center gap-1 text-[10px]">
                                <span
                                  style={{ color: STEP_COLOR[s.status] }}
                                  className={
                                    s.status === 'running' ? 'inline-block animate-spin' : ''
                                  }
                                >
                                  {STEP_GLYPH[s.status]}
                                </span>
                                <span
                                  style={{
                                    color:
                                      s.status === 'error'
                                        ? 'var(--color-neg)'
                                        : s.status === 'skipped'
                                          ? 'var(--color-muted)'
                                          : 'var(--color-fg)',
                                  }}
                                >
                                  {s.name}
                                </span>
                                {s.note && (
                                  <span className="text-[var(--color-muted)]">— {s.note}</span>
                                )}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
