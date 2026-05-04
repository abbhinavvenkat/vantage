import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { runCagrPlan } from '@/lib/cagr/run';
import { db } from '@/lib/db/client';
import { insertCagrPlan, latestCagrPlan } from '@/lib/db/queries/cagrPlans';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { BuildCagrPlanBody } from '@/lib/validation/cagr';

type Ctx = { params: Promise<{ portfolioId: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { portfolioId } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const latest = latestCagrPlan(db, portfolioId);
  return Response.json({ plan: latest });
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
  const parsed = BuildCagrPlanBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const { plan } = runCagrPlan({
    db,
    portfolioId,
    targetCagrPct: parsed.data.targetCagrPct,
    horizonYears: parsed.data.horizonYears,
  });

  const stored = insertCagrPlan(db, {
    portfolioId,
    targetCagrPct: parsed.data.targetCagrPct,
    horizonYears: parsed.data.horizonYears,
    currentForecastCagr: plan.currentPortfolioForecastCagr,
    proposedForecastCagr: plan.proposedPortfolioForecastCagr,
    plan: plan as unknown as Record<string, unknown>,
  });

  return Response.json({ plan, stored: { id: stored.id, createdAt: stored.createdAt } });
}
