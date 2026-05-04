import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { toCsv, type CsvCell } from '@/lib/csv/encode';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getLatestPrices } from '@/lib/db/queries/prices';

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

  const rawHoldings = computeHoldings(db, portfolioId);
  const open = rawHoldings.filter((h) => h.netQty > 0);
  const symbols = open.map((h) => h.symbol);
  const prices = getLatestPrices(db, symbols);

  const headers = [
    'symbol',
    'qty',
    'avg_cost',
    'invested',
    'last',
    'mv',
    'unrealized',
    'unrealized_pct',
    'price_date',
    'first_buy',
  ];

  const rows: CsvCell[][] = open.map((h) => {
    const avgCost = h.buyQty > 0 ? h.buyValue / h.buyQty : 0;
    const invested = avgCost * h.netQty;
    const p = prices.get(h.symbol);
    const last = p?.close ?? null;
    const mv = last != null ? last * h.netQty : null;
    const unrealized = mv != null ? mv - invested : null;
    const unrealizedPct = unrealized != null && invested > 0 ? (unrealized / invested) * 100 : null;
    return [
      h.symbol,
      h.netQty,
      Number(avgCost.toFixed(4)),
      Number(invested.toFixed(2)),
      last,
      mv != null ? Number(mv.toFixed(2)) : null,
      unrealized != null ? Number(unrealized.toFixed(2)) : null,
      unrealizedPct != null ? Number(unrealizedPct.toFixed(4)) : null,
      p?.date ?? null,
      h.firstTradeDate,
    ];
  });

  const csv = toCsv(headers, rows);
  const filename = `holdings_${portfolioId}_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
