import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { listTargets, upsertTarget } from '@/lib/db/queries/rebalanceTargets';
import { REBALANCE_MODES, type RebalanceMode } from '@/lib/db/schema';
import { UpsertRebalanceTargetBody } from '@/lib/validation/rebalance';

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
  const modeParam = url.searchParams.get('mode');
  const mode =
    modeParam && (REBALANCE_MODES as readonly string[]).includes(modeParam)
      ? (modeParam as RebalanceMode)
      : undefined;

  return Response.json({ targets: listTargets(db, portfolioId, mode) });
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
  const parsed = UpsertRebalanceTargetBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const target = upsertTarget(db, portfolioId, parsed.data);
  return Response.json({ target }, { status: 201 });
}
