'use client';

import { useRouter } from 'next/navigation';
import { type FormEvent, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Plus } from '@/components/ui/Icons';

export function CreatePortfolioForm({ csrfToken }: { csrfToken: string }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('INR');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ name, baseCurrency }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `error ${res.status}`);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { portfolio?: { id: string } };
      setName('');
      if (body.portfolio?.id) {
        router.push(`/p/${body.portfolio.id}/holdings`);
      } else {
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <label
          htmlFor="name"
          className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase"
        >
          Name
        </label>
        <Input
          id="name"
          name="name"
          required
          minLength={1}
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Main, Long-term, Tactical"
        />
      </div>
      <div className="flex flex-col gap-1.5 sm:w-32">
        <label
          htmlFor="baseCurrency"
          className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase"
        >
          Currency
        </label>
        <Select
          id="baseCurrency"
          name="baseCurrency"
          value={baseCurrency}
          onChange={(e) => setBaseCurrency(e.target.value)}
        >
          <option value="INR">INR</option>
          <option value="USD">USD</option>
        </Select>
      </div>
      <Button type="submit" disabled={submitting || name.trim().length === 0} size="md">
        <Plus size={14} />
        {submitting ? 'Creating…' : 'Create'}
      </Button>
      {error ? <p className="text-xs text-[var(--color-neg)]">{error}</p> : null}
    </form>
  );
}
