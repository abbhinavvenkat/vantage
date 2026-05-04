'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  csrfToken: string;
};

export function EvaluateButton({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/p/${portfolioId}/alerts/evaluate`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    setBusy(false);
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as {
        evaluated?: number;
        fired?: number;
        persisted?: number;
      };
      setMsg(`Evaluated ${j.evaluated ?? 0} · fired ${j.fired ?? 0} · new ${j.persisted ?? 0}`);
      startTransition(() => router.refresh());
    } else {
      setMsg('Evaluation failed');
    }
  }

  return (
    <div className="flex items-center gap-3">
      {msg ? <span className="text-xs text-[var(--color-muted)]">{msg}</span> : null}
      <Button variant="primary" size="sm" onClick={run} disabled={busy || isPending}>
        {busy ? 'Evaluating…' : 'Evaluate now'}
      </Button>
    </div>
  );
}
