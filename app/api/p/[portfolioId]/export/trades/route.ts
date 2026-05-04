import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { toCsv, type CsvCell } from '@/lib/csv/encode';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getTradesWithBrokerForPortfolio } from '@/lib/db/queries/trades';

const ParamsSchema = z.object({ portfolioId: z.string().min(1) });

type Ctx = { params: Promise<{ portfolioId: string }> };

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parsed = ParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return Response.json({ error: 'invalid_params' }, { status: 400 });
  }
  const { portfolioId } = parsed.data;

  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio || portfolio.archivedAt !== null) {
    return Response.json({ error: 'not_found' }, { status: 404 });
  }

  const trades = getTradesWithBrokerForPortfolio(db, portfolioId);

  const headers = [
    'date',
    'exec_time',
    'symbol',
    'side',
    'qty',
    'price',
    'currency',
    'exchange',
    'broker',
    'trade_id',
  ];

  const rows: CsvCell[][] = trades.map((t) => [
    t.tradeDate,
    t.execTime,
    t.symbol,
    t.side,
    t.qty,
    t.price,
    t.currency,
    t.exchange,
    t.brokerCode,
    t.tradeId,
  ]);

  const csv = toCsv(headers, rows);
  const filename = `trades_${portfolioId}_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
