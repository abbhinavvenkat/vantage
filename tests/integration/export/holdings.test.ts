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

type Holding = {
  symbol: string;
  currency: string;
  buyQty: number;
  sellQty: number;
  netQty: number;
  buyValue: number;
  sellValue: number;
  tradeCount: number;
  firstTradeDate: string;
  lastTradeDate: string;
};

const holdingsMock = {
  computeHoldings: vi.fn((_db: unknown, _pf: string): Holding[] => [
    {
      symbol: 'ACME-EQ',
      currency: 'INR',
      buyQty: 100,
      sellQty: 0,
      netQty: 100,
      buyValue: 10_000,
      sellValue: 0,
      tradeCount: 1,
      firstTradeDate: '2024-01-01',
      lastTradeDate: '2024-01-01',
    },
    {
      symbol: 'WIDGET, INC',
      currency: 'INR',
      buyQty: 50,
      sellQty: 0,
      netQty: 50,
      buyValue: 5_000,
      sellValue: 0,
      tradeCount: 1,
      firstTradeDate: '2024-02-01',
      lastTradeDate: '2024-02-01',
    },
  ]),
};

const pricesMock = {
  getLatestPrices: vi.fn(
    (_db: unknown, _symbols: string[]) =>
      new Map<string, { symbol: string; close: number; date: string }>([
        ['ACME-EQ', { symbol: 'ACME-EQ', close: 110, date: '2024-03-01' }],
      ]),
  ),
};

vi.mock('@/lib/auth/session', () => sessionMock);
vi.mock('@/lib/db/queries/portfolios', () => portfolioMock);
vi.mock('@/lib/db/queries/holdings', () => holdingsMock);
vi.mock('@/lib/db/queries/prices', () => pricesMock);
vi.mock('@/lib/db/client', () => ({ db: {} }));

beforeEach(() => {
  for (const fn of Object.values(sessionMock)) fn.mockClear();
  for (const fn of Object.values(portfolioMock)) fn.mockClear();
  for (const fn of Object.values(holdingsMock)) fn.mockClear();
  for (const fn of Object.values(pricesMock)) fn.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function call(pfId: string) {
  const { GET } = await import('@/app/api/p/[portfolioId]/export/holdings/route');
  const req = new Request(`http://localhost/api/p/${pfId}/export/holdings`);
  return GET(req, { params: Promise.resolve({ portfolioId: pfId }) });
}

describe('GET /api/p/[portfolioId]/export/holdings', () => {
  it('returns 401 when no session', async () => {
    sessionMock.getSession.mockResolvedValueOnce(null);
    const res = await call(portfolioId);
    expect(res.status).toBe(401);
  });

  it('returns 404 when portfolio does not exist', async () => {
    const res = await call('does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns text/csv with attachment disposition', async () => {
    const res = await call(portfolioId);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/csv/);
    const cd = res.headers.get('content-disposition') ?? '';
    expect(cd).toMatch(/^attachment;/);
    expect(cd).toMatch(/holdings_pf-1_\d{4}-\d{2}-\d{2}\.csv/);
  });

  it('round-trips parse with expected columns and values', async () => {
    const res = await call(portfolioId);
    const csv = await res.text();
    const parsed = Papa.parse<string[]>(csv.trimEnd(), { skipEmptyLines: true });
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.data[0]).toEqual([
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
    ]);
    // ACME row: avg_cost=100, invested=10000, last=110, mv=11000, unrealized=1000, pct=10
    const acme = parsed.data[1]!;
    expect(acme[0]).toBe('ACME-EQ');
    expect(acme[1]).toBe('100');
    expect(Number(acme[2])).toBeCloseTo(100, 4);
    expect(Number(acme[3])).toBeCloseTo(10000, 2);
    expect(Number(acme[4])).toBeCloseTo(110, 2);
    expect(Number(acme[5])).toBeCloseTo(11000, 2);
    expect(Number(acme[6])).toBeCloseTo(1000, 2);
    expect(Number(acme[7])).toBeCloseTo(10, 2);
    // WIDGET row has a comma in the symbol — must round-trip through the quoted CSV.
    const widget = parsed.data[2]!;
    expect(widget[0]).toBe('WIDGET, INC');
    expect(widget[4]).toBe(''); // no price → empty `last`
    expect(widget[5]).toBe(''); // no mv
  });
});
