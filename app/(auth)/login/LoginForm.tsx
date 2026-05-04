'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

export function LoginForm(): React.JSX.Element {
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get('from') ?? '/';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    if (password.length === 0) {
      setError('Password is required.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.status === 200) {
        router.replace(from);
        return;
      }
      if (res.status === 429) {
        setError('Too many attempts. Try again in 15 minutes.');
        return;
      }
      setError('Invalid password.');
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
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
        />
      </div>
      {error ? (
        <div className="rounded-[var(--radius-md)] border border-[var(--color-neg)]/20 bg-[var(--color-neg-soft)] px-3 py-2 text-xs text-[var(--color-neg)]">
          {error}
        </div>
      ) : null}
      <Button type="submit" disabled={busy} size="lg" className="w-full">
        {busy ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
