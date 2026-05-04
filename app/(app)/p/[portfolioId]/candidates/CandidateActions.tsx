'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  candidateId: string;
  csrfToken: string;
};

export function PromoteButton({ portfolioId, candidateId, csrfToken }: Props) {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleClick() {
    setState('loading');
    setMsg('');
    try {
      const res = await fetch(`/api/p/${portfolioId}/candidates/${candidateId}/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      });
      const json = (await res.json()) as { error?: string; action?: string };
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'promote failed');
        return;
      }
      setState('done');
      setMsg(json.action === 'created' ? 'Added to watchlist' : 'Watchlist updated');
      router.refresh();
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="primary"
        size="sm"
        onClick={handleClick}
        disabled={state === 'loading' || state === 'done'}
      >
        {state === 'loading'
          ? 'Promoting…'
          : state === 'done'
            ? 'Promoted'
            : 'Promote to watchlist'}
      </Button>
      {msg ? (
        <span
          className={
            'text-xs ' +
            (state === 'error' ? 'text-[var(--color-neg)]' : 'text-[var(--color-muted)]')
          }
        >
          {msg}
        </span>
      ) : null}
    </div>
  );
}
