import { describe, it, expect } from 'vitest';
import { toYahooSymbol, parseYahooQuote } from '@/lib/pricing/yahoo';

describe('toYahooSymbol', () => {
  it('appends .NS for NSE equities', () => {
    expect(toYahooSymbol('BEL')).toBe('BEL.NS');
  });

  it('preserves already-suffixed symbols', () => {
    expect(toYahooSymbol('BEL.NS')).toBe('BEL.NS');
    expect(toYahooSymbol('BEL.BO')).toBe('BEL.BO');
  });

  it('handles symbols with hyphens (e.g. BAJAJ-AUTO → BAJAJ-AUTO.NS)', () => {
    expect(toYahooSymbol('BAJAJ-AUTO')).toBe('BAJAJ-AUTO.NS');
  });
});

describe('parseYahooQuote', () => {
  it('extracts close price from a well-formed Yahoo v8 API response', () => {
    const mockResponse = {
      chart: {
        result: [
          {
            meta: {
              regularMarketPrice: 123.45,
              regularMarketTime: 1700000000,
              symbol: 'BEL.NS',
            },
            timestamp: [1700000000],
            indicators: {
              quote: [
                { close: [123.45], open: [120.0], high: [125.0], low: [119.0], volume: [500000] },
              ],
              adjclose: [{ adjclose: [123.45] }],
            },
          },
        ],
        error: null,
      },
    };

    const result = parseYahooQuote(mockResponse, 'BEL');
    expect(result).not.toBeNull();
    expect(result!.symbol).toBe('BEL');
    expect(result!.close).toBeCloseTo(123.45);
    expect(result!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result!.source).toBe('yahoo');
  });

  it('returns null when chart result is empty', () => {
    const mockResponse = { chart: { result: null, error: { code: 'Not Found' } } };
    expect(parseYahooQuote(mockResponse, 'XYZ')).toBeNull();
  });

  it('returns null when close price is missing', () => {
    const mockResponse = {
      chart: {
        result: [
          {
            meta: { regularMarketPrice: null, regularMarketTime: 1700000000, symbol: 'BEL.NS' },
            timestamp: [1700000000],
            indicators: {
              quote: [{ close: [null], open: [null], high: [null], low: [null], volume: [null] }],
              adjclose: [{ adjclose: [null] }],
            },
          },
        ],
        error: null,
      },
    };
    expect(parseYahooQuote(mockResponse, 'BEL')).toBeNull();
  });
});
