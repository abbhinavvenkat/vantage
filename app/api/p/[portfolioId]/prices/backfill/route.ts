import { requireCsrf } from '@/lib/auth/csrf';
import { getSession } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';
import { backfillPriceHistory } from '@/lib/pricing/backfill';
import type { NormalizedTrade } from '@/lib/parsers/types';

type Ctx = { params: Promise<{ portfolioId: string }> };

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

  const trades = getTradesForPortfolio(db, portfolioId);
  if (trades.length === 0) {
    return Response.json({ symbols: [], results: [] });
  }

  const normalized: NormalizedTrade[] = trades
    .filter((t) => t.isIntradayPairId === null)
    .map((t: Trade, i) => ({
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
      rawRowIdx: t.sourceRowIdx ?? i,
    }));
  const aliased = applySymbolAliases(normalized);
  const symbolSet = new Set<string>();
  for (const t of aliased) symbolSet.add(t.symbol);
  const symbols = [...symbolSet].sort();

  const startDate = trades.reduce(
    (min, t) => (t.tradeDate < min ? t.tradeDate : min),
    trades[0]!.tradeDate,
  );
  const endDate = new Date().toISOString().slice(0, 10);

  const results = await backfillPriceHistory(db, symbols, startDate, endDate);

  const summary = {
    fetched: results.filter((r) => r.status === 'fetched').length,
    cached: results.filter((r) => r.status === 'cache_hit').length,
    errored: results.filter((r) => r.status === 'fetch_error').length,
    totalRows: results.reduce((s, r) => s + r.fetched, 0),
  };

  return Response.json({ symbols, results, summary });
}
