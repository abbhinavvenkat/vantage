import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { userCount } from '@/lib/db/queries/users';
import { Brand } from '@/components/ui/Brand';
import { Card } from '@/components/ui/Card';
import { LoginForm } from './LoginForm';

export default async function LoginPage(): Promise<React.JSX.Element> {
  const count = userCount(db);
  if (count === 0) {
    redirect('/setup');
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand size={40} />
        </div>
        <Card className="p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 mb-5 text-sm text-[var(--color-muted)]">
            Sign in to continue to your portfolios.
          </p>
          <Suspense>
            <LoginForm />
          </Suspense>
        </Card>
        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          Local-only · Your data never leaves this machine.
        </p>
      </div>
    </main>
  );
}
