import { createHash } from 'node:crypto';
import { getSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db/client';
import { getOrCreateAccount } from '@/lib/db/queries/accounts';
import { getPortfolio } from '@/lib/db/queries/portfolios';
import { insertTrades } from '@/lib/db/queries/trades';
import { detectParser } from '@/lib/parsers/registry';

export async function POST(req: Request): Promise<Response> {
  // Auth
  const session = await getSession();
  if (!session) return Response.json({ error: 'unauthorized' }, { status: 401 });

  // CSRF
  const csrfHeader = req.headers.get('x-csrf-token');
  if (!csrfHeader || csrfHeader !== session.csrfToken) {
    return Response.json({ error: 'invalid_csrf' }, { status: 403 });
  }

  // Parse multipart body
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'invalid_form_data' }, { status: 400 });
  }

  const portfolioId = form.get('portfolioId');
  if (typeof portfolioId !== 'string' || !portfolioId) {
    return Response.json({ error: 'portfolioId_required' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof Blob)) {
    return Response.json({ error: 'file_required' }, { status: 400 });
  }

  // Verify portfolio exists
  const db = getDb();
  const portfolio = getPortfolio(db, portfolioId);
  if (!portfolio) {
    return Response.json({ error: 'portfolio_not_found' }, { status: 404 });
  }

  // Read file bytes
  const bytes = Buffer.from(await file.arrayBuffer());
  const filename = file instanceof File ? file.name : 'upload';
  const sourceFileHash = createHash('sha256').update(bytes).digest('hex');

  // Detect parser
  const parser = detectParser({ name: filename, bytes });
  if (!parser) {
    return Response.json({ error: 'unrecognized_file_format' }, { status: 422 });
  }

  // Parse trades
  let normalized: ReturnType<typeof parser.parse>;
  try {
    normalized = parser.parse({ name: filename, bytes });
  } catch (err) {
    return Response.json({ error: 'parse_error', detail: String(err) }, { status: 422 });
  }

  // Get or create the account for this broker + portfolio
  const account = getOrCreateAccount(db, portfolioId, parser.code, parser.code);

  // Map NormalizedTrade → NormalizedTradeInput, attaching file provenance
  const rows = normalized.map((t, i) => ({
    symbol: t.symbol,
    isin: t.isin ?? null,
    tradeDate: t.tradeDate,
    side: t.side,
    qty: t.qty,
    price: t.price,
    currency: t.currency,
    exchange: t.exchange ?? null,
    segment: t.segment ?? null,
    series: t.series ?? null,
    tradeId: t.tradeId ?? null,
    orderId: t.orderId ?? null,
    execTime: t.execTime ?? null,
    sourceFileHash,
    sourceRowIdx: t.rawRowIdx,
  }));

  const result = insertTrades(db, account.id, rows);

  return Response.json({
    broker: parser.code,
    parsed: normalized.length,
    inserted: result.inserted,
    skipped: result.skipped,
  });
}
