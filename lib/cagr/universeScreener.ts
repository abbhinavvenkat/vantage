/**
 * Universe screener for the Target CAGR Builder.
 *
 * Reads local-only artefacts under `data/codex/backtests/`:
 *   - `universe.csv`               (symbol, company_name, sector, industry)
 *   - `fundamentals/<symbol>.json` (Screener-style annual block + current.pe/mcap)
 *   - `results/<framework>_*.csv`  (per-cycle backtest picks; optional)
 *   - `results/summary.json`       (per-framework XIRR + nifty50 alpha)
 *
 * For each universe symbol with fundamentals available, we re-implement the
 * scoring rubrics for the three best-backtested frameworks (greenblatt, naren,
 * lynch), produce a composite score weighted by each framework's backtested
 * alpha vs Nifty 50, run `forecastGrowth` for the 5y CAGR forecast, and emit
 * the top-50 candidates that meet the target CAGR threshold.
 *
 * No LLM, no network — purely local files.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  forecastGrowth,
  loadFundamentals,
  type Fundamentals,
} from '@/lib/decisions/growthForecast';

const DEFAULT_UNIVERSE_ROOT = 'data/codex/backtests';
const DEFAULT_FUNDAMENTALS_ROOT = 'data/codex/backtests/fundamentals';
const DEFAULT_RESULTS_ROOT = 'data/codex/backtests/results';

export type MarketCapBucket = 'largecap' | 'midcap' | 'smallcap' | 'unknown';

export type ScreenedCandidate = {
  symbol: string;
  companyName: string;
  sector: string;
  marketCapBucket: MarketCapBucket;
  compositeScore: number; // 0-100
  forecastedCagr: number; // 0..1 fraction (e.g., 0.22 = 22%)
  confidence: 'low' | 'medium' | 'high';
  frameworkSupport: { framework: string; score: number; alpha: number }[];
  thesisOneLiner: string;
  thesisMd: string;
  entryFairPrice: number | null;
  entryStrongBuy: number | null;
  topRules: string[];
};

export type ScreenOptions = {
  targetCagrPct: number;
  horizonYears: number;
  universeRoot?: string;
  fundamentalsRoot?: string;
  backtestResultsRoot?: string;
  /** Maximum candidates returned (default 50). */
  limit?: number;
};

type UniverseRow = {
  symbol: string;
  companyName: string;
  sector: string;
  industry: string;
};

type FrameworkSummary = {
  xirr: number;
  alphaVsNifty50: number;
};

const FRAMEWORKS = ['greenblatt', 'naren', 'lynch'] as const;
type Framework = (typeof FRAMEWORKS)[number];

// Hard-coded fallbacks if summary.json missing — derived from the project plan
// (greenblatt 22.56%, naren 21.82%, lynch 21.0%; benchmark Nifty50 ~11.9%).
const FALLBACK_ALPHA: Record<Framework, number> = {
  greenblatt: 0.1065,
  naren: 0.0992,
  lynch: 0.0909,
};

function readCsv(path: string): string[][] {
  const txt = readFileSync(path, 'utf-8');
  return txt
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(','));
}

function loadUniverse(root: string): UniverseRow[] {
  const path = join(root, 'universe.csv');
  if (!existsSync(path)) return [];
  const rows = readCsv(path);
  if (rows.length <= 1) return [];
  const out: UniverseRow[] = [];
  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i]!;
    if (r.length < 4) continue;
    out.push({
      symbol: r[0]!.trim(),
      companyName: r[1]!.trim(),
      sector: r[2]!.trim(),
      industry: r[3]!.trim(),
    });
  }
  return out;
}

function loadFrameworkSummaries(resultsRoot: string): Record<Framework, FrameworkSummary> {
  const out: Record<Framework, FrameworkSummary> = {
    greenblatt: { xirr: 0.2256, alphaVsNifty50: FALLBACK_ALPHA.greenblatt },
    naren: { xirr: 0.2182, alphaVsNifty50: FALLBACK_ALPHA.naren },
    lynch: { xirr: 0.21, alphaVsNifty50: FALLBACK_ALPHA.lynch },
  };
  const path = join(resultsRoot, 'summary.json');
  if (!existsSync(path)) return out;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as {
      frameworks?: Record<string, { xirr?: number; benchmark_vs_nifty50_xirr_delta?: number }>;
    };
    for (const fw of FRAMEWORKS) {
      const f = raw.frameworks?.[fw];
      if (!f) continue;
      out[fw] = {
        xirr: typeof f.xirr === 'number' ? f.xirr : out[fw].xirr,
        alphaVsNifty50:
          typeof f.benchmark_vs_nifty50_xirr_delta === 'number'
            ? f.benchmark_vs_nifty50_xirr_delta
            : out[fw].alphaVsNifty50,
      };
    }
  } catch {
    /* fallthrough → fallbacks */
  }
  return out;
}

