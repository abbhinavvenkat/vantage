'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Refresh } from '@/components/ui/Icons';

type Props = { portfolioId: string; csrfToken: string };

export function RefreshFilingsButton({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleClick() {
    setState('loading');
    setMsg('');
    try {
      const res = await fetch(`/api/p/${portfolioId}/filings/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      });
      const json = await res.json();
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'refresh failed');
        return;
      }
      const r = json.report ?? {};
      setState('done');
      setMsg(`+${r.inserted ?? 0} new, ${r.updated ?? 0} updated`);
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
        {state === 'loading' ? 'Scanning…' : 'Refresh'}
      </Button>
    </div>
  );
}
