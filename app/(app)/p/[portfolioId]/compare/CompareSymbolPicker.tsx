'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { X } from '@/components/ui/Icons';

import { MAX_COMPARE_SYMBOLS } from '@/lib/compare/aggregate';

type Suggestion = { symbol: string; source: 'portfolio' | 'watchlist' };

type Props = {
  portfolioId: string;
  selected: string[];
  suggestions: Suggestion[];
};

export function CompareSymbolPicker({ portfolioId, selected, suggestions }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [chips, setChips] = useState<string[]>(selected);
  const [draft, setDraft] = useState<string>('');

  const suggestionMap = useMemo(() => {
    const m = new Map<string, Suggestion['source']>();
    for (const s of suggestions) m.set(s.symbol, s.source);
    return m;
  }, [suggestions]);

  const filteredSuggestions = useMemo(() => {
    const q = draft.trim().toUpperCase();
    return suggestions.filter(
      (s) => !chips.includes(s.symbol) && (q === '' || s.symbol.includes(q)),
    );
  }, [chips, draft, suggestions]);

  const addChip = (raw: string): void => {
    const s = raw.trim().toUpperCase();
    if (!s) return;
    if (chips.includes(s)) return;
    if (chips.length >= MAX_COMPARE_SYMBOLS) return;
    setChips([...chips, s]);
    setDraft('');
  };

  const removeChip = (s: string): void => {
    setChips(chips.filter((c) => c !== s));
  };

  const apply = (): void => {
    const qs = chips.length > 0 ? `?symbols=${chips.join(',')}` : '';
    startTransition(() => {
      router.push(`/p/${portfolioId}/compare${qs}`);
    });
  };

  const clear = (): void => {
    setChips([]);
    startTransition(() => {
      router.push(`/p/${portfolioId}/compare`);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChip(draft);
    } else if (e.key === 'Backspace' && draft === '' && chips.length > 0) {
      removeChip(chips[chips.length - 1]!);
    }
  };

  const canAdd = chips.length < MAX_COMPARE_SYMBOLS;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips.map((c) => (
          <span
            key={c}
            className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-accent)]/30 bg-[var(--color-accent-soft)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]"
          >
            {c}
            {suggestionMap.get(c) === 'portfolio' ? (
              <span className="text-[10px] opacity-60">·held</span>
            ) : suggestionMap.get(c) === 'watchlist' ? (
              <span className="text-[10px] opacity-60">·watch</span>
            ) : null}
            <button
              type="button"
              aria-label={`Remove ${c}`}
              onClick={() => removeChip(c)}
              className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-[var(--color-accent)]/20"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        {chips.length === 0 ? (
          <span className="text-xs text-[var(--color-muted)]">
            Pick {MAX_COMPARE_SYMBOLS === 5 ? '2–5' : 'symbols'} to compare
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          aria-label="Add symbol"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={canAdd ? 'Type a symbol and press Enter' : 'Max 5 symbols'}
          disabled={!canAdd}
          className="sm:max-w-xs"
        />
        <div className="flex items-center gap-2">
          <Button type="button" onClick={apply} disabled={isPending}>
            {isPending ? 'Loading…' : 'Compare'}
          </Button>
          {chips.length > 0 ? (
            <Button type="button" variant="ghost" onClick={clear} disabled={isPending}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>

      {filteredSuggestions.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase">
            From your portfolio + watchlist
          </span>
          <div className="flex flex-wrap gap-1.5">
            {filteredSuggestions.slice(0, 24).map((s) => (
              <button
                key={s.symbol}
                type="button"
                disabled={!canAdd}
                onClick={() => addChip(s.symbol)}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-2.5 py-1 text-xs text-[var(--color-fg)] transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-card-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {s.symbol}
                <span className="text-[10px] text-[var(--color-muted)]">
                  {s.source === 'portfolio' ? 'held' : 'watch'}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
