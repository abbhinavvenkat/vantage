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

function ok200(data: { date: string; nav: string }[]) {
  return {
    statusCode: 200,
    body: {
      json: async () => ({
        meta: {
          fund_house: 'Test',
          scheme_type: 'Open Ended Schemes',
          scheme_category: 'Equity Scheme - Flexi Cap Fund',
          scheme_code: 999999,
          scheme_name: 'Test Fund - Direct Plan - Growth',
        },
        data,
        status: 'SUCCESS',
      }),
    },
  };
}

describe('MF_BENCHMARKS registry', () => {
  it('registers exactly the 4 expected MF benchmarks with verified scheme codes', async () => {
    const { MF_BENCHMARKS } = await import('@/lib/pricing/mfBenchmarks');
    expect(MF_BENCHMARKS.map((b) => b.id)).toEqual([
      'parag-parikh-flexi',
      'kotak-large-mid',
      'axis-flexi',
      'invesco-contra',
    ]);
    expect(MF_BENCHMARKS.find((b) => b.id === 'parag-parikh-flexi')!.schemeCode).toBe(122639);
    expect(MF_BENCHMARKS.find((b) => b.id === 'kotak-large-mid')!.schemeCode).toBe(120158);
    expect(MF_BENCHMARKS.find((b) => b.id === 'axis-flexi')!.schemeCode).toBe(141925);
    expect(MF_BENCHMARKS.find((b) => b.id === 'invesco-contra')!.schemeCode).toBe(120348);
  });

  it('every entry has a unique fileName under data/prices/', async () => {
    const { MF_BENCHMARKS } = await import('@/lib/pricing/mfBenchmarks');
    const names = MF_BENCHMARKS.map((b) => b.fileName);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^mf-.*\.json$/);
  });
});

describe('fetchMfNavSeries', () => {
  it('hits api.mfapi.in with the scheme code and converts DD-MM-YYYY → YYYY-MM-DD', async () => {
    requestMock.mockResolvedValue(
      ok200([
        { date: '17-01-2024', nav: '70.50' },
        { date: '16-01-2024', nav: '70.20' },
        { date: '15-01-2024', nav: '69.80' },
      ]),
    );
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    const series = await fetchMfNavSeries('parag-parikh-flexi');
    expect(series.size).toBe(3);
    expect(series.get('2024-01-15')).toBeCloseTo(69.8);
    expect(series.get('2024-01-16')).toBeCloseTo(70.2);
    expect(series.get('2024-01-17')).toBeCloseTo(70.5);
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('api.mfapi.in/mf/122639');
  });

  it('uses the kotak-large-mid scheme code 120158', async () => {
    requestMock.mockResolvedValue(ok200([]));
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    await fetchMfNavSeries('kotak-large-mid');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('api.mfapi.in/mf/120158');
  });

  it('uses the axis-flexi scheme code 141925', async () => {
    requestMock.mockResolvedValue(ok200([]));
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    await fetchMfNavSeries('axis-flexi');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('api.mfapi.in/mf/141925');
  });

  it('uses the invesco-contra scheme code 120348', async () => {
    requestMock.mockResolvedValue(ok200([]));
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    await fetchMfNavSeries('invesco-contra');
    const url = requestMock.mock.calls[0]![0] as string;
    expect(url).toContain('api.mfapi.in/mf/120348');
  });

  it('returns an empty map on non-200 responses', async () => {
    requestMock.mockResolvedValue({ statusCode: 503, body: { json: async () => ({}) } });
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    const series = await fetchMfNavSeries('parag-parikh-flexi');
    expect(series.size).toBe(0);
  });

  it('skips rows with non-numeric NAV gracefully', async () => {
    requestMock.mockResolvedValue(
      ok200([
        { date: '17-01-2024', nav: '70.50' },
        { date: '16-01-2024', nav: 'N.A.' },
        { date: '15-01-2024', nav: '69.80' },
      ]),
    );
    const { fetchMfNavSeries } = await import('@/lib/pricing/mfBenchmarks');
    const series = await fetchMfNavSeries('parag-parikh-flexi');
    expect(series.size).toBe(2);
    expect(series.has('2024-01-16')).toBe(false);
  });
});

describe('fetchMfNavClose', () => {
  it('returns the NAV on the requested date when present', async () => {
    requestMock.mockResolvedValue(
      ok200([
        { date: '17-01-2024', nav: '70.50' },
        { date: '15-01-2024', nav: '69.80' },
      ]),
    );
    const { fetchMfNavClose } = await import('@/lib/pricing/mfBenchmarks');
    const v = await fetchMfNavClose('parag-parikh-flexi', '2024-01-15');
    expect(v).toBeCloseTo(69.8);
  });

  it('falls back to the most recent NAV on or before the requested date (weekend handling)', async () => {
    requestMock.mockResolvedValue(
      ok200([
        { date: '15-01-2024', nav: '69.80' }, // Mon
        { date: '12-01-2024', nav: '69.20' }, // Fri
      ]),
    );
    const { fetchMfNavClose } = await import('@/lib/pricing/mfBenchmarks');
    const v = await fetchMfNavClose('parag-parikh-flexi', '2024-01-13'); // Sat
    expect(v).toBeCloseTo(69.2);
  });

  it('returns null when no NAV exists on or before the requested date', async () => {
    requestMock.mockResolvedValue(ok200([{ date: '15-01-2024', nav: '69.80' }]));
    const { fetchMfNavClose } = await import('@/lib/pricing/mfBenchmarks');
    const v = await fetchMfNavClose('parag-parikh-flexi', '2010-01-01');
    expect(v).toBeNull();
  });
});
