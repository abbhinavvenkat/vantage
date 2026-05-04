'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Refresh } from '@/components/ui/Icons';

type Props = { portfolioId: string; csrfToken: string };

export function RefreshPricesButton({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleClick() {
    setState('loading');
    setMsg('');
    try {
      const res = await fetch('/api/prices/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ portfolioId }),
      });
      const json = await res.json();
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'refresh failed');
        return;
      }
      setState('done');
      setMsg(`Updated ${json.refreshed} symbol${json.refreshed !== 1 ? 's' : ''}`);
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
        {state === 'loading' ? 'Refreshing…' : 'Refresh Prices'}
      </Button>
    </div>
  );
}
