'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

function validate(password: string, confirm: string): string | null {
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter.';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter.';
  if (!/\d/.test(password)) return 'Password must contain a digit.';
  if (password !== confirm) return 'Passwords do not match.';
  return null;
}

export function SetupForm(): React.JSX.Element {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    const v = validate(password, confirm);
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password, confirm }),
      });
      if (res.status === 201) {
        router.replace('/');
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? `Request failed (${res.status})`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="password"
          className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase"
        >
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="At least 12 characters"
        />
        <p className="text-[11px] text-[var(--color-muted)]">
          Minimum 12 characters with upper, lower and digit.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="confirmPassword"
          className="text-[11px] font-medium tracking-wide text-[var(--color-muted)] uppercase"
        >
          Confirm password
        </label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Re-enter password"
        />
      </div>
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-neg)]/20 bg-[var(--color-neg-soft)] px-3 py-2 text-xs text-[var(--color-neg)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy} size="lg" className="w-full">
        {busy ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  );
}
