import { getSession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db/client';
import { addEvent, listEvents } from '@/lib/db/queries/events';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { CreateEventBody } from '@/lib/validation/events';

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
  const fromDate = url.searchParams.get('fromDate') ?? undefined;
  const toDate = url.searchParams.get('toDate') ?? undefined;
  const orderRaw = url.searchParams.get('order');
  const order = orderRaw === 'desc' ? 'desc' : orderRaw === 'asc' ? 'asc' : undefined;

  const entries = listEvents(db, portfolioId, { fromDate, toDate, order });
  return Response.json({ entries });
}

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

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = CreateEventBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const entry = addEvent(db, portfolioId, { ...parsed.data, source: 'manual' });
    return Response.json({ entry }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('unique')) {
      return Response.json({ error: 'duplicate_event' }, { status: 409 });
    }
    throw err;
  }
}
