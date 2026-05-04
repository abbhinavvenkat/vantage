'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Props = {
  portfolioId: string;
  newsId: string;
  isRead: boolean;
  csrfToken: string;
};

export function MarkReadToggle({ portfolioId, newsId, isRead, csrfToken }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/p/${portfolioId}/news/${newsId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
        body: JSON.stringify({ isRead: !isRead }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setErr(j.error ?? 'failed');
        return;
      }
      router.refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className="inline-flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs text-[var(--color-fg)] transition-colors hover:bg-[var(--color-card-hover)] disabled:opacity-50"
      title={err ?? undefined}
    >
      {busy ? '…' : isRead ? 'Mark unread' : 'Mark read'}
    </button>
  );
}
