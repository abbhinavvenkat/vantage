/**
 * Sector PE medians — used to judge whether a symbol's elevated multiple is
 * justified by sector-wide pricing (a 60-PE FMCG stock is closer to "fair"
 * than a 60-PE industrial). Computed across all symbols with both a sector
 * tag (`SECTOR_MAP`) and a current PE in `data/codex/backtests/fundamentals/`.
 *
 * Cached at module load so repeat reads don't hit the filesystem.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Fundamentals } from '@/lib/decisions/growthForecast';
import { SECTOR_MAP } from '@/lib/sectors/map';

const DEFAULT_FUND_ROOT = 'data/codex/backtests/fundamentals';

export type SectorMedians = Record<string, { medianPe: number; n: number }>;

let cache: SectorMedians | null = null;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function computeSectorMedians(root = DEFAULT_FUND_ROOT): SectorMedians {
  if (!existsSync(root)) return {};
  const bySector = new Map<string, number[]>();
  for (const f of readdirSync(root)) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue;
    const sym = f.replace(/\.json$/, '');
    const sector = SECTOR_MAP[sym];
    if (!sector || sector === 'ETF') continue;
    let fund: Fundamentals;
    try {
      fund = JSON.parse(readFileSync(join(root, f), 'utf-8')) as Fundamentals;
    } catch {
      continue;
    }
    const pe = typeof fund.current?.pe === 'number' ? fund.current.pe : null;
    if (pe === null || !Number.isFinite(pe) || pe <= 0 || pe > 500) continue; // strip outliers
    const arr = bySector.get(sector) ?? [];
    arr.push(pe);
    bySector.set(sector, arr);
  }
  const out: SectorMedians = {};
  for (const [sector, pes] of bySector) {
    const m = median(pes);
    if (m !== null) out[sector] = { medianPe: Number(m.toFixed(2)), n: pes.length };
  }
  return out;
}

export function getSectorMedians(): SectorMedians {
  if (cache === null) cache = computeSectorMedians();
  return cache;
}

/** Minimum constituents required to trust a sector median. With < this, the
 *  median is too noisy to use as a benchmark — we return null and the
 *  valuation factor falls back to other axes (PEG, own-history). */
const MIN_SECTOR_N = 4;

export function getSectorMedian(sector: string): number | null {
  const map = getSectorMedians();
  const entry = map[sector];
  if (!entry) return null;
  if (entry.n < MIN_SECTOR_N) return null;
  return entry.medianPe;
}

/** For tests / on-demand refresh after fundamentals updates. */
export function resetSectorMediansCache(): void {
  cache = null;
}
