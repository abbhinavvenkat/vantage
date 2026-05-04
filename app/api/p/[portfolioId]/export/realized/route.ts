import { z } from 'zod';

import { getSession } from '@/lib/auth/session';
import { computeFifo } from '@/lib/analytics/fifo';
import { toCsv, type CsvCell } from '@/lib/csv/encode';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import type { NormalizedTrade } from '@/lib/parsers/types';

const ParamsSchema = z.object({ portfolioId: z.string().min(1) });

type Ctx = { params: Promise<{ portfolioId: string }> };

function toNormalized(t: Trade): NormalizedTrade {
  return {
    brokerCode: 'zerodha',
    symbol: t.symbol,
    isin: t.isin ?? undefined,
    tradeDate: t.tradeDate,
    side: t.side as 'buy' | 'sell',
    qty: t.qty,
    price: t.price,
    currency: t.currency as 'INR' | 'USD',
    exchange: t.exchange ?? undefined,
    segment: t.segment ?? undefined,
    series: t.series ?? undefined,
    tradeId: t.tradeId ?? undefined,
    orderId: t.orderId ?? undefined,
    execTime: t.execTime ?? undefined,
    rawRowIdx: t.sourceRowIdx ?? 0,
  };
}

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

  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized = deliveryTrades.map(toNormalized);

  const { realized } = computeFifo(normalized, []);
  const sorted = [...realized].sort((a, b) => b.sellDate.localeCompare(a.sellDate));

  const headers = [
    'symbol',
    'sell_date',
    'qty',
    'buy_price',
    'sell_price',
    'pnl',
    'holding_days',
    'gain_type',
  ];

  const rows: CsvCell[][] = sorted.map((r) => [
    r.symbol,
    r.sellDate,
    r.qty,
    Number(r.buyPrice.toFixed(4)),
    Number(r.sellPrice.toFixed(4)),
    Number(r.pnl.toFixed(2)),
    r.holdingDays,
    r.holdingDays >= 365 ? 'LTCG' : 'STCG',
  ]);

  const csv = toCsv(headers, rows);
  const filename = `realized_${portfolioId}_${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
    },
  });
}
