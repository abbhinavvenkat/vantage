import Link from 'next/link';

import { db } from '@/lib/db/client';
import { decisionsForSnapshot } from '@/lib/db/queries/decisions';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

type Props = {
  params: Promise<{ portfolioId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
};

type ActionKey = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

const ACTION_LABEL: Record<ActionKey, string> = {
  fresh_buy: 'Fresh Buy',
  add: 'Add',
  hold: 'Hold',
  trim_25: 'Trim 25%',
  trim_50: 'Trim 50%',
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

export default async function DecisionsDiffPage({ params, searchParams }: Props) {
  const { portfolioId } = await params;
  const sp = await searchParams;
  const fromAt = Number(sp.from);
  const toAt = Number(sp.to);
  if (!Number.isFinite(fromAt) || !Number.isFinite(toAt)) {
    return (
      <Card>
        <p className="text-sm text-[var(--color-muted)]">Missing or invalid from/to params.</p>
      </Card>
    );
  }

  const fromRows = decisionsForSnapshot(db, portfolioId, fromAt);
  const toRows = decisionsForSnapshot(db, portfolioId, toAt);

  const allSyms = new Set<string>();
  for (const r of fromRows) allSyms.add(r.symbol);
  for (const r of toRows) allSyms.add(r.symbol);

  const fromBy = new Map(fromRows.map((r) => [r.symbol, r]));
  const toBy = new Map(toRows.map((r) => [r.symbol, r]));

  type Diff = {
    symbol: string;
    from: { action: ActionKey; score: number } | null;
    to: { action: ActionKey; score: number } | null;
    changed: boolean;
  };
  const diffs: Diff[] = [...allSyms]
    .map((sym) => {
      const f = fromBy.get(sym);
      const t = toBy.get(sym);
      const fObj = f ? { action: f.action as ActionKey, score: f.score } : null;
      const tObj = t ? { action: t.action as ActionKey, score: t.score } : null;
      const changed = fObj?.action !== tObj?.action;
      return { symbol: sym, from: fObj, to: tObj, changed };
    })
    .sort((a, b) => Number(b.changed) - Number(a.changed) || a.symbol.localeCompare(b.symbol));

  const nChanged = diffs.filter((d) => d.changed).length;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="text-base font-semibold">Decisions diff</h2>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">
          {new Date(fromAt).toLocaleString()} → {new Date(toAt).toLocaleString()} · {nChanged}{' '}
          symbol{nChanged === 1 ? '' : 's'} changed
        </p>
      </Card>

      <Card padded={false}>
        <div className="grid grid-cols-[1fr_1fr_1fr] gap-2 border-b border-[var(--color-border)] px-5 py-2 text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
          <span>Symbol</span>
          <span>From</span>
          <span>To</span>
        </div>
        <div className="divide-y divide-[var(--color-border)]">
          {diffs.map((d) => (
            <div
              key={d.symbol}
              className={
                'grid grid-cols-[1fr_1fr_1fr] items-center gap-2 px-5 py-2 ' +
                (d.changed ? 'bg-[var(--color-accent-soft)]/30' : '')
              }
            >
              <span className="font-medium">
                {d.symbol}
                {d.changed ? (
                  <span className="ml-2 text-[10px] text-[var(--color-accent)]">●</span>
                ) : null}
              </span>
              <span>
                {d.from ? (
                  <Badge tone={ACTION_TONE[d.from.action]}>
                    {ACTION_LABEL[d.from.action]} ({d.from.score.toFixed(2)})
                  </Badge>
                ) : (
                  <span className="text-xs text-[var(--color-muted)]">—</span>
                )}
              </span>
              <span>
                {d.to ? (
                  <Badge tone={ACTION_TONE[d.to.action]}>
                    {ACTION_LABEL[d.to.action]} ({d.to.score.toFixed(2)})
                  </Badge>
                ) : (
                  <span className="text-xs text-[var(--color-muted)]">—</span>
                )}
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Link
        href={`/p/${portfolioId}/decisions/audit`}
        className="text-sm text-[var(--color-accent)] underline"
      >
        ← back to audit log
      </Link>
    </div>
  );
}
