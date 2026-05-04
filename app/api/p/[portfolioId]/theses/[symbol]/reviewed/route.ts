import { getSession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { markReviewed } from '@/lib/db/queries/theses';

type Ctx = { params: Promise<{ portfolioId: string; symbol: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, symbol } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const sym = decodeURIComponent(symbol).toUpperCase();
  const today = new Date().toISOString().slice(0, 10);
  const thesis = markReviewed(db, portfolioId, sym, today);
  if (!thesis) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ thesis });
}
