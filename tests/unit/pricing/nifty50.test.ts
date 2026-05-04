import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const requestMock = vi.fn();

vi.mock('undici', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

beforeEach(() => {
  requestMock.mockReset();
});

afterEach(() => {
  vi.resetModules();
});

describe('fetchNifty50Close', () => {
  it('hits the Yahoo chart endpoint with the ^NSEI symbol (URL-encoded)', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({
          chart: {
            result: [
              {
                meta: { symbol: '^NSEI', regularMarketPrice: 22000, regularMarketTime: 1700000000 },
                timestamp: [1700000000],
                indicators: {
                  quote: [
                    { close: [22000], open: [21900], high: [22100], low: [21800], volume: [0] },
                  ],
                  adjclose: [{ adjclose: [22000] }],
                },
              },
            ],
            error: null,
          },
        }),
      },
    });

    const { fetchNifty50Close } = await import('@/lib/pricing/nifty50');
    const close = await fetchNifty50Close('2024-01-15');
    expect(close).toBeCloseTo(22000);

    // Assert URL shape: encoded ^NSEI → %5ENSEI, hits query1.finance.yahoo.com chart.
    expect(requestMock).toHaveBeenCalledOnce();
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('query1.finance.yahoo.com');
    expect(url).toContain('/v8/finance/chart/');
    expect(url).toContain('%5ENSEI');
  });

  it('returns null when Yahoo returns a non-200', async () => {
    requestMock.mockResolvedValue({ statusCode: 500, body: { json: async () => ({}) } });
    const { fetchNifty50Close } = await import('@/lib/pricing/nifty50');
    expect(await fetchNifty50Close('2024-01-15')).toBeNull();
  });
});

describe('fetchNifty50Series', () => {
  it('returns a date→close map for a date range', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({
          chart: {
            result: [
              {
                meta: { symbol: '^NSEI' },
                // Three weekday closes
                timestamp: [
                  Math.floor(new Date('2024-01-15T09:30:00Z').getTime() / 1000),
                  Math.floor(new Date('2024-01-16T09:30:00Z').getTime() / 1000),
                  Math.floor(new Date('2024-01-17T09:30:00Z').getTime() / 1000),
                ],
                indicators: {
                  quote: [
                    {
                      close: [21900, 22000, 22100],
                      open: [null, null, null],
                      high: [null, null, null],
                      low: [null, null, null],
                      volume: [null, null, null],
                    },
                  ],
                  adjclose: [{ adjclose: [21900, 22000, 22100] }],
                },
              },
            ],
            error: null,
          },
        }),
      },
    });

    const { fetchNifty50Series } = await import('@/lib/pricing/nifty50');
    const series = await fetchNifty50Series('2024-01-15', '2024-01-17');
    expect(series.size).toBe(3);
    expect(series.get('2024-01-15')).toBeCloseTo(21900);
    expect(series.get('2024-01-17')).toBeCloseTo(22100);

    // Single bulk request — not one per day.
    expect(requestMock).toHaveBeenCalledOnce();
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('%5ENSEI');
    expect(url).toContain('period1=');
    expect(url).toContain('period2=');
    expect(url).toContain('interval=1d');
  });
});
