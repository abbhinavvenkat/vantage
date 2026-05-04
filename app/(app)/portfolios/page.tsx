import { CreatePortfolioForm } from '@/app/(app)/portfolios/CreatePortfolioForm';
import { PortfolioRow } from '@/app/(app)/portfolios/PortfolioRow';
import { Card } from '@/components/ui/Card';
import { Briefcase } from '@/components/ui/Icons';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { listPortfolios } from '@/lib/db/queries/portfolios';

export default async function PortfoliosPage() {
  const session = await getSession();
  const csrfToken = session?.csrfToken ?? '';
  const portfolios = listPortfolios(db);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Portfolios</h1>
        <p className="mt-1 text-sm text-[var(--color-muted)]">
          Manage your portfolios. Each is scoped independently with its own holdings.
        </p>
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-semibold">Create new portfolio</h2>
        <p className="mb-4 text-xs text-[var(--color-muted)]">
          Pick a name and base currency. You can rename later.
        </p>
        <CreatePortfolioForm csrfToken={csrfToken} />
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-[var(--color-muted)]">
          Your portfolios ({portfolios.length})
        </h2>
        {portfolios.length === 0 ? (
          <Card>
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-card-hover)] text-[var(--color-muted)]">
                <Briefcase size={20} />
              </div>
              <p className="text-sm font-medium">No portfolios yet</p>
              <p className="text-xs text-[var(--color-muted)]">Create one above to get started.</p>
            </div>
          </Card>
        ) : (
          <ul className="flex flex-col gap-2">
            {portfolios.map((p) => (
              <PortfolioRow
                key={p.id}
                portfolio={{ id: p.id, name: p.name, baseCurrency: p.baseCurrency }}
                csrfToken={csrfToken}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
