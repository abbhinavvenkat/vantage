import { revalidatePath } from 'next/cache';

import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { importEventsFromFiles } from '@/lib/events/importFromFiles';

type Ctx = { params: Promise<{ portfolioId: string }> };

/**
 * POST /api/p/<portfolioId>/events/import
 *
 * Triggers a re-scan of `data/events/<symbol>.json` files written by the
 * events-fetch skill and bulk-imports them into the events table for this
 * portfolio. Idempotent — duplicates are skipped on
 * (portfolioId, symbol, eventType, eventDate, title).
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

  const report = importEventsFromFiles(db, portfolioId);
  revalidatePath(`/p/${portfolioId}/events`);
  return Response.json({ report });
}
