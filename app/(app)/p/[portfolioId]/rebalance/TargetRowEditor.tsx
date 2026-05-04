'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { RebalanceMode } from '@/lib/db/schema';

type Props = {
  portfolioId: string;
  csrfToken: string;
  mode: RebalanceMode;
  /** Existing target keys, used to populate the dropdown for sector mode. */
  knownKeys: string[];
};

export function AddTargetForm({ portfolioId, csrfToken, mode, knownKeys }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [pct, setPct] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const k = key.trim();
    const p = Number(pct);
    if (k.length === 0) {
      setError('Key required');
      return;
    }
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      setError('Target must be 0-100');
      return;
    }

    const res = await fetch(`/api/p/${portfolioId}/rebalance/targets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ mode, key: k, targetPct: p }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Failed to add target');
      return;
    }
    setKey('');
    setPct('');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            {mode === 'symbol' ? 'Symbol' : 'Sector'}
          </label>
          {mode === 'sector' && knownKeys.length > 0 ? (
            <Select value={key} onChange={(e) => setKey(e.target.value)}>
              <option value="">— select sector —</option>
              {knownKeys.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              required
              value={key}
              placeholder={mode === 'symbol' ? 'e.g. TCS' : 'e.g. Software Services'}
              onChange={(e) => setKey(e.target.value)}
            />
          )}
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Target %
          </label>
          <Input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={pct}
            placeholder="e.g. 25"
            onChange={(e) => setPct(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? 'Saving…' : 'Save target'}
          </Button>
        </div>
      </div>
      {error ? <div className="text-xs text-[var(--color-neg)]">{error}</div> : null}
    </form>
  );
}

export function DeleteTargetButton({
  portfolioId,
  id,
  csrfToken,
}: {
  portfolioId: string;
  id: string;
  csrfToken: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  async function onClick() {
    const res = await fetch(`/api/p/${portfolioId}/rebalance/targets/${id}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken },
    });
    if (res.ok) startTransition(() => router.refresh());
  }
  return (
    <Button variant="ghost" size="sm" onClick={onClick} disabled={isPending}>
      {isPending ? '…' : 'Remove'}
    </Button>
  );
}
