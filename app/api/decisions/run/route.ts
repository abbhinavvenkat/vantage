import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { loadLatestRuleLibrary } from '@/lib/codex/library';
import { getDb } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { runDecisions } from '@/lib/decisions/run';

const Body = z.object({ portfolioId: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrf = req.headers.get('x-csrf-token');
  if (!csrf || csrf !== session.csrfToken) {
    return Response.json({ error: 'invalid_csrf' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: 'validation_error', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const db = getDb();
  const p = getPortfolio(db, parsed.data.portfolioId);
  if (!p) return Response.json({ error: 'portfolio_not_found' }, { status: 404 });

  const lib = loadLatestRuleLibrary();
  if (!lib) {
    return Response.json(
      { error: 'no_rule_library', detail: 'data/codex/synthesized/v*.json missing' },
      { status: 409 },
    );
  }

  const result = runDecisions(db, parsed.data.portfolioId, lib);
  return Response.json({
    ok: true,
    inserted: result.inserted,
    ruleLibraryVersion: result.ruleLibraryVersion,
    perSymbol: result.perSymbol,
  });
}
