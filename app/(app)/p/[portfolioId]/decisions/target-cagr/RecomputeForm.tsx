'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Refresh } from '@/components/ui/Icons';

type Props = {
  portfolioId: string;
  csrfToken: string;
  initialTargetCagrPct: number;
  initialHorizonYears: number;
};

export function RecomputeForm({
  portfolioId,
  csrfToken,
  initialTargetCagrPct,
  initialHorizonYears,
}: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<number>(initialTargetCagrPct);
  const [horizon, setHorizon] = useState<number>(initialHorizonYears);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  async function handleClick() {
    setState('loading');
    setMsg('');
    try {
      const res = await fetch(`/api/p/${portfolioId}/cagr/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ targetCagrPct: target, horizonYears: horizon }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'recompute failed');
        return;
      }
      setState('idle');
      router.refresh();
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
        Target CAGR (%)
        <Input
          type="number"
          value={target}
          min={5}
          max={50}
          step={1}
          onChange={(e) => setTarget(Number(e.target.value))}
          className="w-28"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--color-muted)]">
        Horizon (years)
        <Input
          type="number"
          value={horizon}
          min={1}
          max={30}
          step={1}
          onChange={(e) => setHorizon(Number(e.target.value))}
          className="w-28"
        />
      </label>
      <Button variant="primary" size="md" onClick={handleClick} disabled={state === 'loading'}>
        <Refresh size={14} className={state === 'loading' ? 'animate-spin' : ''} />
        {state === 'loading' ? 'Computing…' : 'Recompute plan'}
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
