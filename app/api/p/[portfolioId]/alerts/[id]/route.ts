import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { removeRule, setRuleEnabled } from '@/lib/db/queries/alerts';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { ToggleAlertRuleBody } from '@/lib/validation/alerts';

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
  const parsed = ToggleAlertRuleBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }

  const updated = setRuleEnabled(db, portfolioId, id, parsed.data.enabled);
  if (!updated) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ rule: updated });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = await requireCsrf(req);
  if (csrf) return csrf;

  const { portfolioId, id } = await ctx.params;
  const removed = removeRule(db, portfolioId, id);
  if (!removed) return Response.json({ error: 'not_found' }, { status: 404 });
  return Response.json({ rule: removed });
}
