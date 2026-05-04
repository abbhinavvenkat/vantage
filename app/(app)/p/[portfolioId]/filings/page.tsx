import { redirect } from 'next/navigation';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function FilingsPage({ params }: Props) {
  const { portfolioId } = await params;
  redirect(`/p/${portfolioId}/research?section=filings`);
}
