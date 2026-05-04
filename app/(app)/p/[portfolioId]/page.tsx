import type { Route } from 'next';
import { redirect } from 'next/navigation';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function PortfolioIndex({ params }: Props) {
  const { portfolioId } = await params;
  redirect(`/p/${portfolioId}/holdings` as Route);
}
