import Link from 'next/link';

import { HeaderClient } from '@/app/(app)/HeaderClient';
import { Brand } from '@/components/ui/Brand';
import { db } from '@/lib/db/client';
import { listPortfolios } from '@/lib/db/queries/portfolios';

export async function AppHeader() {
  const portfolios = listPortfolios(db);
  return (
    <header className="sticky top-0 z-30 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="shrink-0">
          <Brand />
        </Link>
        <HeaderClient portfolios={portfolios.map((p) => ({ id: p.id, name: p.name }))} />
      </div>
    </header>
  );
}
