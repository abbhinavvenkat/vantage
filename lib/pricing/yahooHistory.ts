/**
 * Yahoo Finance v8 chart API — per-symbol daily EOD history.
 * Mirrors `fetchNifty50Series` (period1/period2 bulk fetch) but for arbitrary
 * tickers via `toYahooSymbol`. Reuses the 1 req/s rate limiter.
 */

import { request } from 'undici';
import { toYahooSymbol, type EodQuote } from '@/lib/pricing/yahoo';

const YAHOO_HOST = 'query1.finance.yahoo.com';
const UA = 'Mozilla/5.0 stock-platform/0.1';

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function epochSecondsAtUtcMidnight(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
}

// Shared 1 req/s host limiter — same key as `lib/pricing/yahoo.ts` is intentional
// at the module level, but each module owns its own map. The Yahoo endpoint
// tolerates ~1 req/s per host, and our callers serialise via this map per host.
const lastFetch = new Map<string, number>();
async function rateWait(host: string): Promise<void> {
  const last = lastFetch.get(host) ?? 0;
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch.set(host, Date.now());
}

/**
 * Fetch one bulk daily-bar response for `bareSymbol` between `startDate` and
 * `endDate` (inclusive). Returns one EodQuote per trading day for which Yahoo
 * provided a non-null close. Returns an empty array on HTTP/parse error.
 */
export async function fetchPriceHistory(
  bareSymbol: string,
  startDate: string,
  endDate: string,
): Promise<EodQuote[]> {
  const period1 = epochSecondsAtUtcMidnight(startDate);
  const period2 = epochSecondsAtUtcMidnight(endDate) + 86_400; // exclusive upper
  const ySymbol = toYahooSymbol(bareSymbol);
  const sym = encodeURIComponent(ySymbol);
  const url =
    `https://${YAHOO_HOST}/v8/finance/chart/${sym}` +
    `?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false`;

  await rateWait(YAHOO_HOST);

  const out: EodQuote[] = [];
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      bodyTimeout: 30_000,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) return out;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await body.json();
    const result = json?.chart?.result?.[0];
    if (!result) return out;

    const timestamps: number[] = result.timestamp ?? [];
    const q = result.indicators?.quote?.[0] ?? {};
    const adjArr: (number | null)[] = result.indicators?.adjclose?.[0]?.adjclose ?? [];

    for (let i = 0; i < timestamps.length; i++) {
      const close = q.close?.[i];
      if (close == null) continue;
      const d = isoDate(new Date(timestamps[i]! * 1000));
      out.push({
        symbol: bareSymbol,
        yahooSymbol: ySymbol,
        date: d,
        open: q.open?.[i] ?? null,
        high: q.high?.[i] ?? null,
        low: q.low?.[i] ?? null,
        close,
        adjClose: adjArr[i] ?? null,
        volume: q.volume?.[i] ?? null,
        source: 'yahoo',
      });
    }
  } catch {
    return out;
  }
  return out;
}
