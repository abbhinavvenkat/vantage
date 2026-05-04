'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Refresh } from '@/components/ui/Icons';

type Props = { portfolioId: string; csrfToken: string };

type Summary = { fetched: number; cached: number; errored: number; totalRows: number };

export function BackfillPricesButton({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleClick() {
    setState('loading');
    setMsg('');
    try {
      const res = await fetch(`/api/p/${portfolioId}/prices/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      });
      const json = (await res.json()) as { error?: string; summary?: Summary };
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'backfill failed');
        return;
      }
      setState('done');
      const s = json.summary;
      setMsg(
        s
          ? `Fetched ${s.fetched} (${s.totalRows} rows) · cached ${s.cached} · errors ${s.errored}`
          : 'Backfill complete',
      );
      router.refresh();
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg ? (
        <span
          className={
            'hidden text-xs sm:inline ' +
            (state === 'error' ? 'text-[var(--color-neg)]' : 'text-[var(--color-muted)]')
          }
        >
          {msg}
        </span>
      ) : null}
      <Button variant="secondary" size="sm" onClick={handleClick} disabled={state === 'loading'}>
        <Refresh size={14} className={state === 'loading' ? 'animate-spin' : ''} />
        {state === 'loading' ? 'Backfilling…' : 'Backfill History'}
      </Button>
    </div>
  );
}
