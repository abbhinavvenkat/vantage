import { revalidatePath } from 'next/cache';

import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { importNewsFromFiles } from '@/lib/db/queries/news';
import { getPortfolio } from '@/lib/db/queries/portfolios';

type Ctx = { params: Promise<{ portfolioId: string }> };

/**
 * POST /api/p/<portfolioId>/news/import
 *
 * Triggers a re-scan of `data/news/<symbol>.json` files written by the
 * news-fetch skill and upserts them into `news_items` for this portfolio.
 * Idempotent on (portfolioId, url).
 */
export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const report = importNewsFromFiles(db, portfolioId);
  revalidatePath(`/p/${portfolioId}/news`);
  return Response.json({ report });
}
