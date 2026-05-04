'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  eventId: string;
  title: string;
  csrfToken: string;
};

export function DeleteEventButton({ portfolioId, eventId, title, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    if (!confirm(`Delete event "${title}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/p/${portfolioId}/events/${eventId}`, {
      method: 'DELETE',
      headers: { 'x-csrf-token': csrfToken },
    });
    setBusy(false);
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <Button variant="ghost" size="sm" onClick={onDelete} disabled={busy || isPending}>
      {busy ? 'Deleting…' : 'Delete'}
    </Button>
  );
}
