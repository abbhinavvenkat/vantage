import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the auth + db modules so the route handlers can be exercised in isolation.
// The real implementations are owned by the auth + db agents; this test verifies
// the route-handler shape (validation, status codes, query invocation) is correct.

const userId = 'user-1';

const sessionMock = {
  getSession: vi.fn<() => Promise<{ userId: string; csrfToken: string } | null>>(async () => ({
    userId,
    csrfToken: 'test-csrf',
  })),
};

type Portfolio = {
  id: string;
  name: string;
  baseCurrency: string;
  createdAt: number;
  archivedAt: number | null;
};

const store = new Map<string, Portfolio>();

const queriesMock = {
  listPortfolios: vi.fn((_db: unknown) =>
    Array.from(store.values()).filter((p) => p.archivedAt === null),
  ),
  getPortfolio: vi.fn((_db: unknown, id: string) => store.get(id) ?? null),
  createPortfolio: vi.fn((_db: unknown, input: { name: string; baseCurrency?: string }) => {
    const id = `pf_${store.size + 1}`;
    const row: Portfolio = {
      id,
      name: input.name,
      baseCurrency: input.baseCurrency ?? 'INR',
      createdAt: Date.now(),
      archivedAt: null,
    };
    store.set(id, row);
    return row;
  }),
  renamePortfolio: vi.fn((_db: unknown, id: string, name: string) => {
    const row = store.get(id);
    if (!row) return null;
    row.name = name;
    return row;
  }),
  archivePortfolio: vi.fn((_db: unknown, id: string) => {
    const row = store.get(id);
    if (!row) return null;
    row.archivedAt = Date.now();
    return row;
  }),
};

vi.mock('@/lib/auth/session', () => sessionMock);
vi.mock('@/lib/db/queries/portfolios', () => queriesMock);
vi.mock('@/lib/db/client', () => ({ db: {} }));

beforeEach(() => {
  store.clear();
  sessionMock.getSession.mockClear();
  for (const fn of Object.values(queriesMock)) fn.mockClear();
  sessionMock.getSession.mockImplementation(async () => ({ userId, csrfToken: 'test-csrf' }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('/api/portfolios route', () => {
  it('POST creates a portfolio with zod-validated body', async () => {
    const { POST } = await import('@/app/api/portfolios/route');
    const req = new Request('http://localhost/api/portfolios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main', baseCurrency: 'INR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.portfolio.name).toBe('Main');
    expect(queriesMock.createPortfolio).toHaveBeenCalledOnce();
  });

  it('POST rejects an invalid body with 400', async () => {
    const { POST } = await import('@/app/api/portfolios/route');
    const req = new Request('http://localhost/api/portfolios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('POST returns 401 when no session', async () => {
    sessionMock.getSession.mockImplementationOnce(async () => null);
    const { POST } = await import('@/app/api/portfolios/route');
    const req = new Request('http://localhost/api/portfolios', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Main', baseCurrency: 'INR' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('GET lists portfolios for the user', async () => {
    queriesMock.createPortfolio({}, { name: 'Main', baseCurrency: 'INR' });
    queriesMock.createPortfolio({}, { name: 'Family', baseCurrency: 'INR' });
    const { GET } = await import('@/app/api/portfolios/route');
    const res = await GET(new Request('http://localhost/api/portfolios'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.portfolios).toHaveLength(2);
  });
});

describe('/api/portfolios/[id] route', () => {
  it('PATCH renames a portfolio', async () => {
    const created = queriesMock.createPortfolio({}, { name: 'Main', baseCurrency: 'INR' });
    const { PATCH } = await import('@/app/api/portfolios/[id]/route');
    const req = new Request(`http://localhost/api/portfolios/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Renamed' }),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.portfolio.name).toBe('Renamed');
  });

  it('PATCH 400 on invalid body', async () => {
    const created = queriesMock.createPortfolio({}, { name: 'Main', baseCurrency: 'INR' });
    const { PATCH } = await import('@/app/api/portfolios/[id]/route');
    const req = new Request(`http://localhost/api/portfolios/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    const res = await PATCH(req, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(400);
  });

  it('DELETE archives a portfolio', async () => {
    const created = queriesMock.createPortfolio({}, { name: 'Main', baseCurrency: 'INR' });
    const { DELETE } = await import('@/app/api/portfolios/[id]/route');
    const req = new Request(`http://localhost/api/portfolios/${created.id}`, {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: created.id }) });
    expect(res.status).toBe(200);
    expect(queriesMock.archivePortfolio).toHaveBeenCalledWith({}, created.id);
  });

  it('DELETE 404 when portfolio not found', async () => {
    const { DELETE } = await import('@/app/api/portfolios/[id]/route');
    const req = new Request('http://localhost/api/portfolios/nope', {
      method: 'DELETE',
    });
    const res = await DELETE(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
