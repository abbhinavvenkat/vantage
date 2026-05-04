/**
 * Nifty 50 EOD adapter (Yahoo `^NSEI` index).
 * Bulk fetch via the chart API with `period1`/`period2`.
 * Local JSON cache at data/prices/nifty50.json — gitignored.
 */

import { request } from 'undici';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const YAHOO_HOST = 'query1.finance.yahoo.com';
const NIFTY_SYMBOL = '^NSEI';
const UA = 'Mozilla/5.0 stock-platform/0.1';

const CACHE_DIR = path.join(process.cwd(), 'data', 'prices');
const CACHE_FILE = path.join(CACHE_DIR, 'nifty50.json');

// ── Rate limiter (shared 1 req/s with the rest of the Yahoo adapter) ─────────
const lastFetch = new Map<string, number>();
async function rateWait(host: string): Promise<void> {
  const last = lastFetch.get(host) ?? 0;
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch.set(host, Date.now());
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function epochSecondsAtUtcMidnight(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 1000);
}

// ── Single-day close ─────────────────────────────────────────────────────────

export async function fetchNifty50Close(date: string): Promise<number | null> {
  // Use a 5-day window ending at the requested date so weekends fall back to the prior Friday.
  const period2 = epochSecondsAtUtcMidnight(date) + 86_400; // exclusive upper
  const period1 = period2 - 5 * 86_400;
  const sym = encodeURIComponent(NIFTY_SYMBOL);
  const url =
    `https://${YAHOO_HOST}/v8/finance/chart/${sym}` +
    `?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false`;

  await rateWait(YAHOO_HOST);

  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      bodyTimeout: 15_000,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await body.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = closes.length - 1; i >= 0; i--) {
      if (closes[i] != null) return closes[i] as number;
    }
    const rmp = result.meta?.regularMarketPrice;
    return typeof rmp === 'number' ? rmp : null;
  } catch {
    return null;
  }
}

// ── Bulk series ──────────────────────────────────────────────────────────────

type CacheShape = {
  fetchedAt: string;
  range: { start: string; end: string };
  series: Record<string, number>;
};

async function readCache(): Promise<CacheShape | null> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

async function writeCache(c: CacheShape): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(c, null, 2), 'utf8');
  } catch {
    // Best-effort cache; don't crash callers on disk errors.
  }
}

/**
 * Fetch a date→close map for [startDate, endDate] inclusive.
 * Single bulk request (rate-limited).
 */
export async function fetchNifty50Series(
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const period1 = epochSecondsAtUtcMidnight(startDate);
  const period2 = epochSecondsAtUtcMidnight(endDate) + 86_400; // exclusive upper
  const sym = encodeURIComponent(NIFTY_SYMBOL);
  const url =
    `https://${YAHOO_HOST}/v8/finance/chart/${sym}` +
    `?interval=1d&period1=${period1}&period2=${period2}&includePrePost=false`;

  await rateWait(YAHOO_HOST);

  const map = new Map<string, number>();
  try {
    const { statusCode, body } = await request(url, {
      method: 'GET',
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      bodyTimeout: 30_000,
      headersTimeout: 10_000,
    });
    if (statusCode !== 200) return map;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json: any = await body.json();
    const result = json?.chart?.result?.[0];
    if (!result) return map;
    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    for (let i = 0; i < timestamps.length; i++) {
      const c = closes[i];
      if (c == null) continue;
      const d = isoDate(new Date(timestamps[i]! * 1000));
      map.set(d, c);
    }
  } catch {
    // fall through with empty map
  }
  return map;
}

/**
 * Cached variant: reads a JSON cache at data/prices/nifty50.json and only re-fetches
 * if the requested range exceeds the cached range or the cache is older than `maxAgeMs`.
 */
export async function getNifty50SeriesCached(
  startDate: string,
  endDate: string,
  maxAgeMs: number = 12 * 60 * 60 * 1000,
): Promise<Map<string, number>> {
  const cache = await readCache();
  const now = Date.now();

  const cacheCovers =
    cache &&
    cache.range.start <= startDate &&
    cache.range.end >= endDate &&
    now - Date.parse(cache.fetchedAt) < maxAgeMs;

  if (cacheCovers) {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(cache!.series)) m.set(k, v);
    return m;
  }

  // Refetch the union of [cache.range, requested range] so we don't shrink coverage.
  const start = cache && cache.range.start < startDate ? cache.range.start : startDate;
  const end = cache && cache.range.end > endDate ? cache.range.end : endDate;
  const fresh = await fetchNifty50Series(start, end);
  if (fresh.size === 0 && cache) {
    // Network failed; serve stale cache.
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(cache.series)) m.set(k, v);
    return m;
  }
  const series: Record<string, number> = {};
  for (const [k, v] of fresh) series[k] = v;
  await writeCache({
    fetchedAt: new Date().toISOString(),
    range: { start, end },
    series,
  });
  return fresh;
}
