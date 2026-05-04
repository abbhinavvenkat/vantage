'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { Check, ChevronDown, Briefcase, Plus } from '@/components/ui/Icons';

type Portfolio = { id: string; name: string };

export function PortfolioSwitcher({
  portfolios,
  currentId,
  currentSub,
}: {
  portfolios: Portfolio[];
  currentId: string | null;
  currentSub: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = portfolios.find((p) => p.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(id: string) {
    setOpen(false);
    router.push(`/p/${id}/${currentSub}`);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Switch portfolio"
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 text-sm font-medium text-[var(--color-fg)] transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-card-hover)]"
      >
        <Briefcase size={14} className="text-[var(--color-muted)]" />
        <span className="max-w-[140px] truncate sm:max-w-[200px]">
          {current ? current.name : 'Select portfolio'}
        </span>
        <ChevronDown size={14} className="text-[var(--color-muted)]" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="animate-fade-in absolute left-0 z-40 mt-1.5 min-w-[240px] overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-elevated)] p-1 shadow-[var(--shadow-md)]"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-medium tracking-wide text-[var(--color-subtle)] uppercase">
            Portfolios
          </div>
          {portfolios.map((p) => {
            const active = p.id === currentId;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(p.id)}
                className={
                  'flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm transition-colors ' +
                  (active
                    ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
                    : 'text-[var(--color-fg)] hover:bg-[var(--color-card-hover)]')
                }
              >
                <span className="truncate">{p.name}</span>
                {active ? <Check size={14} /> : null}
              </button>
            );
          })}
          <div className="my-1 border-t border-[var(--color-border)]" />
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push('/portfolios');
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-2 text-left text-sm text-[var(--color-muted)] transition-colors hover:bg-[var(--color-card-hover)] hover:text-[var(--color-fg)]"
          >
            <Plus size={14} />
            Manage portfolios
          </button>
        </div>
      ) : null}
    </div>
  );
}
