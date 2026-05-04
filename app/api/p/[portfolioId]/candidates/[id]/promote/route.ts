import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getCandidate } from '@/lib/db/queries/candidates';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { addWatchlistEntry, updateWatchlistEntry } from '@/lib/db/queries/watchlist';
import { watchlist } from '@/lib/db/schema';
import { and, eq } from 'drizzle-orm';

type Ctx = { params: Promise<{ portfolioId: string; id: string }> };

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, id } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const cand = getCandidate(db, portfolioId, id);
  if (!cand) return Response.json({ error: 'not_found' }, { status: 404 });

  // If already on the watchlist, refresh thesis + targets + conviction; else insert.
  const existing = db
    .select()
    .from(watchlist)
    .where(and(eq(watchlist.portfolioId, portfolioId), eq(watchlist.symbol, cand.symbol)))
    .get();

  if (existing) {
    const entry = updateWatchlistEntry(db, portfolioId, existing.id, {
      thesis: cand.thesisMd || null,
      targetBuyPrice: cand.entryFair,
      targetSellPrice: cand.entryStrong, // strong_buy used as the "add aggressively" zone
      conviction: cand.convictionLevel,
    });
    return Response.json({ entry, action: 'updated' });
  }

  try {
    const entry = addWatchlistEntry(db, portfolioId, {
      symbol: cand.symbol,
      thesis: cand.thesisMd || null,
      targetBuyPrice: cand.entryFair,
      targetSellPrice: cand.entryStrong,
      conviction: cand.convictionLevel,
    });
    return Response.json({ entry, action: 'created' }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return Response.json({ error: 'duplicate_symbol' }, { status: 409 });
    }
    throw err;
  }
}
