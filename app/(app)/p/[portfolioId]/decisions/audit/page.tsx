import Link from 'next/link';

import { db } from '@/lib/db/client';
import { listDecisionSnapshots } from '@/lib/db/queries/decisions';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';

type Props = { params: Promise<{ portfolioId: string }> };

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export default async function DecisionsAuditPage({ params }: Props) {
  const { portfolioId } = await params;
  const snapshots = listDecisionSnapshots(db, portfolioId);

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <h2 className="text-base font-semibold">Decisions audit log</h2>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">
          Every <em>Re-score</em> creates a new immutable snapshot. Compare any two to see what
          changed.
        </p>
      </Card>

      {snapshots.length === 0 ? (
        <Card>
          <p className="text-sm text-[var(--color-muted)]">No snapshots yet.</p>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="divide-y divide-[var(--color-border)]">
            {snapshots.map((s, i) => {
              const prev = snapshots[i + 1];
              return (
                <div
                  key={s.snapshotAt}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge tone="info">v{s.ruleLibraryVersion}</Badge>
                    <div>
                      <div className="font-medium">{fmtDate(s.snapshotAt)}</div>
                      <div className="text-xs text-[var(--color-muted)]">
                        {s.n} symbol{s.n === 1 ? '' : 's'} scored
                      </div>
                    </div>
                  </div>
                  {prev ? (
                    <Link
                      href={`/p/${portfolioId}/decisions/diff?from=${prev.snapshotAt}&to=${s.snapshotAt}`}
                      className="text-sm text-[var(--color-accent)] underline"
                    >
                      diff vs previous →
                    </Link>
                  ) : (
                    <span className="text-xs text-[var(--color-muted)]">first snapshot</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Link
        href={`/p/${portfolioId}/decisions`}
        className="text-sm text-[var(--color-accent)] underline"
      >
        ← back to decisions
      </Link>
    </div>
  );
}
