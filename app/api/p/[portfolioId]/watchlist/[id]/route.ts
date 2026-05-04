import { getSession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { removeWatchlistEntry, updateWatchlistEntry } from '@/lib/db/queries/watchlist';
import { UpdateWatchlistBody } from '@/lib/validation/watchlist';

type Ctx = { params: Promise<{ portfolioId: string; id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, id } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = UpdateWatchlistBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const entry = updateWatchlistEntry(db, portfolioId, id, parsed.data);
  if (!entry) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ entry });
}

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

  const entry = removeWatchlistEntry(db, portfolioId, id);
  if (!entry) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ entry });
}
