'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  ruleId: string;
  enabled: boolean;
  csrfToken: string;
};

export function RuleActions({ portfolioId, ruleId, enabled, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await fetch(`/api/p/${portfolioId}/alerts/${ruleId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ enabled: !enabled }),
    });
    setBusy(false);
    if (res.ok) startTransition(() => router.refresh());
  }

  async function remove() {
    if (!confirm('Delete this alert rule?')) return;
    setBusy(true);
    const res = await fetch(`/api/p/${portfolioId}/alerts/${ruleId}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken },
    });
    setBusy(false);
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <div className="inline-flex gap-1">
      <Button variant="secondary" size="sm" onClick={toggle} disabled={busy || isPending}>
        {enabled ? 'Disable' : 'Enable'}
      </Button>
      <Button variant="ghost" size="sm" onClick={remove} disabled={busy || isPending}>
        Delete
      </Button>
    </div>
  );
}
