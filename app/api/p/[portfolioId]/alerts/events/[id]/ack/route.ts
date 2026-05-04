import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { ackEvent } from '@/lib/db/queries/alerts';

type Ctx = { params: Promise<{ portfolioId: string; id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, id } = await ctx.params;
  const acked = ackEvent(db, portfolioId, id);
  if (!acked) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ event: acked });
}
