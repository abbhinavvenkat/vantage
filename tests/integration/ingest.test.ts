import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SAMPLE_FIXTURE_PATH,
  SYNTHETIC_TRADES,
  ensureZerodhaFixture,
} from '@/tests/fixtures/zerodhaSample';

// ── mocks ────────────────────────────────────────────────────────────────────

const userId = 'user-1';
const portfolioId = 'pf-1';
const accountId = 'acc-1';

const sessionMock = {
  getSession: vi.fn<() => Promise<{ userId: string; csrfToken: string } | null>>(async () => ({
    userId,
    csrfToken: 'test-csrf',
  })),
};

type InsertResult = { inserted: number; skipped: number };
const insertedBatches: { accountId: string; count: number }[] = [];
let insertResult: InsertResult = { inserted: SYNTHETIC_TRADES.length, skipped: 0 };

const tradesMock = {
  insertTrades: vi.fn((_db: unknown, acctId: string, rows: unknown[]) => {
    insertedBatches.push({ accountId: acctId, count: rows.length });
    return insertResult;
  }),
};

const portfolioMock = {
  getPortfolio: vi.fn((_db: unknown, id: string) =>
    id === portfolioId ? { id, name: 'Primary', baseCurrency: 'INR' } : null,
  ),
};

const accountsMock = {
  getOrCreateAccount: vi.fn(
    async (_db: unknown, _portfolioId: string, _brokerCode: string, _alias: string) => ({
      id: accountId,
    }),
  ),
};

vi.mock('@/lib/auth/session', () => sessionMock);
vi.mock('@/lib/db/queries/trades', () => tradesMock);
vi.mock('@/lib/db/queries/portfolios', () => portfolioMock);
vi.mock('@/lib/db/queries/accounts', () => accountsMock);
vi.mock('@/lib/db/client', () => ({
  getDb: () => ({}),
}));

// ── test setup ────────────────────────────────────────────────────────────────

beforeEach(() => {
  insertedBatches.length = 0;
  insertResult = { inserted: SYNTHETIC_TRADES.length, skipped: 0 };
  tradesMock.insertTrades.mockClear();
  sessionMock.getSession.mockClear();
  accountsMock.getOrCreateAccount.mockClear();
  ensureZerodhaFixture(SAMPLE_FIXTURE_PATH);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function makeIngestRequest(
  portfolioIdParam: string,
  fileBytes: Buffer,
  filename: string,
  csrfToken = 'test-csrf',
) {
  const { POST } = await import('@/app/api/ingest/route');

  const form = new FormData();
  form.append('portfolioId', portfolioIdParam);
  form.append(
    'file',
    new Blob([new Uint8Array(fileBytes)], { type: 'application/vnd.ms-excel' }),
    filename,
  );

  const req = new Request('http://localhost/api/ingest', {
    method: 'POST',
    headers: { 'x-csrf-token': csrfToken },
    body: form,
  });

  return POST(req);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('POST /api/ingest', () => {
  it('returns 401 when no session', async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
    const res = await makeIngestRequest(portfolioId, bytes, 'tradebook.xlsx');
    expect(res.status).toBe(401);
  });

  it('returns 403 on CSRF mismatch', async () => {
    const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
    const res = await makeIngestRequest(portfolioId, bytes, 'tradebook.xlsx', 'wrong-token');
    expect(res.status).toBe(403);
  });

  it('returns 400 when portfolioId is missing', async () => {
    const { POST } = await import('@/app/api/ingest/route');
    const form = new FormData();
    form.append('file', new Blob([Buffer.from('x')]), 'x.xlsx');
    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { 'x-csrf-token': 'test-csrf' },
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when no file is attached', async () => {
    const { POST } = await import('@/app/api/ingest/route');
    const form = new FormData();
    form.append('portfolioId', portfolioId);
    const req = new Request('http://localhost/api/ingest', {
      method: 'POST',
      headers: { 'x-csrf-token': 'test-csrf' },
      body: form,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when portfolio does not belong to user', async () => {
    const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
    const res = await makeIngestRequest('other-portfolio', bytes, 'tradebook.xlsx');
    expect(res.status).toBe(404);
  });

  it('returns 422 when file format is not recognized', async () => {
    const csv = Buffer.from('garbage,columns\nno,header\n');
    const res = await makeIngestRequest(portfolioId, csv, 'unknown.csv');
    expect(res.status).toBe(422);
  });

  it('ingests the synthetic Zerodha fixture and returns 200 with counts', async () => {
    const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
    const res = await makeIngestRequest(portfolioId, bytes, 'tradebook-UL1234-EQ.xlsx');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(SYNTHETIC_TRADES.length);
    expect(body.skipped).toBe(0);
    expect(body.broker).toBe('zerodha');
  });

  it('is idempotent — re-upload returns skipped = total, inserted = 0', async () => {
    insertResult = { inserted: 0, skipped: SYNTHETIC_TRADES.length };
    const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
    const res = await makeIngestRequest(portfolioId, bytes, 'tradebook-UL1234-EQ.xlsx');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(0);
    expect(body.skipped).toBe(SYNTHETIC_TRADES.length);
  });
});
