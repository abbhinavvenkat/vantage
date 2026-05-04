/**
 * Generic Yahoo index EOD adapter.
 * Parameterised over a small registry of supported benchmarks. Each benchmark
 * gets its own JSON cache file under `data/prices/`.
 *
 * Ticker choices (verified against Yahoo Finance v8 chart API on 2026-05-03):
 *   - `^NSEI`             → "NIFTY 50" (INR). Authoritative; daily series dense.
 *   - `^CRSLDX`           → "NIFTY 500" (INR). Used here as the LargeMidcap-250
 *                           proxy because the Nifty LargeMidcap 250 has no clean
 *                           Yahoo ticker that returns dense daily data
 *                           (`NIFTY_LARGEMID250.NS` exists but is sparse —
 *                           1 datapoint over a 30-day window in our probe).
 *   - `BSE-500.BO`        → "S&P BSE 500 INDEX" (INR). Direct match; no fallback
 *                           needed (probe returned the full daily series).
 *
 * Rate-limiting: shared 1.1s window per host with the rest of the Yahoo
 * adapter. Three parallel benchmark fetches will serialize through `rateWait`.
 */

import { request } from 'undici';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const YAHOO_HOST = 'query1.finance.yahoo.com';
const UA = 'Mozilla/5.0 stock-platform/0.1';

const CACHE_DIR = path.join(process.cwd(), 'data', 'prices');

export type BenchmarkId = 'nifty50' | 'largemid250' | 'bse500';

export type BenchmarkDef = {
  id: BenchmarkId;
  label: string;
  yahooSymbol: string;
  fileName: string;
};

export const BENCHMARKS: readonly BenchmarkDef[] = [
  {
    id: 'nifty50',
    label: 'Nifty 50',
    yahooSymbol: '^NSEI',
    fileName: 'nifty50.json',
  },
  {
    id: 'largemid250',
    // Labelled as "Nifty 500 (LargeMid250 proxy)" because no clean Yahoo
    // ticker returns dense daily data for the actual Nifty LargeMidcap 250
    // index. Nifty 500 is a reasonable broad-market stand-in.
    label: 'Nifty 500 (LargeMid250 proxy)',
    yahooSymbol: '^CRSLDX',
    fileName: 'largemid250.json',
  },
  {
    id: 'bse500',
    label: 'BSE 500',
    yahooSymbol: 'BSE-500.BO',
    fileName: 'bse500.json',
  },
] as const;

export function getBenchmarkDef(id: BenchmarkId): BenchmarkDef {
  const def = BENCHMARKS.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown benchmark id: ${id}`);
  return def;
}

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

export async function fetchBenchmarkClose(
  benchmarkId: BenchmarkId,
  date: string,
): Promise<number | null> {
  const def = getBenchmarkDef(benchmarkId);
  const period2 = epochSecondsAtUtcMidnight(date) + 86_400; // exclusive upper
  const period1 = period2 - 5 * 86_400;
  const sym = encodeURIComponent(def.yahooSymbol);
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

function cachePath(def: BenchmarkDef): string {
  return path.join(CACHE_DIR, def.fileName);
}

async function readCache(def: BenchmarkDef): Promise<CacheShape | null> {
  try {
    const raw = await fs.readFile(cachePath(def), 'utf8');
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

async function writeCache(def: BenchmarkDef, c: CacheShape): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath(def), JSON.stringify(c, null, 2), 'utf8');
  } catch {
    // Best-effort cache; don't crash callers on disk errors.
  }
}

/**
 * Fetch a date→close map for [startDate, endDate] inclusive. Single bulk
 * request (rate-limited).
 */
export async function fetchBenchmarkSeries(
  benchmarkId: BenchmarkId,
  startDate: string,
  endDate: string,
): Promise<Map<string, number>> {
  const def = getBenchmarkDef(benchmarkId);
  const period1 = epochSecondsAtUtcMidnight(startDate);
  const period2 = epochSecondsAtUtcMidnight(endDate) + 86_400; // exclusive upper
  const sym = encodeURIComponent(def.yahooSymbol);
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
 * Cached variant: reads a JSON cache at data/prices/<fileName> and only
 * re-fetches if the requested range exceeds the cached range or the cache
 * is older than `maxAgeMs`.
 */
export async function getBenchmarkSeriesCached(
  benchmarkId: BenchmarkId,
  startDate: string,
  endDate: string,
  maxAgeMs: number = 12 * 60 * 60 * 1000,
): Promise<Map<string, number>> {
  const def = getBenchmarkDef(benchmarkId);
  const cache = await readCache(def);
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

  const start = cache && cache.range.start < startDate ? cache.range.start : startDate;
  const end = cache && cache.range.end > endDate ? cache.range.end : endDate;
  const fresh = await fetchBenchmarkSeries(benchmarkId, start, end);
  if (fresh.size === 0 && cache) {
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(cache.series)) m.set(k, v);
    return m;
  }
  const series: Record<string, number> = {};
  for (const [k, v] of fresh) series[k] = v;
  await writeCache(def, {
    fetchedAt: new Date().toISOString(),
    range: { start, end },
    series,
  });
  return fresh;
}
