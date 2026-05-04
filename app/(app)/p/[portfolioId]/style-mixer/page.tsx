import { redirect } from 'next/navigation';

type Props = { params: Promise<{ portfolioId: string }> };

export default async function StyleMixerPage({ params }: Props) {
  const { portfolioId } = await params;
  redirect(`/p/${portfolioId}/actions?section=style-mixer`);
}
