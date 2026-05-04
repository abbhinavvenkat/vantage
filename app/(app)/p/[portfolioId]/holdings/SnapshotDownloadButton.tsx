'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';

type Props = { portfolioId: string; defaultAsOf: string };

/**
 * "Download PDF" button + asOf date picker. The default asOf is today's date
 * (UTC ISO YYYY-MM-DD); the user can override to e.g. last day of previous
 * month for a clean monthly cut.
 */
export function SnapshotDownloadButton({ portfolioId, defaultAsOf }: Props) {
  const [asOf, setAsOf] = useState(defaultAsOf);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState('');

  async function handleClick() {
    setState('loading');
    setErr('');
    try {
      const url = `/api/p/${encodeURIComponent(portfolioId)}/export/snapshot?asOf=${encodeURIComponent(asOf)}`;
      const res = await fetch(url, { method: 'GET' });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
        setState('error');
        setErr(j.detail ?? j.error ?? 'export failed');
        return;
      }
      const blob = await res.blob();
      const cd = res.headers.get('content-disposition') ?? '';
      const m = /filename="([^"]+)"/.exec(cd);
      const filename = m?.[1] ?? `snapshot-${asOf}.pdf`;

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      setState('idle');
    } catch (e) {
      setState('error');
      setErr(String(e));
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        type="date"
        aria-label="As-of date"
        value={asOf}
        onChange={(e) => setAsOf(e.target.value)}
        className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1 text-xs text-[var(--color-fg)] focus:ring-2 focus:ring-[var(--color-accent)] focus:outline-none"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={handleClick}
        disabled={state === 'loading' || !asOf}
      >
        {state === 'loading' ? 'Generating…' : 'Download PDF'}
      </Button>
      {state === 'error' && err ? (
        <span className="hidden text-xs text-[var(--color-neg)] sm:inline">{err}</span>
      ) : null}
    </div>
  );
}
