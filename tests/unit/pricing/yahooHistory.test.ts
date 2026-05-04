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

describe('fetchPriceHistory', () => {
  it('hits the Yahoo chart endpoint with the bare symbol → .NS encoded, period1/period2', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({
          chart: {
            result: [
              {
                meta: { symbol: 'BEL.NS' },
                timestamp: [
                  Math.floor(new Date('2024-01-15T09:30:00Z').getTime() / 1000),
                  Math.floor(new Date('2024-01-16T09:30:00Z').getTime() / 1000),
                  Math.floor(new Date('2024-01-17T09:30:00Z').getTime() / 1000),
                ],
                indicators: {
                  quote: [
                    {
                      close: [101, 102, 103],
                      open: [100, 101, 102],
                      high: [105, 105, 105],
                      low: [99, 100, 101],
                      volume: [1000, 1100, 1200],
                    },
                  ],
                  adjclose: [{ adjclose: [101, 102, 103] }],
                },
              },
            ],
            error: null,
          },
        }),
      },
    });

    const { fetchPriceHistory } = await import('@/lib/pricing/yahooHistory');
    const rows = await fetchPriceHistory('BEL', '2024-01-15', '2024-01-17');

    expect(rows.length).toBe(3);
    expect(rows[0]!.symbol).toBe('BEL');
    expect(rows[0]!.yahooSymbol).toBe('BEL.NS');
    expect(rows[0]!.date).toBe('2024-01-15');
    expect(rows[0]!.close).toBeCloseTo(101);
    expect(rows[2]!.close).toBeCloseTo(103);

    expect(requestMock).toHaveBeenCalledOnce();
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('query1.finance.yahoo.com');
    expect(url).toContain('/v8/finance/chart/');
    expect(url).toContain('BEL.NS');
    expect(url).toContain('period1=');
    expect(url).toContain('period2=');
    expect(url).toContain('interval=1d');
  });

  it('skips bars with null close', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({
          chart: {
            result: [
              {
                meta: { symbol: 'X.NS' },
                timestamp: [
                  Math.floor(new Date('2024-01-15T09:30:00Z').getTime() / 1000),
                  Math.floor(new Date('2024-01-16T09:30:00Z').getTime() / 1000),
                ],
                indicators: {
                  quote: [
                    {
                      close: [null, 100],
                      open: [null, null],
                      high: [null, null],
                      low: [null, null],
                      volume: [null, null],
                    },
                  ],
                  adjclose: [{ adjclose: [null, 100] }],
                },
              },
            ],
            error: null,
          },
        }),
      },
    });

    const { fetchPriceHistory } = await import('@/lib/pricing/yahooHistory');
    const rows = await fetchPriceHistory('X', '2024-01-15', '2024-01-16');
    expect(rows.length).toBe(1);
    expect(rows[0]!.date).toBe('2024-01-16');
  });

  it('returns empty on non-200', async () => {
    requestMock.mockResolvedValue({ statusCode: 500, body: { json: async () => ({}) } });
    const { fetchPriceHistory } = await import('@/lib/pricing/yahooHistory');
    const rows = await fetchPriceHistory('X', '2024-01-15', '2024-01-16');
    expect(rows).toEqual([]);
  });

  it('URL-encodes symbols containing & (e.g. ARE&M.NS)', async () => {
    requestMock.mockResolvedValue({
      statusCode: 200,
      body: {
        json: async () => ({
          chart: {
            result: [
              {
                meta: { symbol: 'ARE&M.NS' },
                timestamp: [Math.floor(new Date('2024-01-15T09:30:00Z').getTime() / 1000)],
                indicators: {
                  quote: [{ close: [100], open: [99], high: [101], low: [98], volume: [1] }],
                  adjclose: [{ adjclose: [100] }],
                },
              },
            ],
            error: null,
          },
        }),
      },
    });
    const { fetchPriceHistory } = await import('@/lib/pricing/yahooHistory');
    await fetchPriceHistory('ARE&M', '2024-01-15', '2024-01-15');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('ARE%26M.NS');
  });
});
