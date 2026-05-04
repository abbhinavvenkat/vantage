'use client';

import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

const EVENT_TYPES = ['earnings', 'agm', 'ex_div', 'record_date', 'other'] as const;
type EventType = (typeof EVENT_TYPES)[number];

const TYPE_LABEL: Record<EventType, string> = {
  earnings: 'Earnings',
  agm: 'AGM',
  ex_div: 'Ex-Dividend',
  record_date: 'Record Date',
  other: 'Other',
};

type Props = {
  portfolioId: string;
  csrfToken: string;
  symbolSuggestions: string[];
};

export function AddEventForm({ portfolioId, csrfToken, symbolSuggestions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState('');
  const [eventType, setEventType] = useState<EventType>('earnings');
  const [eventDate, setEventDate] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const listId = useId();

  const dedupedSymbols = useMemo(() => {
    return Array.from(new Set(symbolSuggestions)).sort();
  }, [symbolSuggestions]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const body: Record<string, unknown> = {
      symbol: symbol.trim(),
      eventType,
      eventDate,
      title: title.trim(),
    };
    if (notes.trim().length > 0) body.notes = notes.trim();

    const res = await fetch(`/api/p/${portfolioId}/events`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (j.error === 'duplicate_event') {
        setError('That exact event already exists');
      } else if (j.error === 'invalid_body') {
        setError('Invalid input — check symbol, date (YYYY-MM-DD), and title');
      } else {
        setError(j.error ?? 'Failed to add');
      }
      return;
    }

    setSymbol('');
    setTitle('');
    setNotes('');
    setEventDate('');
    setEventType('earnings');
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Symbol</label>
          <Input
            required
            list={listId}
            value={symbol}
            placeholder="e.g. ACME-EQ"
            onChange={(e) => setSymbol(e.target.value)}
          />
          <datalist id={listId}>
            {dedupedSymbols.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Type</label>
          <Select value={eventType} onChange={(e) => setEventType(e.target.value as EventType)}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Date</label>
          <Input
            required
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
          />
        </div>
        <div className="lg:col-span-1">
          <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">Title</label>
          <Input
            required
            maxLength={200}
            value={title}
            placeholder="Q1 FY27 results"
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="flex items-end lg:col-span-1">
          <Button type="submit" disabled={isPending} className="w-full">
            {isPending ? 'Adding…' : 'Add event'}
          </Button>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-[var(--color-muted)]">
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={4000}
          placeholder="Anything to remember about this event"
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-3 py-2 text-sm text-[var(--color-fg)] transition-colors placeholder:text-[var(--color-subtle)] focus:border-[var(--color-accent)] focus:ring-2 focus:ring-[var(--color-accent)]/20 focus:outline-none"
        />
      </div>
      {error ? <div className="text-xs text-[var(--color-neg)]">{error}</div> : null}
    </form>
  );
}
