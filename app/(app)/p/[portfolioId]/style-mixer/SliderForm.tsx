'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';

export type InvestorRow = {
  slug: string;
  name: string;
  schools: string[];
  backtest: { xirr: number; alpha: number; cycles: number } | null;
};

type Props = {
  portfolioId: string;
  csrfToken: string;
  investors: InvestorRow[];
  initialWeights: Record<string, number>;
  autoWeights: Record<string, number>;
};

function fmtPct(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '—';
  const sign = x >= 0 ? '+' : '';
  return `${sign}${(x * 100).toFixed(digits)}%`;
}

export function SliderForm({
  portfolioId,
  csrfToken,
  investors,
  initialWeights,
  autoWeights,
}: Props) {
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    for (const inv of investors) out[inv.slug] = initialWeights[inv.slug] ?? 0;
    return out;
  });
  const [state, setState] = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const router = useRouter();

  const total = useMemo(() => Object.values(weights).reduce((a, b) => a + b, 0), [weights]);

  function setOne(slug: string, raw: number) {
    setWeights((w) => ({ ...w, [slug]: raw }));
  }

  function reset() {
    const even: Record<string, number> = {};
    const w = 1 / Math.max(1, investors.length);
    for (const inv of investors) even[inv.slug] = w;
    setWeights(even);
  }

  function autoFill() {
    const out: Record<string, number> = {};
    for (const inv of investors) out[inv.slug] = autoWeights[inv.slug] ?? 0;
    setWeights(out);
  }

  async function save() {
    setState('saving');
    setMsg('');
    try {
      const res = await fetch('/api/style-weights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ portfolioId, weights }),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'save failed');
        return;
      }
      setState('done');
      setMsg('Saved. Re-score Decisions to apply.');
      router.refresh();
    } catch (e) {
      setState('error');
      setMsg(String(e));
    }
  }

  // Sort investors by backtest XIRR desc, then alphabetically.
  const sorted = useMemo(() => {
    return [...investors].sort((a, b) => {
      const ax = a.backtest?.xirr ?? -1;
      const bx = b.backtest?.xirr ?? -1;
      if (ax !== bx) return bx - ax;
      return a.name.localeCompare(b.name);
    });
  }, [investors]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={autoFill} disabled={state === 'saving'}>
          Auto-weight by backtest XIRR
        </Button>
        <Button variant="secondary" onClick={reset} disabled={state === 'saving'}>
          Equal weight
        </Button>
        <span className="text-[11px] text-[var(--color-muted)]">
          {Object.keys(autoWeights).length} backtested investors out of {investors.length}.
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {sorted.map((inv) => {
          const v = weights[inv.slug] ?? 0;
          const pct = total > 0 ? (v / total) * 100 : 0;
          return (
            <div
              key={inv.slug}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card-hover)] p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex flex-col">
                  <span className="font-medium">{inv.name}</span>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    {inv.schools.slice(0, 4).map((s) => (
                      <span
                        key={s}
                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-card)] px-1.5 py-0.5 text-[10px] text-[var(--color-muted)]"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs tabular-nums">
                  {inv.backtest ? (
                    <span className="flex flex-col items-end">
                      <span className="text-[var(--color-pos)]">
                        XIRR {fmtPct(inv.backtest.xirr, 2)}
                      </span>
                      <span className="text-[var(--color-muted)]">
                        alpha {fmtPct(inv.backtest.alpha, 2)} · {inv.backtest.cycles} cycles
                      </span>
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--color-muted)]">not backtested</span>
                  )}
                  <span className="w-16 text-right text-[var(--color-muted)]">
                    {v.toFixed(2)} <span className="text-[10px]">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={v}
                onChange={(e) => setOne(inv.slug, Number(e.target.value))}
                className="w-full"
              />
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={state === 'saving'}>
          {state === 'saving' ? 'Saving…' : 'Save weights'}
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
      <p className="text-xs text-[var(--color-muted)]">
        Raw values are normalised so they sum to 1 on save. Auto-weight uses each backtested
        framework&apos;s annualised XIRR over 4 decision cycles (2016, 2020, 2023, 2026); investors
        without a backtest get a small floor.
      </p>
    </div>
  );
}
