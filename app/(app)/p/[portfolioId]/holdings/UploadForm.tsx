'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { Upload as UploadIcon } from '@/components/ui/Icons';

type Props = { portfolioId: string; csrfToken: string };

export function UploadForm({ portfolioId, csrfToken }: Props) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = inputRef.current?.files?.[0];
    if (!file) return;

    setState('loading');
    setMsg('');

    const form = new FormData();
    form.append('portfolioId', portfolioId);
    form.append('file', file);

    try {
      const res = await fetch('/api/ingest', {
        method: 'POST',
        headers: { 'x-csrf-token': csrfToken },
        body: form,
      });
      const json = await res.json();
      if (!res.ok) {
        setState('error');
        setMsg(json.error ?? 'Upload failed');
        return;
      }
      setState('done');
      setMsg(
        `Imported ${json.inserted} new trade${json.inserted !== 1 ? 's' : ''} (${json.skipped} skipped)`,
      );
      if (inputRef.current) inputRef.current.value = '';
      setFileName(null);
      router.refresh();
    } catch (err) {
      setState('error');
      setMsg(String(err));
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:gap-3"
    >
      <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-card)] px-3 text-sm text-[var(--color-muted)] transition-colors hover:border-[var(--color-accent)] hover:text-[var(--color-fg)]">
        <UploadIcon size={14} />
        <span className="max-w-[180px] truncate">{fileName ?? 'Choose .xlsx / .csv'}</span>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.csv"
          className="sr-only"
          onChange={(e) => setFileName(e.currentTarget.files?.[0]?.name ?? null)}
        />
      </label>
      <Button type="submit" variant="primary" size="md" disabled={state === 'loading'}>
        {state === 'loading' ? 'Uploading…' : 'Upload Tradebook'}
      </Button>
      {msg ? (
        <span
          className={
            'text-xs ' + (state === 'error' ? 'text-[var(--color-neg)]' : 'text-[var(--color-pos)]')
          }
        >
          {msg}
        </span>
      ) : null}
    </form>
  );
}
