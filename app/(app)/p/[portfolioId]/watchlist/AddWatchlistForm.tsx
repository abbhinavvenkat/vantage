'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

type Conviction = 'high' | 'medium' | 'low';

type Props = {
  portfolioId: string;
  csrfToken: string;
};

export function AddWatchlistForm({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [thesis, setThesis] = useState('');
  const [targetBuy, setTargetBuy] = useState('');
  const [targetSell, setTargetSell] = useState('');
  const [conviction, setConviction] = useState<Conviction>('medium');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const body: Record<string, unknown> = {
      symbol: symbol.trim(),
      conviction,
    };
    if (thesis.trim().length > 0) body.thesis = thesis.trim();
    if (targetBuy !== '') {
      const n = Number(targetBuy);
      if (!Number.isFinite(n) || n <= 0) {
        setError('Target buy price must be a positive number');
        return;
      }
      body.targetBuyPrice = n;
    }
    if (targetSell !== '') {
      const n = Number(targetSell);
      if (!Number.isFinite(n) || n <= 0) {
        setError('Target sell price must be a positive number');
        return;
      }
      body.targetSellPrice = n;
    }

    const res = await fetch(`/api/p/${portfolioId}/watchlist`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (j.error === 'duplicate_symbol') {
        setError(`${body.symbol as string} is already on the watchlist`);
      } else if (j.error === 'invalid_body') {
        setError('Invalid input — check symbol and target prices');
      } else {
        setError(j.error ?? 'Failed to add');
      }
      return;
    }

    setSymbol('');
    setThesis('');
    setTargetBuy('');
    setTargetSell('');
    setConviction('medium');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Symbol</label>
          <Input
            required
            value={symbol}
            placeholder="e.g. ACME-EQ"
            onChange={(e) => setSymbol(e.target.value)}
          />
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Target Buy
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={targetBuy}
            placeholder="100.00"
            onChange={(e) => setTargetBuy(e.target.value)}
          />
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Target Sell
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={targetSell}
            placeholder="250.00"
            onChange={(e) => setTargetSell(e.target.value)}
          />
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Conviction
          </label>
          <Select value={conviction} onChange={(e) => setConviction(e.target.value as Conviction)}>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </div>
        <div className="flex items-end lg:col-span-1">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? 'Adding…' : 'Add to watchlist'}
          </Button>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
          Thesis (optional)
        </label>
        <textarea
          value={thesis}
          onChange={(e) => setThesis(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Why is this on your radar?"
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-fg)] transition-colors placeholder:text-[var(--color-subtle)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:outline-none"
        />
      </div>
      {error ? <div className="text-xs text-[var(--color-neg)]">{error}</div> : null}
    </form>
  );
}
