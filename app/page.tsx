import type { Route } from 'next';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listPortfolios } from '@/lib/db/queries/portfolios';

export default async function HomePage() {
  const session = await getSession();
  if (!session) {
    redirect('/setup');
  }
  const portfolios = listPortfolios(db);
  if (portfolios.length === 0) {
    redirect('/portfolios');
  }
  redirect(`/p/${portfolios[0]!.id}/holdings` as Route);
}
