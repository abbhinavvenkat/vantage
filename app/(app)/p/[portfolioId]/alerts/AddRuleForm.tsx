'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ALERT_RULE_TYPES, type AlertRuleType } from '@/lib/db/schema';

const RULE_LABELS: Record<AlertRuleType, string> = {
  cmp_below: 'CMP below ₹threshold',
  cmp_above: 'CMP above ₹threshold',
  pct_drop_from_52w_high: '% drop from 52w high',
  pct_rise_from_52w_low: '% rise from 52w low',
  volume_spike: 'Volume spike (× 30d avg)',
};

type Props = {
  portfolioId: string;
  csrfToken: string;
};

export function AddRuleForm({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [ruleType, setRuleType] = useState<AlertRuleType>('cmp_below');
  const [threshold, setThreshold] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const n = Number(threshold);
    if (!Number.isFinite(n) || n <= 0) {
      setError('Threshold must be a positive number');
      return;
    }
    if (symbol.trim().length === 0) {
      setError('Symbol is required');
      return;
    }

    const res = await fetch(`/api/p/${portfolioId}/alerts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ symbol: symbol.trim(), ruleType, threshold: n }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? 'Failed to add rule');
      return;
    }
    setSymbol('');
    setThreshold('');
    setRuleType('cmp_below');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Symbol</label>
          <Input
            required
            value={symbol}
            placeholder="e.g. ACME-EQ"
            onChange={(e) => setSymbol(e.target.value)}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Rule type
          </label>
          <Select value={ruleType} onChange={(e) => setRuleType(e.target.value as AlertRuleType)}>
            {ALERT_RULE_TYPES.map((t) => (
              <option key={t} value={t}>
                {RULE_LABELS[t]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
            Threshold
          </label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={threshold}
            placeholder="e.g. 100 or 20 (for %)"
            onChange={(e) => setThreshold(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? 'Adding…' : 'Add rule'}
          </Button>
        </div>
      </div>
      {error ? <div className="text-xs text-[var(--color-neg)]">{error}</div> : null}
    </form>
  );
}
