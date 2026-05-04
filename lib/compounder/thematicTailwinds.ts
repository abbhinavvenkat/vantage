/**
 * Thematic tailwind reference loader.
 *
 * Source of truth: `data/refs/thematic_tailwinds.json`, refreshed periodically
 * by the `/thematic-tailwinds-refresh` Claude Code skill (which scrapes
 * McKinsey, IEA, BloombergNEF, NASSCOM, Goldman / Morgan Stanley sector
 * outlooks and produces the JSON).
 *
 * Tiers (from strongest to weakest tailwind):
 *   structural — multi-decade compounding, broad cross-source consensus
 *   emerging   — early but well-funded; visible 5–10y runway
 *   maturing   — saturating, growth approaching GDP-like
 *   declining  — structural headwind / regulatory pressure
 */

import { existsSync, readFileSync } from 'node:fs';

export type ThemeTier = 'structural' | 'emerging' | 'maturing' | 'declining';

export type ThemeEvidence = { source: string; citation: string; url: string };

export type ThemeEntry = {
  label: string;
  tier: ThemeTier;
  horizon_years: number;
  growth_outlook_pct_yoy: number;
  evidence: ThemeEvidence[];
};

export type ThematicTailwindsRef = {
  version: string;
  generated_at: string;
  source_summary: string;
  themes: Record<string, ThemeEntry>;
  symbol_themes: Record<string, string[]>;
};

const REF_PATH = 'data/refs/thematic_tailwinds.json';

let _cache: ThematicTailwindsRef | null = null;

export function loadThematicTailwinds(path = REF_PATH): ThematicTailwindsRef {
  if (_cache) return _cache;
  if (!existsSync(path)) {
    return {
      version: '0.0.0',
      generated_at: '',
      source_summary: '',
      themes: {},
      symbol_themes: {},
    };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as ThematicTailwindsRef;
    _cache = raw;
    return raw;
  } catch {
    return {
      version: '0.0.0',
      generated_at: '',
      source_summary: '',
      themes: {},
      symbol_themes: {},
    };
  }
}

export function _resetThematicTailwindsCache(): void {
  _cache = null;
}

/** Get the themes a symbol is tagged with (returns empty array if untagged). */
export function getSymbolThemes(symbol: string): string[] {
  const ref = loadThematicTailwinds();
  return ref.symbol_themes[symbol] ?? [];
}

/** Hydrate symbol's themes with their entry data. */
export type ResolvedSymbolThemes = {
  themes: { id: string; entry: ThemeEntry }[];
  /** Strongest tier across the symbol's themes (structural > emerging > maturing > declining). */
  bestTier: ThemeTier | null;
  /** Worst tier (sometimes a stock has both — e.g., legacy + emerging). */
  worstTier: ThemeTier | null;
};

const TIER_RANK: Record<ThemeTier, number> = {
  structural: 4,
  emerging: 3,
  maturing: 2,
  declining: 1,
};

export function resolveSymbolThemes(symbol: string): ResolvedSymbolThemes {
  const ref = loadThematicTailwinds();
  const ids = ref.symbol_themes[symbol] ?? [];
  const resolved = ids
    .map((id) => {
      const entry = ref.themes[id];
      return entry ? { id, entry } : null;
    })
    .filter((x): x is { id: string; entry: ThemeEntry } => x !== null);
  if (resolved.length === 0) {
    return { themes: [], bestTier: null, worstTier: null };
  }
  const tiers = resolved.map((r) => r.entry.tier);
  const sorted = tiers.slice().sort((a, b) => TIER_RANK[b] - TIER_RANK[a]);
  return {
    themes: resolved,
    bestTier: sorted[0]!,
    worstTier: sorted[sorted.length - 1]!,
  };
}
