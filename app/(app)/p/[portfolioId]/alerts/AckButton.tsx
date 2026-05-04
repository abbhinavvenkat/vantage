'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  eventId: string;
  csrfToken: string;
};

export function AckButton({ portfolioId, eventId, csrfToken }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function onAck() {
    setBusy(true);
    const res = await fetch(`/api/p/${portfolioId}/alerts/events/${eventId}/ack`, {
      method: 'POST',
      headers: { 'x-csrf-token': csrfToken },
    });
    setBusy(false);
    if (res.ok) startTransition(() => router.refresh());
  }

  return (
    <Button variant="secondary" size="sm" onClick={onAck} disabled={busy || isPending}>
      {busy ? 'Acking…' : 'Acknowledge'}
    </Button>
  );
}
