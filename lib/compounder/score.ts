/**
 * Compounder profile aggregation — weighted score, classification, and an
 * implied 10y return.
 *
 * Calibration math (deliberate, documented):
 *   - A "passes everything" weightedScore = 1.0 maps to 25% CAGR (≈ 9.3× in 10y).
 *   - A "fails everything" weightedScore = 0.0 maps to 6% CAGR (≈ 1.79× in 10y;
 *     roughly the bond rate, since we still assume the company exists).
 *   - Linear interpolation between the two: cagr = 0.06 + 0.19 × weightedScore.
 *     Each whole-factor failure (worth ~0.1 weight) shaves ~1.9% CAGR; a fail
 *     vs partial swing (~0.05 weight) shaves ~1%; an unknown (~0.06 of full)
 *     shaves ~1.2%. Matches the user's "2-4% per fail" intuition once factor
 *     weights are accounted for.
 *
 * Classification thresholds (per spec):
 *   ≥ 0.75 → "7-9x candidate"
 *   ≥ 0.55 → "solid compounder"
 *   ≥ 0.35 → "mediocre"
 *   else  → "broken"
 *
 * Coherence with existing growthForecast:
 *   computeBlendedFiveYearCagr() blends the 5y growth forecast (annualised)
 *   with the compounder-implied CAGR at 0.5/0.5 weights. This is the headline
 *   number the UI displays. The two inputs:
 *     - growthForecast.yearFive captures recent earnings momentum + PE drag
 *     - compounder profile captures structural quality + reinvestment math
 *   Blending hedges against either signal being temporarily distorted.
 */

import type { Fundamentals } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';

import {
  FACTORS,
  type CompounderFactor,
  type FactorVerdict,
  type SymbolInputs,
} from '@/lib/compounder/factors';

export type CompounderClassification =
  | '7-9x candidate'
  | 'solid compounder'
  | 'mediocre'
  | 'broken';

/** Serializable factor metadata — same as `CompounderFactor` but without the
 *  evaluator function, so it can cross the RSC server→client boundary.
 */
export type CompounderFactorMeta = Omit<CompounderFactor, 'evaluator'>;

export type CompounderProfile = {
  symbol: string;
  factors: { factor: CompounderFactorMeta; verdict: FactorVerdict }[];
  passCount: number;
  partialCount: number;
  failCount: number;
  unknownCount: number;
  weightedScore: number; // 0..1
  classification: CompounderClassification;
  estimatedTenYearReturn: number; // multiple, e.g. 7.5 means 7.5×
  estimatedAnnualisedCagr: number; // 0..1
  caveats: string[];
};

// --- Calibration constants -------------------------------------------------

const CAGR_MIN = 0.06;
const CAGR_MAX = 0.25;

export function classify(weightedScore: number): CompounderClassification {
  if (weightedScore >= 0.75) return '7-9x candidate';
  if (weightedScore >= 0.55) return 'solid compounder';
  if (weightedScore >= 0.35) return 'mediocre';
  return 'broken';
}

export function impliedAnnualisedCagr(weightedScore: number): number {
  const clamped = Math.max(0, Math.min(1, weightedScore));
  return CAGR_MIN + (CAGR_MAX - CAGR_MIN) * clamped;
}

export function tenYearMultiple(cagr: number): number {
  return Math.pow(1 + cagr, 10);
}

export type ComputeProfileInput = {
  symbol: string;
  sector: string;
  fundamentals: Fundamentals | null;
  firedRules: (FiredRule & { tags?: string[] })[];
  /**
   * Valuation context — passed through to `evalValuation`. When omitted the
   * valuation factor reports 'unknown' (graceful default).
   */
  valuation?: SymbolInputs['valuation'];
};

export function computeCompounderProfile(input: ComputeProfileInput): CompounderProfile {
  const symInput: SymbolInputs = {
    symbol: input.symbol,
    sector: input.sector,
    fundamentals: input.fundamentals,
    firedRules: input.firedRules,
    valuation: input.valuation,
  };

  // Strip the `evaluator` function at runtime so the result is plain data and
  // can be passed from a Server Component into a Client Component without RSC's
  // "Functions cannot be passed directly" error.
  const evaluated: { factor: CompounderFactorMeta; verdict: FactorVerdict }[] = FACTORS.map(
    (factor) => ({
      factor: {
        id: factor.id,
        label: factor.label,
        description: factor.description,
        citation: factor.citation,
        weight: factor.weight,
      },
      verdict: factor.evaluator(symInput),
    }),
  );

  let passCount = 0;
  let partialCount = 0;
  let failCount = 0;
  let unknownCount = 0;
  const caveats: string[] = [];
  let weighted = 0;

  for (const { factor, verdict } of evaluated) {
    weighted += factor.weight * verdict.score;
    switch (verdict.status) {
      case 'pass':
        passCount += 1;
        break;
      case 'partial':
        partialCount += 1;
        break;
      case 'fail':
        failCount += 1;
        break;
      case 'unknown':
        unknownCount += 1;
        caveats.push(`${factor.label}: ${verdict.rationale}`);
        break;
    }
  }

  const weightedScore = Math.max(0, Math.min(1, weighted));
  const cls = classify(weightedScore);
  const cagr = impliedAnnualisedCagr(weightedScore);
  const tenX = tenYearMultiple(cagr);

  return {
    symbol: input.symbol,
    factors: evaluated,
    passCount,
    partialCount,
    failCount,
    unknownCount,
    weightedScore: Number(weightedScore.toFixed(4)),
    classification: cls,
    estimatedTenYearReturn: Number(tenX.toFixed(2)),
    estimatedAnnualisedCagr: Number(cagr.toFixed(4)),
    caveats,
  };
}

/**
 * Backwards-compatible alias — `CompounderProfile` is already RSC-serialisable
 * since `computeCompounderProfile` strips the `evaluator` function at runtime.
 * Existing call sites that imported `CompounderProfileView` keep working.
 */
export type CompounderProfileView = CompounderProfile;

/** Identity passthrough — kept for call-site compatibility. */
export function toCompounderProfileView(p: CompounderProfile): CompounderProfileView {
  return p;
}

/**
 * Blend the compounder-implied CAGR with the existing growthForecast.yearFive
 * (annualised). 50/50 — the two signals hedge each other. Returns annualised
 * decimal CAGR (e.g. 0.215 = 21.5%).
 */
export function blendedCagr(profileCagr: number, fiveYearForecast: number | null): number {
  if (fiveYearForecast === null || !Number.isFinite(fiveYearForecast)) return profileCagr;
  // yearFive is the cumulative 5y return; convert to annualised.
  const ann = fiveYearForecast > -1 ? Math.pow(1 + fiveYearForecast, 1 / 5) - 1 : -0.2;
  return 0.5 * profileCagr + 0.5 * ann;
}
