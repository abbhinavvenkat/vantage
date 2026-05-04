'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  entryId: string;
  symbol: string;
  csrfToken: string;
};

export function RemoveButton({ portfolioId, entryId, symbol, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onRemove() {
    if (!confirm(`Remove ${symbol} from watchlist?`)) return;
    setBusy(true);
    const res = await fetch(`/api/p/${portfolioId}/watchlist/${entryId}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken },
    });
    setBusy(false);
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy || isPending}>
      {busy ? 'Removing…' : 'Remove'}
    </Button>
  );
}
