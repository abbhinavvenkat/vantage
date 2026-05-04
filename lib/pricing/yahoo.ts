/**
 * Yahoo Finance v8 chart API adapter.
 * Fetches EOD close prices for Indian equities (NSE suffix .NS by default).
 * Rate limited to 1 req/s; no API key required.
 */

import { request } from 'undici';

export type EodQuote = {
  symbol: string; // bare symbol (no suffix)
  yahooSymbol: string;
  date: string; // ISO yyyy-mm-dd
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  adjClose: number | null;
  volume: number | null;
  source: 'yahoo';
};

// ── Symbol mapping ────────────────────────────────────────────────────────────

const KNOWN_SUFFIXES = ['.NS', '.BO', '.NYSE', '.NASDAQ'];

/** Appends .NS if the symbol has no exchange suffix. */
export function toYahooSymbol(symbol: string): string {
  if (KNOWN_SUFFIXES.some((s) => symbol.toUpperCase().endsWith(s.toUpperCase()))) {
    return symbol;
  }
  return `${symbol}.NS`;
}

// ── Response parsing ──────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseYahooQuote(json: any, bareSymbol: string): EodQuote | null {
  const result = json?.chart?.result?.[0];
  if (!result) return null;

  const meta = result.meta ?? {};
  const timestamps: number[] = result.timestamp ?? [];
  const quotes = result.indicators?.quote?.[0] ?? {};
  const adjCloses: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  // Prefer last available close
  let close: number | null = null;
  let adjClose: number | null = null;
  let ts: number | null = null;

  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (quotes.close?.[i] != null) {
      close = quotes.close[i];
      adjClose = adjCloses[i] ?? null;
      ts = timestamps[i] ?? null;
      break;
    }
  }

  // Fall back to meta.regularMarketPrice if no OHLCV candle
  if (close == null) {
    const rmp = meta.regularMarketPrice;
    if (rmp == null) return null;
    close = rmp;
    ts = meta.regularMarketTime ?? null;
  }

  if (close === null) return null;
  const date = ts ? isoDate(new Date(ts * 1000)) : isoDate(new Date());

  return {
    symbol: bareSymbol,
    yahooSymbol: meta.symbol ?? toYahooSymbol(bareSymbol),
    date,
    open: quotes.open?.[quotes.open.length - 1] ?? null,
    high: quotes.high?.[quotes.high.length - 1] ?? null,
    low: quotes.low?.[quotes.low.length - 1] ?? null,
    close,
    adjClose,
    volume: quotes.volume?.[quotes.volume.length - 1] ?? null,
    source: 'yahoo',
  };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Rate limiter ──────────────────────────────────────────────────────────────

const lastFetch = new Map<string, number>();

async function rateWait(host: string): Promise<void> {
  const last = lastFetch.get(host) ?? 0;
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch.set(host, Date.now());
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

const YAHOO_HOST = 'query1.finance.yahoo.com';
const UA = 'Mozilla/5.0 stock-platform/0.1';

export async function fetchEodQuote(bareSymbol: string): Promise<EodQuote | null> {
  const ySymbol = encodeURIComponent(toYahooSymbol(bareSymbol));
  const url =
    `https://${YAHOO_HOST}/v8/finance/chart/${ySymbol}` +
    `?interval=1d&range=5d&includePrePost=false`;

  await rateWait(YAHOO_HOST);

  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
    });

    if (statusCode !== 200) return null;

    const json = await body.json();
    return parseYahooQuote(json, bareSymbol);
  } catch {
    return null;
  }
}

/**
 * Fetches EOD quotes for multiple symbols with rate limiting.
 * Returns a map of bareSymbol → EodQuote (missing/failed symbols omitted).
 */
export async function fetchEodQuotes(symbols: string[]): Promise<Map<string, EodQuote>> {
  const result = new Map<string, EodQuote>();
  for (const sym of symbols) {
    const q = await fetchEodQuote(sym);
    if (q) result.set(sym, q);
  }
  return result;
}