/**
 * Load the most-recent per-framework picks file and return a map of
 * symbol -> score for that framework. Returns empty if not found.
 */
function loadFrameworkPicks(resultsRoot: string, framework: Framework): Map<string, number> {
  const out = new Map<string, number>();
  if (!existsSync(resultsRoot)) return out;
  const all = readdirSync(resultsRoot).filter(
    (f) => f.startsWith(`${framework}_`) && f.endsWith('.csv'),
  );
  if (all.length === 0) return out;
  // Pick lexicographically last (latest cycle date is YYYY-MM-DD prefix).
  all.sort();
  const latest = all[all.length - 1]!;
  try {
    const rows = readCsv(join(resultsRoot, latest));
    if (rows.length <= 1) return out;
    const header = rows[0]!.map((h) => h.trim());
    const symIdx = header.indexOf('symbol');
    const scoreIdx = header.indexOf('score');
    if (symIdx < 0 || scoreIdx < 0) return out;
    for (let i = 1; i < rows.length; i += 1) {
      const r = rows[i]!;
      const sym = r[symIdx]?.trim();
      const sc = parseFloat(r[scoreIdx] ?? '');
      if (sym && Number.isFinite(sc)) out.set(sym, sc);
    }
  } catch {
    /* ignore */
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-framework scoring rubrics (synthesised from the four-cycle backtest
// methodology — used as fallback when the symbol does not appear in the
// latest per-framework picks file).
// ---------------------------------------------------------------------------

type FundDerived = {
  patCagr5y: number | null;
  revCagr5y: number | null;
  roceAvg5y: number | null;
  d2eLatest: number | null;
  pe: number | null;
  pb: number | null;
  earningsYield: number | null;
  pegProxy: number | null;
};

function deriveMetrics(f: Fundamentals): FundDerived {
  const ks = Object.keys(f.annual).sort();
  const last = ks.length ? f.annual[ks[ks.length - 1]!]! : null;
  let patCagr5y: number | null = null;
  let revCagr5y: number | null = null;
  if (ks.length >= 6) {
    const five = f.annual[ks[ks.length - 6]!]!;
    if (last?.pat_cr && five.pat_cr && last.pat_cr > 0 && five.pat_cr > 0) {
      patCagr5y = Math.pow(last.pat_cr / five.pat_cr, 1 / 5) - 1;
    }
    if (last?.sales_cr && five.sales_cr && last.sales_cr > 0 && five.sales_cr > 0) {
      revCagr5y = Math.pow(last.sales_cr / five.sales_cr, 1 / 5) - 1;
    }
  } else if (ks.length >= 3) {
    const first = f.annual[ks[0]!]!;
    const span = ks.length - 1;
    if (last?.pat_cr && first.pat_cr && last.pat_cr > 0 && first.pat_cr > 0) {
      patCagr5y = Math.pow(last.pat_cr / first.pat_cr, 1 / span) - 1;
    }
    if (last?.sales_cr && first.sales_cr && last.sales_cr > 0 && first.sales_cr > 0) {
      revCagr5y = Math.pow(last.sales_cr / first.sales_cr, 1 / span) - 1;
    }
  }
  const last5 = ks
    .slice(-5)
    .map((k) => f.annual[k]?.roce_pct ?? null)
    .filter((x): x is number => typeof x === 'number');
  const roceAvg5y = last5.length > 0 ? last5.reduce((a, b) => a + b, 0) / last5.length / 100 : null;
  const d2eLatest = last?.debt_to_equity ?? null;
  const pe = f.current?.pe ?? null;
  const bvps = f.current?.book_value_per_share ?? null;
  const price = f.current?.price ?? null;
  const pb = bvps && price && bvps > 0 ? price / bvps : null;
  const earningsYield = pe && pe > 0 ? 1 / pe : null;
  const pegProxy = pe && patCagr5y && patCagr5y > 0 ? pe / (patCagr5y * 100) : null;
  return { patCagr5y, revCagr5y, roceAvg5y, d2eLatest, pe, pb, earningsYield, pegProxy };
}

/** Greenblatt: high ROIC + high earnings yield. */
function scoreGreenblatt(d: FundDerived, medians: Medians): number {
  let score = 50;
  if (d.roceAvg5y !== null) {
    if (d.roceAvg5y > medians.roce) score += 25;
    if (d.roceAvg5y > medians.roce * 1.3) score += 10;
  }
  if (d.earningsYield !== null) {
    if (d.earningsYield > medians.earningsYield) score += 15;
    if (d.earningsYield > medians.earningsYield * 1.3) score += 5;
  }
  return Math.max(0, Math.min(100, score));
}

/** Naren: contrarian-value — low PE, low PB, healthy ROCE. */
function scoreNaren(d: FundDerived, medians: Medians): number {
  let score = 50;
  if (d.pe !== null && d.pe > 0) {
    if (d.pe < medians.pe) score += 15;
    if (d.pe < medians.pe * 0.75) score += 10;
  }
  if (d.pb !== null && d.pb > 0) {
    if (d.pb < medians.pb) score += 10;
    if (d.pb < medians.pb * 0.75) score += 5;
  }
  if (d.roceAvg5y !== null) {
    if (d.roceAvg5y > medians.roce * 0.8) score += 10;
  }
  return Math.max(0, Math.min(100, score));
}

/** Lynch: PEG ≤ 1, EPS growth ≥ target, low debt. */
function scoreLynch(d: FundDerived, targetCagrPct: number): number {
  let score = 50;
  if (d.pegProxy !== null) {
    if (d.pegProxy <= 1) score += 25;
    else if (d.pegProxy <= 1.5) score += 10;
    else if (d.pegProxy > 3) score -= 10;
  }
  if (d.patCagr5y !== null) {
    if (d.patCagr5y >= targetCagrPct / 100) score += 15;
    else if (d.patCagr5y >= (targetCagrPct / 100) * 0.7) score += 5;
  }
  if (d.d2eLatest !== null) {
    if (d.d2eLatest < 0.3) score += 10;
    else if (d.d2eLatest > 1) score -= 10;
  }
  return Math.max(0, Math.min(100, score));
}

type Medians = {
  roce: number;
  pe: number;
  pb: number;
  earningsYield: number;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function deriveMedians(allDerived: FundDerived[]): Medians {
  const roce = allDerived.map((d) => d.roceAvg5y).filter((x): x is number => x !== null);
  const pe = allDerived.map((d) => d.pe).filter((x): x is number => x !== null && x > 0 && x < 200);
  const pb = allDerived.map((d) => d.pb).filter((x): x is number => x !== null && x > 0);
  const ey = allDerived.map((d) => d.earningsYield).filter((x): x is number => x !== null && x > 0);
  return {
    roce: median(roce) || 0.15,
    pe: median(pe) || 22,
    pb: median(pb) || 3,
    earningsYield: median(ey) || 0.05,
  };
}

function inferMarketCapBucket(f: Fundamentals | null, mcapRanksByMcap?: number): MarketCapBucket {
  // We don't have a global mcap ranking in the universe.csv, so use raw mcap
  // crore thresholds aligned with SEBI definitions for v1:
  //   largecap: top 100 ≈ ≥ ~₹50,000Cr
  //   midcap:   101–250 ≈ ~₹17,000Cr–₹50,000Cr
  //   smallcap: < ₹17,000Cr (above ₹500Cr)
  const mcap = f?.current?.market_cap_cr ?? null;
  if (mcap === null || !Number.isFinite(mcap) || mcap <= 0) return 'unknown';
  if (mcap >= 50_000) return 'largecap';
  if (mcap >= 17_000) return 'midcap';
  if (mcap >= 500) return 'smallcap';
  return 'unknown';
}

function buildThesis(
  row: UniverseRow,
  d: FundDerived,
  forecastedCagr: number,
  fwSupport: { framework: string; score: number; alpha: number }[],
): { oneLiner: string; md: string } {
  const fwNames = fwSupport.map((f) => f.framework).join(' + ') || 'screener';
  const oneLiner = `${row.companyName} — ${(forecastedCagr * 100).toFixed(0)}% forecast CAGR (${fwNames})`;
  const lines: string[] = [];
  lines.push(
    `**${row.companyName}** (${row.sector}) clears the ${fwNames} backtested framework${fwSupport.length > 1 ? 's' : ''}, which together delivered the highest alpha vs Nifty 50 across 4 cycles (2016/2020/2023/2026).`,
  );
  if (d.patCagr5y !== null) {
    lines.push(
      `5-year PAT CAGR of ${(d.patCagr5y * 100).toFixed(0)}% with ${d.roceAvg5y !== null ? `ROCE averaging ${(d.roceAvg5y * 100).toFixed(0)}%` : 'healthy capital efficiency'}.`,
    );
  }
  if (d.pe !== null) {
    lines.push(
      `Trades at ${d.pe.toFixed(0)}× P/E${d.pegProxy !== null ? ` (PEG ${d.pegProxy.toFixed(2)})` : ''}${d.d2eLatest !== null ? `, debt/equity ${d.d2eLatest.toFixed(2)}` : ''}.`,
    );
  }
  lines.push(
    `Forecasted 5-year CAGR ${(forecastedCagr * 100).toFixed(0)}% based on PAT trajectory + quality multiplier.`,
  );
  return { oneLiner, md: lines.join(' ') };
}

export function screenUniverse(opts: ScreenOptions): ScreenedCandidate[] {
  const universeRoot = resolve(opts.universeRoot ?? DEFAULT_UNIVERSE_ROOT);
  const fundamentalsRoot = resolve(opts.fundamentalsRoot ?? DEFAULT_FUNDAMENTALS_ROOT);
  const resultsRoot = resolve(opts.backtestResultsRoot ?? DEFAULT_RESULTS_ROOT);
  const limit = opts.limit ?? 50;

  const universe = loadUniverse(universeRoot);
  if (universe.length === 0) return [];

  const summaries = loadFrameworkSummaries(resultsRoot);
  const picks: Record<Framework, Map<string, number>> = {
    greenblatt: loadFrameworkPicks(resultsRoot, 'greenblatt'),
    naren: loadFrameworkPicks(resultsRoot, 'naren'),
    lynch: loadFrameworkPicks(resultsRoot, 'lynch'),
  };

  // First pass: load fundamentals + derive metrics for every symbol with data.
  const enriched: { row: UniverseRow; fund: Fundamentals; derived: FundDerived }[] = [];
  for (const row of universe) {
    const fund = loadFundamentals(row.symbol, fundamentalsRoot);
    if (!fund || !fund.annual) continue;
    const derived = deriveMetrics(fund);
    if (derived.patCagr5y === null && derived.revCagr5y === null) continue;
    enriched.push({ row, fund, derived });
  }
  if (enriched.length === 0) return [];

  const medians = deriveMedians(enriched.map((e) => e.derived));

  const totalAlpha =
    summaries.greenblatt.alphaVsNifty50 +
    summaries.naren.alphaVsNifty50 +
    summaries.lynch.alphaVsNifty50;

  const out: ScreenedCandidate[] = [];
  const targetFrac = opts.targetCagrPct / 100;
  const minAcceptable = targetFrac * 0.95;

  for (const { row, fund, derived } of enriched) {
    // Per-framework scores: prefer the canonical backtest picks file when the
    // symbol appears there; otherwise score it via the rubric.
    const fwScores: Record<Framework, number> = {
      greenblatt: picks.greenblatt.get(row.symbol) ?? scoreGreenblatt(derived, medians),
      naren: picks.naren.get(row.symbol) ?? scoreNaren(derived, medians),
      lynch: picks.lynch.get(row.symbol) ?? scoreLynch(derived, opts.targetCagrPct),
    };

    // Composite weighted by backtested alpha (higher alpha → bigger vote).
    const compositeScore =
      (fwScores.greenblatt * summaries.greenblatt.alphaVsNifty50 +
        fwScores.naren * summaries.naren.alphaVsNifty50 +
        fwScores.lynch * summaries.lynch.alphaVsNifty50) /
      (totalAlpha || 1);

    const fc = forecastGrowth({
      symbol: row.symbol,
      fundamentals: fund,
      firedRules: [],
    });
    const forecastedCagr = fc.yearFive > 0 ? Math.pow(1 + fc.yearFive, 1 / 5) - 1 : 0;

    if (forecastedCagr < minAcceptable) continue;

    const fwSupport = (Object.keys(fwScores) as Framework[])
      .map((fw) => ({
        framework: fw,
        score: fwScores[fw],
        alpha: summaries[fw].alphaVsNifty50,
      }))
      .filter((s) => s.score >= 60)
      .sort((a, b) => b.score * b.alpha - a.score * a.alpha);

    const thesis = buildThesis(row, derived, forecastedCagr, fwSupport);

    const price = fund.current?.price ?? null;
    const entryFairPrice = price !== null ? Number((price * 0.95).toFixed(2)) : null;
    const entryStrongBuy = price !== null ? Number((price * 0.85).toFixed(2)) : null;

    out.push({
      symbol: row.symbol,
      companyName: row.companyName,
      sector: row.sector,
      marketCapBucket: inferMarketCapBucket(fund),
      compositeScore: Number(compositeScore.toFixed(2)),
      forecastedCagr: Number(forecastedCagr.toFixed(4)),
      confidence: fc.confidence,
      frameworkSupport: fwSupport,
      thesisOneLiner: thesis.oneLiner,
      thesisMd: thesis.md,
      entryFairPrice,
      entryStrongBuy,
      topRules: [],
    });
  }

  out.sort((a, b) => b.compositeScore - a.compositeScore);
  return out.slice(0, limit);
}
