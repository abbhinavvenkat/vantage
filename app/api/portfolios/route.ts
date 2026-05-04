import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { createPortfolio, listPortfolios } from '@/lib/db/queries/portfolios';

const CreateBody = z.object({
  name: z.string().min(1).max(80),
  baseCurrency: z.string().min(3).max(3).optional(),
});

export async function GET(_req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const portfolios = listPortfolios(db);
  return Response.json({ portfolios });
}

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 });
  }
  const portfolio = createPortfolio(db, {
    name: parsed.data.name,
    baseCurrency: parsed.data.baseCurrency,
  });
  return Response.json({ portfolio }, { status: 201 });
}
