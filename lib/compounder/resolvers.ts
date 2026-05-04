/**
 * Compounder factor resolvers — chained data-source helpers used by the 10
 * factor evaluators in `lib/compounder/factors.ts`.
 *
 * Goal: eliminate `unknown` (`?`) verdicts. Each evaluator chains resolvers in
 * decreasing order of confidence:
 *
 *   1. fundamentals math (existing path; not implemented here, owned by the
 *      evaluator itself)
 *   2. annual report summary (`data/research/<symbol>/annual-report-summarize/`)
 *   3. earnings-call digest (`data/research/<symbol>/earnings-call-digest/`)
 *   4. management accountability + filings + thesis stress test
 *   5. sector prior fallback (`data/refs/sector_priors.json`) — always returns
 *      a partial verdict so we never punt with `unknown`
 *
 * No external API. No LLM. Pure I/O over local artefacts.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { FactorVerdict } from '@/lib/compounder/factors';
import {
  loadARSummaries,
  loadConcallDigests,
  loadLatestManagementAccountability,
  loadLatestThesisStressTest,
  type ARSummary,
  type ConcallDigest,
  type ManagementAccountability,
  type ThesisStressTest,
} from '@/lib/research/loadOutputs';

// ---------------------------------------------------------------------------
// Sector priors
// ---------------------------------------------------------------------------

export type FactorId =
  | 'tam'
  | 'execution'
  | 'roce'
  | 'moat'
  | 'management'
  | 'valuation'
  | 'thematic_tailwind'
  | 'pricing_power'
  | 'reinvestment'
  | 'fcf_conversion'
  | 'capital_alloc'
  | 'cyclicality';

export type PriorEntry = { status: 'pass' | 'partial' | 'fail'; score: number; rationale: string };

export type SectorPriorsRef = {
  default: Record<FactorId, PriorEntry>;
  sectors: Record<string, Partial<Record<FactorId, PriorEntry>>>;
};

const SECTOR_PRIORS_PATH = 'data/refs/sector_priors.json';
let _sectorPriorsCache: SectorPriorsRef | null = null;

export function loadSectorPriors(path = SECTOR_PRIORS_PATH): SectorPriorsRef {
  if (_sectorPriorsCache) return _sectorPriorsCache;
  if (!existsSync(path)) {
    return { default: makeNeutralDefaults(), sectors: {} };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as SectorPriorsRef;
    _sectorPriorsCache = raw;
    return raw;
  } catch {
    return { default: makeNeutralDefaults(), sectors: {} };
  }
}

export function _resetResolverCachesForTest(): void {
  _sectorPriorsCache = null;
}

function makeNeutralDefaults(): Record<FactorId, PriorEntry> {
  const ids: FactorId[] = [
    'tam',
    'execution',
    'roce',
    'moat',
    'management',
    'valuation',
    'thematic_tailwind',
    'pricing_power',
    'reinvestment',
    'fcf_conversion',
    'capital_alloc',
    'cyclicality',
  ];
  const out = {} as Record<FactorId, PriorEntry>;
  for (const id of ids) {
    out[id] = {
      status: 'partial',
      score: 0.5,
      rationale: 'sector prior — neutral default (no priors file loaded)',
    };
  }
  return out;
}

/** Sector prior with last-resort fallback — never returns null. */
export function sectorPriorVerdict(sector: string, factorId: FactorId): FactorVerdict {
  const ref = loadSectorPriors();
  const sec = ref.sectors[sector];
  const entry = (sec && sec[factorId]) || ref.default[factorId];
  return {
    status: entry.status,
    score: entry.score,
    rationale: `${entry.rationale} (sector="${sector}")`,
    evidence: [`sector prior: ${sector}/${factorId}`],
  };
}

// ---------------------------------------------------------------------------
// Research artefact loaders (memoised per symbol so we don't re-read JSON
// 10 times per stock).
// ---------------------------------------------------------------------------

