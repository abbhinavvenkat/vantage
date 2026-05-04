import { redirect } from 'next/navigation';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function RiskPage({ params }: Props) {
  const { portfolioId } = await params;
  redirect(`/p/${portfolioId}/analytics?section=risk`);
}
