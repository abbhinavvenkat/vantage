import { redirect } from 'next/navigation';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function TaxHarvestPage({ params }: Props) {
  const { portfolioId } = await params;
  redirect(`/p/${portfolioId}/actions?section=tax-harvest`);
}