type SymbolBundle = {
  ar: ARSummary[];
  concalls: ConcallDigest[];
  accountability: ManagementAccountability | null;
  thesis: ThesisStressTest | null;
};

// No module-level cache — reads fresh on each request so newly-written
// thesis/AR/concall files are picked up without a server restart.
const _bundleCache = new Map<string, SymbolBundle>();

export function _resetBundleCacheForTest(): void {
  _bundleCache.clear();
}

export function loadSymbolBundle(symbol: string, root?: string): SymbolBundle {
  const r = root ?? resolve(process.env.RESEARCH_DATA_ROOT ?? './data');
  // Only use cache when an explicit root is passed (test isolation).
  // Production path (root=undefined) always reads fresh from the filesystem.
  if (root !== undefined) {
    const key = `${root}::${symbol}`;
    const hit = _bundleCache.get(key);
    if (hit) return hit;
    const bundle: SymbolBundle = {
      ar: loadARSummaries(symbol, r),
      concalls: loadConcallDigests(symbol, r),
      accountability: loadLatestManagementAccountability(symbol, r),
      thesis: loadLatestThesisStressTest(symbol, r),
    };
    _bundleCache.set(key, bundle);
    return bundle;
  }
  return {
    ar: loadARSummaries(symbol, r),
    concalls: loadConcallDigests(symbol, r),
    accountability: loadLatestManagementAccountability(symbol, r),
    thesis: loadLatestThesisStressTest(symbol, r),
  };
}

export function latestAR(symbol: string, root?: string): ARSummary | null {
  return loadSymbolBundle(symbol, root).ar[0] ?? null;
}

export function latestConcall(symbol: string, root?: string): ConcallDigest | null {
  return loadSymbolBundle(symbol, root).concalls[0] ?? null;
}

// ---------------------------------------------------------------------------
// Text scanning helpers — deterministic keyword counts. NOT NLP.
// ---------------------------------------------------------------------------

export function countMatches(text: string | undefined, patterns: RegExp[]): number {
  if (!text) return 0;
  let n = 0;
  for (const p of patterns) {
    const m = text.match(p);
    if (m) n += m.length;
  }
  return n;
}

export function checklistPassRate(ar: ARSummary | null): {
  pass: number;
  fail: number;
  unknown: number;
  total: number;
} {
  if (!ar || !ar.checklist_results) return { pass: 0, fail: 0, unknown: 0, total: 0 };
  let pass = 0;
  let fail = 0;
  let unknown = 0;
  for (const c of ar.checklist_results) {
    if (c.pass === true) pass += 1;
    else if (c.pass === false) fail += 1;
    else unknown += 1;
  }
  return { pass, fail, unknown, total: ar.checklist_results.length };
}

export function checklistItemVerdict(
  ar: ARSummary | null,
  itemPattern: RegExp,
): boolean | 'unknown' | null {
  if (!ar || !ar.checklist_results) return null;
  for (const c of ar.checklist_results) {
    if (itemPattern.test(c.item)) return c.pass;
  }
  return null;
}

export function concallToneScore(c: ConcallDigest | null): number | null {
  if (!c) return null;
  // The schema has either `score_-2_to_+2` (current) or `score_2_to_2`
  // (older variant). Try both.
  const t = c.management_tone ?? {};
  const s1 = (t as Record<string, number | undefined>)['score_-2_to_+2'];
  const s2 = (t as Record<string, number | undefined>)['score_2_to_2'];
  if (typeof s1 === 'number') return s1;
  if (typeof s2 === 'number') return s2;
  return null;
}

// ---------------------------------------------------------------------------
// Composite resolver chain — used by evaluators when fundamentals are silent.
// ---------------------------------------------------------------------------

export type ResolveStep<T> = () => T | null;

/** Run resolvers in priority order; first non-null wins. Never returns null. */
export function chain<T>(steps: ResolveStep<T>[], fallback: T): T {
  for (const step of steps) {
    try {
      const r = step();
      if (r != null) return r;
    } catch {
      /* continue */
    }
  }
  return fallback;
}
