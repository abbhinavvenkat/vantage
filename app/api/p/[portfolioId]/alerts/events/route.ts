import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { countUnackedEvents, listEvents } from '@/lib/db/queries/alerts';
import { getPortfolio } from '@/lib/db/queries/portfolios';

type Ctx = { params: Promise<{ portfolioId: string }> };

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { portfolioId } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const url = new URL(req.url);
  const onlyCount = url.searchParams.get('count') === '1';
  if (onlyCount) {
    return Response.json({ unacked: countUnackedEvents(db, portfolioId) });
  }

  const filterParam = url.searchParams.get('filter');
  const filter =
    filterParam === 'acked' ? { acked: true } : filterParam === 'unacked' ? { acked: false } : {};
  return Response.json({ events: listEvents(db, portfolioId, filter) });
}
