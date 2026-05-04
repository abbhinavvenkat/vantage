import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { removeTarget } from '@/lib/db/queries/rebalanceTargets';

type Ctx = { params: Promise<{ portfolioId: string; id: string }> };

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, id } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const removed = removeTarget(db, portfolioId, id);
  if (!removed) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ target: removed });
}
