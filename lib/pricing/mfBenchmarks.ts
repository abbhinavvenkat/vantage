/**
 * Indian mutual fund NAV adapter — sources daily NAV history from the free
 * `api.mfapi.in` proxy over AMFI. Mirrors the API of `lib/pricing/benchmarks.ts`
 * so MFs slot into the same chart/XIRR machinery as index benchmarks.
 *
 * Endpoint: GET https://api.mfapi.in/mf/<schemeCode>
 *   → JSON { meta: { scheme_name, ... }, data: [{ date: "DD-MM-YYYY", nav: "..." }] }
 * The single endpoint returns the FULL history for the scheme. We convert
 * `DD-MM-YYYY` → `YYYY-MM-DD` and parse NAV as float.
 *
 * Rate-limiting: shared 1.1s window per host. Four parallel fund fetches
 * serialise through `rateWait`.
 */

import { request } from 'undici';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const MF_HOST = 'api.mfapi.in';
const UA = 'Mozilla/5.0 stock-platform/0.1';

const CACHE_DIR = path.join(process.cwd(), 'data', 'prices');

export type MfBenchmarkId =
  | 'parag-parikh-flexi'
  | 'kotak-large-mid'
  | 'axis-flexi'
  | 'invesco-contra';

export type MfBenchmark = {
  id: MfBenchmarkId;
  label: string;
  schemeCode: number;
  category: string;
  fileName: string;
};

/**
 * Scheme codes verified against api.mfapi.in on 2026-05-03 — `meta.scheme_name`
 * matches each fund's Direct Plan - Growth variant. Inception coverage:
 *   - parag-parikh-flexi: from 2013-05-28 (covers 2020-05-26 onward)
 *   - kotak-large-mid:    from 2013-01-02
 *   - axis-flexi:         from 2017-11-24 (post-launch; covers 2020-05-26)
 *   - invesco-contra:     from 2013-01-02
 */
export const MF_BENCHMARKS: readonly MfBenchmark[] = [
  {
    id: 'parag-parikh-flexi',
    label: 'Parag Parikh Flexicap',
    schemeCode: 122639,
    category: 'Value + International',
    fileName: 'mf-parag-parikh-flexi.json',
  },
  {
    id: 'kotak-large-mid',
    label: 'Kotak Large & Midcap',
    schemeCode: 120158,
    category: 'GARP',
    fileName: 'mf-kotak-large-mid.json',
  },
  {
    id: 'axis-flexi',
    label: 'Axis Flexicap',
    schemeCode: 141925,
    category: 'Quality Growth',
    fileName: 'mf-axis-flexi.json',
  },
  {
    id: 'invesco-contra',
    label: 'Invesco India Contra',
    schemeCode: 120348,
    category: 'Contra',
    fileName: 'mf-invesco-contra.json',
  },
] as const;

export function getMfBenchmark(id: MfBenchmarkId): MfBenchmark {
  const def = MF_BENCHMARKS.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown MF benchmark id: ${id}`);
  return def;
}

// ── Rate limiter (shared 1 req/s per host) ───────────────────────────────────
const lastFetch = new Map<string, number>();
async function rateWait(host: string): Promise<void> {
  const last = lastFetch.get(host) ?? 0;
  const wait = Math.max(0, 1100 - (Date.now() - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch.set(host, Date.now());
}

/** Convert "DD-MM-YYYY" → "YYYY-MM-DD"; returns null on malformed input. */
function ddmmyyyyToIso(s: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ── Bulk series ──────────────────────────────────────────────────────────────

type CacheShape = {
  fetchedAt: string;
  range: { start: string; end: string };
  series: Record<string, number>;
};

function cachePath(def: MfBenchmark): string {
  return path.join(CACHE_DIR, def.fileName);
}

async function readCache(def: MfBenchmark): Promise<CacheShape | null> {
  try {
    const raw = await fs.readFile(cachePath(def), 'utf8');
    return JSON.parse(raw) as CacheShape;
  } catch {
    return null;
  }
}

async function writeCache(def: MfBenchmark, c: CacheShape): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(cachePath(def), JSON.stringify(c, null, 2), 'utf8');
  } catch {
    // Best-effort cache; don't crash callers on disk errors.
  }
}

/**
 * Fetch the FULL date→NAV map for a fund. Single bulk request (rate-limited).
 * mfapi.in exposes the entire history through one endpoint; the start/end
 * arguments to the cached variant are honoured at read time, not at fetch time.
 */
export async function fetchMfNavSeries(id: MfBenchmarkId): Promise<Map<string, number>> {
  const def = getMfBenchmark(id);
  const url = `https://${MF_HOST}/mf/${def.schemeCode}`;

  await rateWait(MF_HOST);

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
    const data: { date: string; nav: string }[] = Array.isArray(json?.data) ? json.data : [];
    for (const row of data) {
      const iso = ddmmyyyyToIso(row.date);
      if (!iso) continue;
      const nav = Number.parseFloat(row.nav);
      if (!Number.isFinite(nav) || nav <= 0) continue;
      map.set(iso, nav);
    }
  } catch {
    // fall through with empty map
  }
  return map;
}

/**
 * Cached variant: reads JSON cache at `data/prices/<fileName>` and only
 * re-fetches if the requested range exceeds the cached range or the cache
 * is older than `maxAgeMs`. Returns the full cached series — callers slice
 * by date as needed (matches the index-benchmark pattern).
 */
export async function getMfNavSeriesCached(
  id: MfBenchmarkId,
  startDate: string,
  endDate: string,
  maxAgeMs: number = 12 * 60 * 60 * 1000,
): Promise<Map<string, number>> {
  const def = getMfBenchmark(id);
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

  const fresh = await fetchMfNavSeries(id);
  if (fresh.size === 0 && cache) {
    // Network failed; serve stale cache.
    const m = new Map<string, number>();
    for (const [k, v] of Object.entries(cache.series)) m.set(k, v);
    return m;
  }

  // Compute the actual covered range from the data we got.
  let minK = endDate;
  let maxK = startDate;
  for (const k of fresh.keys()) {
    if (k < minK) minK = k;
    if (k > maxK) maxK = k;
  }
  const series: Record<string, number> = {};
  for (const [k, v] of fresh) series[k] = v;
  await writeCache(def, {
    fetchedAt: new Date().toISOString(),
    range: { start: minK, end: maxK },
    series,
  });
  return fresh;
}

/**
 * Single-day NAV lookup: returns NAV on `date` if present, else the most
 * recent prior NAV (weekends/holidays fall back to the previous Friday).
 * Returns null if no NAV exists on or before `date`.
 */
export async function fetchMfNavClose(id: MfBenchmarkId, date: string): Promise<number | null> {
  const series = await fetchMfNavSeries(id);
  if (series.size === 0) return null;
  if (series.has(date)) return series.get(date)!;
  // closest-on-or-before
  const keys = [...series.keys()].sort();
  let best: string | null = null;
  for (const k of keys) {
    if (k <= date) best = k;
    else break;
  }
  return best != null ? (series.get(best) ?? null) : null;
}
