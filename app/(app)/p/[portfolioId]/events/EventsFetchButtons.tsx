'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Props = {
  portfolioId: string;
  csrfToken: string;
  symbols: string[];
};

export function EventsFetchButtons({ portfolioId, csrfToken, symbols }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState(false);
  const [importState, setImportState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const command = symbols.length > 0 ? `/events-fetch ${symbols.join(' ')}` : '/events-fetch';

  async function copyCommand(): Promise<void> {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function reimport(): Promise<void> {
    setImportState('loading');
    setMsg('');
    try {
      const res = await fetch(`/api/p/${portfolioId}/events/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      });
      const json = await res.json();
      if (!res.ok) {
        setImportState('error');
        setMsg(json.error ?? 'import failed');
        return;
      }
      setImportState('done');
      const r = json.report ?? {};
      setMsg(
        `Imported ${r.inserted ?? 0} new · skipped ${r.skipped ?? 0} · ${r.symbolsScanned ?? 0} files scanned`,
      );
      router.refresh();
    } catch (e) {
      setImportState('error');
      setMsg(String(e));
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] p-4">
      <div>
        <h3 className="text-xs font-semibold tracking-wide text-[var(--color-muted)] uppercase">
          Auto-fetch upcoming events
        </h3>
        <p className="mt-1 text-xs text-[var(--color-muted)]">
          {symbols.length} symbol{symbols.length === 1 ? '' : 's'} (held + watchlist). Run the skill
          in Claude Code, then click <em>Re-import from files</em>.
        </p>
      </div>

      <pre className="overflow-x-auto rounded-[var(--radius-sm)] bg-[var(--color-card-hover)] px-3 py-2 text-[11px] text-[var(--color-fg)]">
        <code>{command}</code>
      </pre>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={copyCommand}>
          {copied ? 'Copied!' : 'Copy command'}
        </Button>
        <Button variant="primary" size="sm" onClick={reimport} disabled={importState === 'loading'}>
          {importState === 'loading' ? 'Importing…' : 'Re-import from files'}
        </Button>
        {msg ? (
          <span
            className={
              'text-xs ' +
              (importState === 'error' ? 'text-[var(--color-neg)]' : 'text-[var(--color-muted)]')
            }
          >
            {msg}
          </span>
        ) : null}
      </div>
    </div>
  );
}
