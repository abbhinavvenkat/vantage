import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { AppHeader } from '@/app/(app)/AppHeader';
import { getSession } from '@/lib/auth/session';

export default async function AppGroupLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }
  return (
    <div className="flex min-h-screen flex-col bg-[var(--color-bg)]">
      <AppHeader />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
