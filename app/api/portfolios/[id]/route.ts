import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { archivePortfolio, getPortfolio, renamePortfolio } from '@/lib/db/queries/portfolios';

const RenameBody = z.object({
  name: z.string().min(1).max(80),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = RenameBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const portfolio = renamePortfolio(db, id, parsed.data.name);
  if (!portfolio) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ portfolio });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = getPortfolio(db, id);
  if (!existing || existing.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  const portfolio = archivePortfolio(db, id);
  if (!portfolio) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }
  return Response.json({ portfolio });
}
