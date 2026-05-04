import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';

type Props = {
  children: ReactNode;
  params: Promise<{ portfolioId: string }>;
};

export default async function PortfolioLayout({ children, params }: Props) {
  const { portfolioId } = await params;
  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio || portfolio.archivedAt !== null) {
    notFound();
  }

  return <div className="flex flex-col gap-5">{children}</div>;
}
