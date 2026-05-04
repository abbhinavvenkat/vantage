'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Briefcase, ChevronRight, Pencil, Trash } from '@/components/ui/Icons';

type Props = {
  portfolio: { id: string; name: string; baseCurrency: string };
  csrfToken: string;
};

export function PortfolioRow({ portfolio, csrfToken }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(portfolio.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(`rename failed (${res.status})`);
        return;
      }
      setEditing(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive "${portfolio.name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolios/${portfolio.id}`, {
        method: 'DELETE',
        headers: { 'x-csrf-token': csrfToken },
      });
      if (!res.ok) {
        setError(`archive failed (${res.status})`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="group flex items-center justify-between gap-3 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-sm)] transition-colors hover:border-[var(--color-border-strong)]">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Briefcase size={18} />
        </div>
        {editing ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            maxLength={80}
            className="max-w-xs"
          />
        ) : (
          <Link href={`/p/${portfolio.id}/holdings`} className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-medium text-[var(--color-fg)] group-hover:text-[var(--color-accent)]">
              {portfolio.name}
            </span>
            <span className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
              <Badge tone="neutral">{portfolio.baseCurrency}</Badge>
            </span>
          </Link>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {editing ? (
          <>
            <Button onClick={save} disabled={busy || name.trim().length === 0} size="sm">
              Save
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditing(false);
                setName(portfolio.name);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              disabled={busy}
              aria-label="Rename"
            >
              <Pencil size={14} />
              <span className="hidden sm:inline">Rename</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={archive}
              disabled={busy}
              aria-label="Archive"
              className="text-[var(--color-neg)] hover:bg-[var(--color-neg-soft)]"
            >
              <Trash size={14} />
              <span className="hidden sm:inline">Archive</span>
            </Button>
            <Link
              href={`/p/${portfolio.id}/holdings`}
              className="hidden h-8 w-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)] sm:inline-flex"
              aria-label="Open"
            >
              <ChevronRight size={16} />
            </Link>
          </>
        )}
      </div>
      {error ? <span className="text-xs text-[var(--color-neg)]">{error}</span> : null}
    </li>
  );
}
