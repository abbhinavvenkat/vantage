import { getSession } from '@/lib/auth/session';
import { requireCsrf } from '@/lib/auth/csrf';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getThesis, upsertThesis } from '@/lib/db/queries/theses';
import { UpsertThesisBody } from '@/lib/validation/theses';

type Ctx = { params: Promise<{ portfolioId: string; symbol: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const { portfolioId, symbol } = await ctx.params;
  const pf = getPortfolio(db, portfolioId);
  if (!pf || pf.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const sym = decodeURIComponent(symbol).toUpperCase();
  const thesis = getThesis(db, portfolioId, sym);
  return Response.json({ thesis });
}

export async function PUT(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, symbol } = await ctx.params;
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
  const parsed = UpsertThesisBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const sym = decodeURIComponent(symbol).toUpperCase();
  const thesis = upsertThesis(db, portfolioId, sym, {
    thesisMd: parsed.data.thesisMd,
    checklist: parsed.data.checklist,
    entryDate: parsed.data.entryDate ?? null,
    targetReviewDate: parsed.data.targetReviewDate ?? null,
  });
  return Response.json({ thesis });
}
