import { redirect } from 'next/navigation';
import { db } from '@/lib/db/client';
import { userCount } from '@/lib/db/queries/users';
import { Brand } from '@/components/ui/Brand';
import { Card } from '@/components/ui/Card';
import { SetupForm } from './SetupForm';

export default async function SetupPage(): Promise<React.JSX.Element> {
  const count = userCount(db);
  if (count > 0) {
    redirect('/login');
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg)] p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Brand size={40} />
        </div>
        <Card className="p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">Set up your account</h1>
          <p className="mt-1 mb-5 text-sm text-[var(--color-muted)]">
            First-run setup. This password protects your local Vantage install.
          </p>
          <SetupForm />
        </Card>
        <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
          Local-only · Choose a strong password — you won&apos;t be able to recover it.
        </p>
      </div>
    </main>
  );
}
