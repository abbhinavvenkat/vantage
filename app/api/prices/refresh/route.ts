import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { upsertPrices } from '@/lib/db/queries/prices';
import { getTradesForPortfolio, type Trade } from '@/lib/db/queries/trades';
import { fetchEodQuotes } from '@/lib/pricing/yahoo';
import { computeOpenPositions } from '@/lib/analytics/fifoHoldings';
import { KNOWN_CORPORATE_ACTIONS } from '@/lib/analytics/knownCorporateActions';
import type { NormalizedTrade } from '@/lib/parsers/types';

const Body = z.object({ portfolioId: z.string().min(1) });

export async function POST(req: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  const csrfHeader = req.headers.get('x-csrf-token');
  if (!csrfHeader || csrfHeader !== session.csrfToken) {
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

  const { portfolioId } = parsed.data;
  const db = getDb();

  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio) return Response.json({ error: 'portfolio_not_found' }, { status: 404 });

  // Derive symbol list from FIFO open positions (post-aliases, post-corp-actions)
  const allTrades = getTradesForPortfolio(db, portfolioId);
  const deliveryTrades = allTrades.filter((t) => t.isIntradayPairId === null);
  const normalized: NormalizedTrade[] = deliveryTrades.map((t: Trade, i) => ({
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
  const positions = computeOpenPositions(normalized, KNOWN_CORPORATE_ACTIONS);
  const symbols = positions.map((p) => p.symbol);

  if (symbols.length === 0) {
    return Response.json({ refreshed: 0, failed: 0, symbols: [] });
  }

  const quotes = await fetchEodQuotes(symbols);

  const fetched = [...quotes.values()];
  upsertPrices(db, fetched);

  const failed = symbols.filter((s) => !quotes.has(s));

  return Response.json({
    refreshed: fetched.length,
    failed: failed.length,
    failedSymbols: failed,
    symbols: fetched.map((q) => ({ symbol: q.symbol, close: q.close, date: q.date })),
  });
}
