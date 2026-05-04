import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { generateMonthlySnapshotPdf } from '@/lib/pdf/monthlySnapshot';
import { todayIso } from '@/lib/pdf/format';

const ParamsSchema = z.object({ portfolioId: z.string().min(1) });
const QuerySchema = z.object({
  asOf: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'asOf must be YYYY-MM-DD')
    .optional(),
});

type Ctx = { params: Promise<{ portfolioId: string }> };

function safeFilename(name: string): string {
  // ASCII-only; conservative for HTTP filename.
  return name.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64) || 'portfolio';
}

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsedParams = ParamsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) {
    return Response.json({ error: 'invalid_params' }, { status: 400 });
  }
  const { portfolioId } = parsedParams.data;

  const url = new URL(req.url);
  const parsedQuery = QuerySchema.safeParse({ asOf: url.searchParams.get('asOf') ?? undefined });
  if (!parsedQuery.success) {
    return Response.json({ error: 'invalid_query' }, { status: 400 });
  }
  const asOf = parsedQuery.data.asOf ?? todayIso();

  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio || portfolio.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  let pdf: Buffer;
  try {
    pdf = await generateMonthlySnapshotPdf(db, portfolioId, asOf);
  } catch (err) {
    return Response.json(
      { error: 'generation_failed', detail: (err as Error).message },
      { status: 500 },
    );
  }

  const filename = `snapshot-${safeFilename(portfolio.name)}-${asOf}.pdf`;

  // Copy into a fresh ArrayBuffer-backed Uint8Array so the body conforms to BodyInit.
  const ab = new ArrayBuffer(pdf.byteLength);
  new Uint8Array(ab).set(pdf);

  return new Response(ab, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'content-length': pdf.byteLength.toString(),
      'cache-control': 'no-store',
    },
  });
}
