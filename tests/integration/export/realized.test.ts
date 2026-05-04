import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';

const portfolioId = 'pf-1';

const sessionMock = {
  getSession: vi.fn<() => Promise<{ userId: string; csrfToken: string } | null>>(async () => ({
    userId: 'user-1',
    csrfToken: 'csrf',
  })),
};

const portfolioMock = {
  getPortfolio: vi.fn((_db: unknown, id: string) =>
    id === portfolioId
      ? { id, name: 'Main', baseCurrency: 'INR', createdAt: 0, archivedAt: null }
      : null,
  ),
};

// Two buys + one sell that closes against the FIFO-first lot. Expected realized:
//   ACME-EQ qty 50 @ buy 100 → sell 130 on 2025-06-01, pnl = 1500, holdingDays = 365 (LTCG)
const fakeTrades = [
  {
    id: 't1',
    accountId: 'a',
    symbol: 'ACME-EQ',
    isin: null,
    tradeDate: '2024-06-01',
    side: 'buy',
    qty: 50,
    price: 100,
    currency: 'INR',
    exchange: 'NSE',
    segment: 'EQ',
    series: 'EQ',
    tradeId: 'T1',
    orderId: 'O1',
    execTime: '2024-06-01T10:00:00Z',
    sourceFileHash: null,
    sourceRowIdx: 0,
    isIntradayPairId: null,
    createdAt: 0,
  },
  {
    id: 't2',
    accountId: 'a',
    symbol: 'ACME-EQ',
    isin: null,
    tradeDate: '2025-06-01',
    side: 'sell',
    qty: 50,
    price: 130,
    currency: 'INR',
    exchange: 'NSE',
    segment: 'EQ',
    series: 'EQ',
    tradeId: 'T2',
    orderId: 'O2',
    execTime: '2025-06-01T10:00:00Z',
    sourceFileHash: null,
    sourceRowIdx: 1,
    isIntradayPairId: null,
    createdAt: 0,
  },
];

const tradesMock = {
  getTradesForPortfolio: vi.fn((_db: unknown, _pf: string) => fakeTrades),
};

vi.mock('@/lib/auth/session', () => sessionMock);
vi.mock('@/lib/db/queries/portfolios', () => portfolioMock);
vi.mock('@/lib/db/queries/trades', () => tradesMock);
vi.mock('@/lib/db/client', () => ({ db: {} }));

beforeEach(() => {
  sessionMock.getSession.mockClear();
  for (const fn of Object.values(portfolioMock)) fn.mockClear();
  for (const fn of Object.values(tradesMock)) fn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function call(pfId: string) {
  const { GET } = await import('@/app/api/p/[portfolioId]/export/realized/route');
  const req = new Request(`http://localhost/api/p/${pfId}/export/realized`);
  return GET(req, { params: Promise.resolve({ portfolioId: pfId }) });
}

describe('GET /api/p/[portfolioId]/export/realized', () => {
  it('returns 401 when no session', async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    const res = await call(portfolioId);
    expect(res.status).toBe(401);
  });

  it('returns 404 when portfolio missing', async () => {
    const res = await call('nope');
    expect(res.status).toBe(404);
  });

  it('returns CSV with FIFO-realized rows', async () => {
    const res = await call(portfolioId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/^attachment;/);
    expect(cd).toMatch(/realized_pf-1_\d{4}-\d{2}-\d{2}\.csv/);

    const csv = await res.text();
    const parsed = Papa.parse<string[]>(csv.trimEnd(), { skipEmptyLines: true });
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.data[0]).toEqual([
      'symbol',
      'sell_date',
      'qty',
      'buy_price',
      'sell_price',
      'pnl',
      'holding_days',
      'gain_type',
    ]);
    expect(parsed.data).toHaveLength(2);
    const row = parsed.data[1]!;
    expect(row[0]).toBe('ACME-EQ');
    expect(row[1]).toBe('2025-06-01');
    expect(row[2]).toBe('50');
    expect(Number(row[3])).toBeCloseTo(100, 2);
    expect(Number(row[4])).toBeCloseTo(130, 2);
    expect(Number(row[5])).toBeCloseTo(1500, 2);
    expect(row[7]).toBe('LTCG');
  });
});
