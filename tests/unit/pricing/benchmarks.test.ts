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

function ok200(closes: (number | null)[], timestamps: number[]) {
  return {
    statusCode: 200,
    body: {
      json: async () => ({
        chart: {
          result: [
            {
              meta: { symbol: 'X', regularMarketPrice: 100 },
              timestamp: timestamps,
              indicators: {
                quote: [{ close: closes }],
                adjclose: [{ adjclose: closes }],
              },
            },
          ],
          error: null,
        },
      }),
    },
  };
}

describe('BENCHMARKS registry', () => {
  it('registers exactly the 3 expected benchmarks with the verified Yahoo tickers', async () => {
    const { BENCHMARKS } = await import('@/lib/pricing/benchmarks');
    expect(BENCHMARKS.map((b) => b.id)).toEqual(['nifty50', 'largemid250', 'bse500']);
    expect(BENCHMARKS.find((b) => b.id === 'nifty50')!.yahooSymbol).toBe('^NSEI');
    expect(BENCHMARKS.find((b) => b.id === 'largemid250')!.yahooSymbol).toBe('^CRSLDX');
    expect(BENCHMARKS.find((b) => b.id === 'bse500')!.yahooSymbol).toBe('BSE-500.BO');
  });
});

describe('fetchBenchmarkClose', () => {
  it('encodes ^NSEI as %5ENSEI for nifty50', async () => {
    requestMock.mockResolvedValue(ok200([22000], [1700000000]));
    const { fetchBenchmarkClose } = await import('@/lib/pricing/benchmarks');
    const close = await fetchBenchmarkClose('nifty50', '2024-01-15');
    expect(close).toBeCloseTo(22000);
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('query1.finance.yahoo.com');
    expect(url).toContain('/v8/finance/chart/');
    expect(url).toContain('%5ENSEI');
  });

  it('encodes ^CRSLDX as %5ECRSLDX for largemid250', async () => {
    requestMock.mockResolvedValue(ok200([21000], [1700000000]));
    const { fetchBenchmarkClose } = await import('@/lib/pricing/benchmarks');
    await fetchBenchmarkClose('largemid250', '2024-01-15');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('%5ECRSLDX');
  });

  it('encodes BSE-500.BO with literal hyphen+dot for bse500', async () => {
    requestMock.mockResolvedValue(ok200([35000], [1700000000]));
    const { fetchBenchmarkClose } = await import('@/lib/pricing/benchmarks');
    await fetchBenchmarkClose('bse500', '2024-01-15');
    const url = requestMock.mock.calls[0]![0] as string;
    // encodeURIComponent leaves '-' and '.' untouched
    expect(url).toContain('/v8/finance/chart/BSE-500.BO');
  });

  it('returns null on non-200', async () => {
    requestMock.mockResolvedValue({ statusCode: 500, body: { json: async () => ({}) } });
    const { fetchBenchmarkClose } = await import('@/lib/pricing/benchmarks');
    expect(await fetchBenchmarkClose('nifty50', '2024-01-15')).toBeNull();
  });
});

describe('fetchBenchmarkSeries', () => {
  it('returns a date→close map for nifty50 over a date range with one bulk call', async () => {
    const ts = [
      Math.floor(new Date('2024-01-15T09:30:00Z').getTime() / 1000),
      Math.floor(new Date('2024-01-16T09:30:00Z').getTime() / 1000),
      Math.floor(new Date('2024-01-17T09:30:00Z').getTime() / 1000),
    ];
    requestMock.mockResolvedValue(ok200([21900, 22000, 22100], ts));
    const { fetchBenchmarkSeries } = await import('@/lib/pricing/benchmarks');
    const series = await fetchBenchmarkSeries('nifty50', '2024-01-15', '2024-01-17');
    expect(series.size).toBe(3);
    expect(series.get('2024-01-15')).toBeCloseTo(21900);
    expect(series.get('2024-01-17')).toBeCloseTo(22100);
    expect(requestMock).toHaveBeenCalledOnce();
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('%5ENSEI');
    expect(url).toContain('interval=1d');
  });

  it('uses ^CRSLDX in the URL for largemid250', async () => {
    requestMock.mockResolvedValue(ok200([], []));
    const { fetchBenchmarkSeries } = await import('@/lib/pricing/benchmarks');
    await fetchBenchmarkSeries('largemid250', '2024-01-15', '2024-01-17');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('%5ECRSLDX');
  });

  it('uses BSE-500.BO in the URL for bse500', async () => {
    requestMock.mockResolvedValue(ok200([], []));
    const { fetchBenchmarkSeries } = await import('@/lib/pricing/benchmarks');
    await fetchBenchmarkSeries('bse500', '2024-01-15', '2024-01-17');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('/v8/finance/chart/BSE-500.BO');
  });
});
