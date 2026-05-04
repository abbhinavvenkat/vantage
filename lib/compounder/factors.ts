/**
 * Compounder Thesis Framework — factor definitions + heuristic evaluators.
 *
 * Mental model: for a stock to compound at 20%+ for a decade (delivering 7-9×),
 * it needs to clear a structured set of business-quality gates. Each factor
 * carries a citation back to either `data/codex/synthesized/consensus.md` or a
 * specific stalwart profile in `data/investor_stalwarts/`.
 *
 * No external API calls. No LLM. Pure functions over pre-loaded artefacts.
 *
 * Factor selection (10 total; 5 user-asked + 5 from the 63-investor synthesis):
 *   1. tam            — Large addressable market         [consensus §1.4 reinvestment runway]
 *   2. execution      — 5y revenue + PAT CAGR ≥ 15%      [consensus §1.4 ROIC compounding mechanism]
 *   3. roce           — 5y avg ROCE ≥ 18%                [consensus §1.4 — Mukherjea/Pulak/Akre thresholds]
 *   4. moat           — Durable competitive advantage    [consensus §1.6 — Dorsey/Greenwald moat taxonomy]
 *   5. management     — Promoter/exec integrity          [consensus §1.1 + §4.1 — universal gate]
 *   6. pricing_power  — Stable/expanding gross margin    [stalwart:akre.md — three-legged stool]
 *   7. reinvestment   — PAT growth ≥ ROCE × 0.5 (Akre)   [consensus §1.4 — ROIC × CAP framework]
 *   8. fcf_conversion — CFO/PAT ≥ 0.7 over last 3y       [consensus §1.5 — Mukherjea forensic screen]
 *   9. capital_alloc  — No equity dilution; payout < 50% [stalwart:buffett.md — capital allocation]
 *  10. cyclicality    — Non-cyclical preferred           [consensus §3.5 — compounder vs cycle split]
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Fundamentals, AnnualRow } from '@/lib/decisions/growthForecast';
import type { FiredRule } from '@/lib/decisions/score';
import {
  checklistItemVerdict,
  checklistPassRate,
  concallToneScore,
  countMatches,
  latestAR,
  latestConcall,
  loadSymbolBundle,
  sectorPriorVerdict,
  type FactorId,
} from '@/lib/compounder/resolvers';
import { resolveSymbolThemes } from '@/lib/compounder/thematicTailwinds';

export type FactorStatus = 'pass' | 'fail' | 'partial' | 'unknown';

export type FactorVerdict = {
  status: FactorStatus;
  score: number; // 0..1 (partial credit)
  rationale: string;
  evidence: string[];
};

export type SymbolInputs = {
  symbol: string;
  sector: string;
  fundamentals: Fundamentals | null;
  firedRules: (FiredRule & { tags?: string[] })[];
  // Pre-loaded refs (default-loaded by helpers below if not provided).
  sectorTamRef?: SectorTamRef;
  promoterSitgRef?: PromoterSitgRef;
  /**
   * Valuation context — caller computes once via lib/valuation/peStats and
   * passes here. When omitted, the valuation factor returns 'unknown' rather
   * than fabricating a verdict. The numbers here are the same ones the
   * decision engine uses for its valuation gates.
   */
  valuation?: {
    pe: number | null;
    peg: number | null;
    peVsSectorMedian: number | null;
    peSectorMedian: number | null;
    pe5yMedian: number | null;
    pe10yPercentile: number | null;
    earningsYieldMinusGsec: number | null;
  };
};

export type CompounderFactor = {
  id: string;
  label: string;
  description: string;
  citation: string;
  weight: number; // 0..1 importance for compounding
  evaluator: (input: SymbolInputs) => FactorVerdict;
};

// -----------------------------------------------------------------------------
// Reference data loaders.
// -----------------------------------------------------------------------------

export type SectorTamTier = 'large' | 'mid' | 'niche' | 'saturated';
export type SectorTamRef = {
  tiers: Record<string, { tier: SectorTamTier; note: string }>;
};
export type PromoterSitgEntry = {
  status: 'strong' | 'partial' | 'weak' | 'unknown';
  note?: string;
};
export type PromoterSitgRef = { entries: Record<string, PromoterSitgEntry> };

const SECTOR_TAM_PATH = 'data/refs/sector_tam.json';
const PROMOTER_SITG_PATH = 'data/refs/promoter_sitg.json';

let _sectorTamCache: SectorTamRef | null = null;
let _promoterSitgCache: PromoterSitgRef | null = null;

export function loadSectorTam(path = SECTOR_TAM_PATH): SectorTamRef {
  if (_sectorTamCache) return _sectorTamCache;
  if (!existsSync(path)) return { tiers: {} };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as SectorTamRef;
    _sectorTamCache = raw;
    return raw;
  } catch {
    return { tiers: {} };
  }
}

export function loadPromoterSitg(path = PROMOTER_SITG_PATH): PromoterSitgRef {
  if (_promoterSitgCache) return _promoterSitgCache;
  if (!existsSync(path)) return { entries: {} };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as PromoterSitgRef;
    _promoterSitgCache = raw;
    return raw;
  } catch {
    return { entries: {} };
  }
}

// Allow tests to inject without polluting global cache.
export function _resetCachesForTest(): void {
  _sectorTamCache = null;
  _promoterSitgCache = null;
}

// -----------------------------------------------------------------------------
// Helpers over fundamentals.
// -----------------------------------------------------------------------------

function years(annual: Record<string, AnnualRow>): string[] {
  return Object.keys(annual).sort();
}

function cagr(
  start: number | null | undefined,
  end: number | null | undefined,
  n: number,
): number | null {
  if (
    start == null ||
    end == null ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    n <= 0 ||
    start <= 0 ||
    end <= 0
  ) {
    return null;
  }
  return Math.pow(end / start, 1 / n) - 1;
}

function avgNum(xs: (number | null | undefined)[]): number | null {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function lastN(annual: Record<string, AnnualRow>, n: number): AnnualRow[] {
  const ks = years(annual);
  return ks
    .slice(-n)
    .map((k) => annual[k]!)
    .filter((x): x is AnnualRow => x !== undefined);
}

function tagFires(rules: (FiredRule & { tags?: string[] })[], pattern: RegExp): boolean {
  return rules.some((r) => (r.tags ?? []).some((t) => pattern.test(t)));
}

/**
 * Last-resort fallback that GUARANTEES a non-unknown verdict by consulting the
 * sector_priors.json file. The returned verdict's evidence array is augmented
 * with any text-based hints we already gathered so the UI can still show context.
 */
function fallbackToPrior(
  sector: string,
  factorId: FactorId,
  extraEvidence: string[] = [],
  reasonPrefix?: string,
): FactorVerdict {
  const v = sectorPriorVerdict(sector, factorId);
  return {
    status: v.status,
    score: v.score,
    rationale: reasonPrefix ? `${reasonPrefix}; ${v.rationale}` : v.rationale,
    evidence: [...extraEvidence, ...v.evidence],
  };
}

// Keyword libraries used by AR-text resolvers below. All deterministic regex.
const MOAT_PHRASES = [
  /\bbrand\b/i,
  /\bswitching cost/i,
  /\bnetwork effect/i,
  /\bscale advantage|economies of scale/i,
  /\bregulatory (moat|barrier|licen[cs]e)/i,
  /\bpatent|exclusivity\b/i,
  /\bdistribution moat|distribution reach/i,
  /\bproprietary (process|technology)/i,
  /\bmarket leader|leadership position/i,
];
const PRICING_POWER_PHRASES = [
  /\bprice (hike|increase|action|raise|rise)/i,
  /\bpassed (on|through) (the )?(input|raw[- ]material|cost)/i,
  /\bpremium (mix|positioning|pricing)/i,
  /\binelastic\b/i,
  /\bpricing power\b/i,
  /\brealisation (improved|expanded|grew)/i,
];
const REINVESTMENT_PHRASES = [
  /\bcapacity (expansion|addition|ramp)/i,
  /\bnew (geograph|plant|facility|line)/i,
  /\bcapex (cycle|programme|plan)/i,
  /\bgreenfield|brownfield/i,
  /\bnew product launch|portfolio expansion/i,
  /\binternational expansion|global footprint/i,
];
const TAM_PHRASES = [
  /\bglobal TAM|addressable market|white space/i,
  /\bunder[- ]penetrat/i,
  /\bmulti[- ]decad|long runway|long[- ]term opportunity/i,
  /\bformali[sz]ation|organi[sz]ed share/i,
];
const RED_FLAG_PHRASES_GOV = [
  /\brelated[- ]party\b/i,
  /\bauditor (qualif|resign)/i,
  /\bSEBI|SFIO|ED enquiry|investigation/i,
  /\bpledg(e|ed|ing)/i,
];
const POSITIVE_MGMT_PHRASES = [
  /\bdeep (institutional|domain) (DNA|expertise)/i,
  /\bclean (audit|opinion)/i,
  /\bunqualified (audit|opinion)/i,
  /\bdisciplined (capital|allocation|capex)/i,
  /\btrack record\b/i,
  /\btransparent (disclosure|communication)/i,
];

// -----------------------------------------------------------------------------
// Evaluators.
// -----------------------------------------------------------------------------

/**
 * TAM resolver chain:
 *   1. sector_tam.json tier mapping (primary)
 *   2. AR `growth_drivers_md` + `revenue_mix` segment text scan for TAM phrases
 *   3. sector prior fallback (always returns a verdict)
 */
function evalTam(input: SymbolInputs): FactorVerdict {
  const ref = input.sectorTamRef ?? loadSectorTam();
  const entry = ref.tiers[input.sector];
  if (entry) {
    switch (entry.tier) {
      case 'large':
        return {
          status: 'pass',
          score: 1.0,
          rationale: `Sector "${input.sector}" is a large-TAM tier — long reinvestment runway.`,
          evidence: [entry.note],
        };
      case 'mid':
        return {
          status: 'partial',
          score: 0.6,
          rationale: `Sector "${input.sector}" is mid-TAM — meaningful runway but not 10y+ structural.`,
          evidence: [entry.note],
        };
      case 'niche':
        return {
          status: 'partial',
          score: 0.4,
          rationale: `Sector "${input.sector}" is niche — TAM constrained.`,
          evidence: [entry.note],
        };
      case 'saturated':
        return {
          status: 'fail',
          score: 0.1,
          rationale: `Sector "${input.sector}" is saturated — limited reinvestment runway.`,
          evidence: [entry.note],
        };
    }
  }
  // Step 2: AR text scan
  const ar = latestAR(input.symbol);
  const tamHits =
    countMatches(ar?.growth_drivers_md, TAM_PHRASES) +
    countMatches(ar?.business_model_md, TAM_PHRASES);
  const evidence: string[] = [];
  if (ar) evidence.push(`AR ${ar.fy}: TAM/runway phrase hits = ${tamHits}`);
  if (tamHits >= 2) {
    return {
      status: 'pass',
      score: 0.85,
      rationale: 'AR explicitly cites long runway / under-penetration / global TAM.',
      evidence,
    };
  }
  if (tamHits === 1) {
    return {
      status: 'partial',
      score: 0.6,
      rationale: 'AR mentions runway/TAM in passing — directional only.',
      evidence,
    };
  }
  // Step 3: sector prior fallback
  return fallbackToPrior(input.sector, 'tam', evidence, 'sector unmapped & AR silent on TAM');
}

/**
 * Execution resolver chain:
 *   1. Fundamentals: 5y revenue + PAT CAGR (lower-of-two as core driver)
 *   2. Management accountability `consistency_score` modulates verdict
 *      (≥ 0.8 ⇒ promote partial→pass, < 0.5 ⇒ demote pass→partial, ≤ 0.3 ⇒ fail)
 *   3. AR `checklist_results` revenue-CAGR + execution items
 *   4. Sector prior fallback
 */
function evalExecution(input: SymbolInputs): FactorVerdict {
  const f = input.fundamentals;
  const bundle = loadSymbolBundle(input.symbol);
  const acc = bundle.accountability;
  const ar = bundle.ar[0] ?? null;

  if (f && f.annual && years(f.annual).length >= 3) {
    const ks = years(f.annual);
    const span = Math.min(5, ks.length - 1);
    const last = f.annual[ks[ks.length - 1]!]!;
    const first = f.annual[ks[ks.length - 1 - span]!]!;
    const revC = cagr(first.sales_cr, last.sales_cr, span);
    const patC = cagr(first.pat_cr, last.pat_cr, span);

    const ev: string[] = [];
    if (revC !== null) ev.push(`Revenue ${span}y CAGR ${(revC * 100).toFixed(1)}%`);
    if (patC !== null) ev.push(`PAT ${span}y CAGR ${(patC * 100).toFixed(1)}%`);

    if (revC !== null || patC !== null) {
      const driver = revC !== null && patC !== null ? Math.min(revC, patC) : (revC ?? patC ?? 0);

      let verdict: FactorVerdict;
      if (driver >= 0.15) {
        verdict = {
          status: 'pass',
          score: 1.0,
          rationale: `Both revenue and PAT compounding ≥ 15%/yr over ${span}y.`,
          evidence: ev,
        };
      } else if (driver >= 0.1) {
        verdict = {
          status: 'partial',
          score: 0.6,
          rationale: `Compounding 10–15%/yr over ${span}y — solid but below the 7-9× bar.`,
          evidence: ev,
        };
      } else {
        verdict = {
          status: 'fail',
          score: 0.2,
          rationale: `Compounding < 10%/yr over ${span}y — not a multi-bagger trajectory.`,
          evidence: ev,
        };
      }
      // Modulate by management accountability consistency score.
      if (acc) {
        ev.push(`Mgmt accountability consistency = ${acc.consistency_score.toFixed(2)}`);
        if (acc.consistency_score >= 0.8 && verdict.status === 'partial') {
          verdict = {
            status: 'pass',
            score: Math.max(verdict.score, 0.85),
            rationale: `${verdict.rationale} Management has delivered guidance consistently — promoted to pass.`,
            evidence: ev,
          };
        } else if (acc.consistency_score < 0.3 && verdict.status === 'pass') {
          verdict = {
            status: 'partial',
            score: 0.6,
            rationale: `${verdict.rationale} But guidance-vs-actuals consistency is low (${acc.consistency_score.toFixed(2)}) — demoted.`,
            evidence: ev,
          };
        }
      }
      return verdict;
    }
  }

  // Step 3: AR checklist
  const cl = checklistPassRate(ar);
  if (cl.total > 0) {
    const passShare = cl.pass / Math.max(1, cl.total - cl.unknown);
    const ev = [`AR ${ar?.fy} checklist: ${cl.pass}/${cl.total} pass`];
    if (passShare >= 0.7) {
      return {
        status: 'pass',
        score: 0.8,
        rationale: 'AR checklist majority-pass — execution evident.',
        evidence: ev,
      };
    }
    if (passShare >= 0.4) {
      return {
        status: 'partial',
        score: 0.55,
        rationale: 'AR checklist mixed — execution patchy.',
        evidence: ev,
      };
    }
    return {
      status: 'fail',
      score: 0.25,
      rationale: 'AR checklist majority-fail — execution weak.',
      evidence: ev,
    };
  }

  // Step 4: sector prior
  return fallbackToPrior(input.sector, 'execution', [], 'no fundamentals or AR signal');
}

/**
 * ROCE resolver chain:
 *   1. Fundamentals 5y avg ROCE (primary)
 *   2. ROE proxy when ROCE not reported (banks/NBFCs)
 *   3. AR `key_numbers.roce` direct read
 *   4. AR checklist "ROCE > 15%" item
 *   5. Sector prior fallback
 */
function evalRoce(input: SymbolInputs): FactorVerdict {
  const f = input.fundamentals;
  const evidence: string[] = [];
  if (f && f.annual) {
    const last5 = lastN(f.annual, 5);
    const roces = last5.map((r) => r.roce_pct ?? null);
    const avg = avgNum(roces);
    if (avg !== null) {
      const ev = [`5y avg ROCE ${avg.toFixed(1)}%`];
      if (avg >= 18) {
        return {
          status: 'pass',
          score: 1.0,
          rationale: 'ROCE ≥ 18% over 5y — capital-efficient.',
          evidence: ev,
        };
      }
      if (avg >= 12) {
        return {
          status: 'partial',
          score: 0.55,
          rationale: 'ROCE 12–18% — adequate but below quality-compounder bar.',
          evidence: ev,
        };
      }
      return {
        status: 'fail',
        score: 0.15,
        rationale: 'ROCE < 12% — value-destructive at high growth.',
        evidence: ev,
      };
    }
    // Step 2: ROE proxy for banks/NBFCs
    const roes = last5.map((r) => r.roe_pct ?? null);
    const roeAvg = avgNum(roes);
    if (roeAvg !== null) {
      const ev = [`5y avg ROE ${roeAvg.toFixed(1)}% (ROCE proxy for financials)`];
      if (roeAvg >= 15) {
        return {
          status: 'pass',
          score: 0.85,
          rationale: 'ROE ≥ 15% — strong capital efficiency on equity (banking proxy).',
          evidence: ev,
        };
      }
      if (roeAvg >= 10) {
        return {
          status: 'partial',
          score: 0.55,
          rationale: 'ROE 10–15% — adequate for a financial.',
          evidence: ev,
        };
      }
      return {
        status: 'fail',
        score: 0.2,
        rationale: 'ROE < 10% — financial earning below cost of equity.',
        evidence: ev,
      };
    }
  }

  // Step 3: AR key_numbers
  const ar = latestAR(input.symbol);
  const arRoce = ar?.key_numbers?.roce;
  if (typeof arRoce === 'number') {
    const pct = arRoce > 1 ? arRoce : arRoce * 100;
    evidence.push(`AR ${ar?.fy} key_numbers.roce = ${pct.toFixed(1)}%`);
    if (pct >= 18)
      return { status: 'pass', score: 0.9, rationale: 'AR reports ROCE ≥ 18%.', evidence };
    if (pct >= 12)
      return {
        status: 'partial',
        score: 0.55,
        rationale: 'AR reports ROCE 12–18%.',
        evidence,
      };
    return { status: 'fail', score: 0.2, rationale: 'AR reports ROCE < 12%.', evidence };
  }
  // Step 4: AR checklist "ROCE > 15%" item
  const cv = checklistItemVerdict(ar, /ROCE\s*>\s*15/i);
  if (cv === true) {
    evidence.push(`AR ${ar?.fy} checklist: "ROCE > 15% for 5 years" passes.`);
    return {
      status: 'pass',
      score: 0.85,
      rationale: 'AR checklist confirms ROCE > 15%.',
      evidence,
    };
  }
  if (cv === false) {
    evidence.push(`AR ${ar?.fy} checklist: "ROCE > 15% for 5 years" fails.`);
    return {
      status: 'fail',
      score: 0.25,
      rationale: 'AR checklist marks ROCE below 15%.',
      evidence,
    };
  }
  // Step 5: sector prior
  return fallbackToPrior(input.sector, 'roce', evidence, 'ROCE not reported');
}

/**
 * Moat resolver chain:
 *   1. Codex `firedRules` tagged quality|moat|compounder ⇒ pass
 *   2. Sustained EBITDA margin ≥ 20% over 3y ⇒ partial (cost/pricing moat proxy)
 *   3. AR `management_quality_md` + `growth_drivers_md` + `business_model_md`
 *      moat-phrase scan
 *   4. Sector prior fallback
 */
function evalMoat(input: SymbolInputs): FactorVerdict {
  const ev: string[] = [];
  // Primary signal: a fired rule with quality/moat/compounder tags.
  const moatTagFired = tagFires(input.firedRules, /quality|moat|compounder/i);
  if (moatTagFired) {
    const tags = new Set<string>();
    for (const r of input.firedRules) (r.tags ?? []).forEach((t) => tags.add(t));
    ev.push(`Quality/moat rule fired with tags: ${[...tags].slice(0, 4).join(', ')}`);
    return {
      status: 'pass',
      score: 1.0,
      rationale: 'Codex quality/moat rule fired for this symbol.',
      evidence: ev,
    };
  }
  // Backstop: EBITDA margin elevated for 3+ years signals pricing/cost moat.
  const f = input.fundamentals;
  let ebitdaSustained = false;
  if (f && f.annual) {
    const last3 = lastN(f.annual, 3);
    const mgs = last3.map((r) =>
      typeof r.ebitda_cr === 'number' && typeof r.sales_cr === 'number' && r.sales_cr > 0
        ? r.ebitda_cr / r.sales_cr
        : null,
    );
    const ok = mgs.filter((x): x is number => x != null);
    if (ok.length >= 3 && ok.every((m) => m >= 0.2)) {
      const avg = avgNum(ok)!;
      ev.push(`3y avg EBITDA margin ${(avg * 100).toFixed(0)}% sustained ≥ 20%`);
      ebitdaSustained = true;
    }
  }
  // Step 3: AR moat-phrase scan
  const ar = latestAR(input.symbol);
  const moatHits =
    countMatches(ar?.management_quality_md, MOAT_PHRASES) +
    countMatches(ar?.growth_drivers_md, MOAT_PHRASES) +
    countMatches(ar?.business_model_md, MOAT_PHRASES);
  if (ar) ev.push(`AR ${ar.fy}: moat-phrase hits = ${moatHits}`);

  if (ebitdaSustained && moatHits >= 2) {
    return {
      status: 'pass',
      score: 0.85,
      rationale:
        'Sustained high EBITDA margin AND AR explicitly cites moat sources (brand/scale/regulatory).',
      evidence: ev,
    };
  }
  if (ebitdaSustained) {
    return {
      status: 'partial',
      score: 0.6,
      rationale:
        'Sustained high EBITDA margin implies structural advantage; AR text light on explicit moat language.',
      evidence: ev,
    };
  }
  if (moatHits >= 3) {
    return {
      status: 'pass',
      score: 0.8,
      rationale: 'AR cites multiple moat sources (brand/switching cost/scale/regulatory).',
      evidence: ev,
    };
  }
  if (moatHits >= 1) {
    return {
      status: 'partial',
      score: 0.55,
      rationale: 'AR mentions a moat source — directional but not strong.',
      evidence: ev,
    };
  }
  // Step 4: sector prior
  return fallbackToPrior(input.sector, 'moat', ev, 'no moat rule, no margin proxy, no AR phrase');
}

function evalManagement(input: SymbolInputs): FactorVerdict {
  const ev: string[] = [];
  // Negative signals first — red-flag rule with governance tags = fail.
  const redFired = input.firedRules.some(
    (r) => (r.tags ?? []).some((t) => /red[_-]?flag|governance/i.test(t)) && r.action === 'exit',
  );
  if (redFired) {
    ev.push('Governance/red-flag exit rule fired.');
    return {
      status: 'fail',
      score: 0.1,
      rationale: 'Codex flagged a governance red flag.',
      evidence: ev,
    };
  }
  // Manual override from promoter SITG ref.
  const ref = input.promoterSitgRef ?? loadPromoterSitg();
  const sitg = ref.entries[input.symbol];
  if (sitg && sitg.status !== 'unknown') {
    const map: Record<PromoterSitgEntry['status'], FactorVerdict> = {
      strong: {
        status: 'pass',
        score: 1.0,
        rationale: 'Promoter SITG: strong (manual ref).',
        evidence: [sitg.note ?? ''],
      },
      partial: {
        status: 'partial',
        score: 0.6,
        rationale: 'Promoter SITG: partial.',
        evidence: [sitg.note ?? ''],
      },
      weak: {
        status: 'fail',
        score: 0.15,
        rationale: 'Promoter SITG: weak.',
        evidence: [sitg.note ?? ''],
      },
      unknown: { status: 'unknown', score: 0.4, rationale: '', evidence: [] },
    };
    return map[sitg.status];
  }
  // Backstop: clean balance sheet (low D/E) + dividend history = partial credit.
  const f = input.fundamentals;
  if (f && f.annual) {
    const last5 = lastN(f.annual, 5);
    const des = last5
      .map((r) => r.debt_to_equity)
      .filter((x): x is number => typeof x === 'number');
    const meanDe = avgNum(des);
    if (meanDe !== null && meanDe < 0.5) {
      ev.push(`5y avg D/E ${meanDe.toFixed(2)} — clean balance sheet`);
      return {
        status: 'partial',
        score: 0.5,
        rationale:
          'No explicit management rule, but disciplined leverage suggests prudent stewardship.',
        evidence: ev,
      };
    }
  }
  return {
    status: 'unknown',
    score: 0.4,
    rationale: 'Management quality not directly observable from available data.',
    evidence: ev,
  };
}

function evalPricingPower(input: SymbolInputs): FactorVerdict {
  // Proxy: 5y EBITDA-margin trend (stable or rising = pass).
  const f = input.fundamentals;
  if (!f || !f.annual) {
    return { status: 'unknown', score: 0.4, rationale: 'No fundamentals.', evidence: [] };
  }
  const last5 = lastN(f.annual, 5);
  if (last5.length < 4) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'Need 4+ years of margin history.',
      evidence: [],
    };
  }
  const margins = last5
    .map((r) =>
      typeof r.ebitda_cr === 'number' && typeof r.sales_cr === 'number' && r.sales_cr > 0
        ? r.ebitda_cr / r.sales_cr
        : null,
    )
    .filter((x): x is number => x != null);
  if (margins.length < 4) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'EBITDA/sales not consistently reported.',
      evidence: [],
    };
  }
  const first = margins[0]!;
  const last = margins[margins.length - 1]!;
  const delta = last - first;
  const ev = [
    `EBITDA margin ${(first * 100).toFixed(1)}% → ${(last * 100).toFixed(1)}% over ${margins.length}y`,
  ];
  if (delta >= 0.02) {
    return {
      status: 'pass',
      score: 1.0,
      rationale: 'EBITDA margin expanded — pricing power evident.',
      evidence: ev,
    };
  }
  if (delta >= -0.02) {
    return {
      status: 'partial',
      score: 0.6,
      rationale: 'Margin stable — defended pricing through cycle.',
      evidence: ev,
    };
  }
  return {
    status: 'fail',
    score: 0.2,
    rationale: 'Margin compressed materially — limited pricing power.',
    evidence: ev,
  };
}

function evalReinvestment(input: SymbolInputs): FactorVerdict {
  // Akre's heuristic: PAT growth ≈ ROCE × reinvestment-rate. If PAT-CAGR ≥ ROCE × 0.5,
  // the business is meaningfully reinvesting at high returns.
  const f = input.fundamentals;
  if (!f || !f.annual) {
    return { status: 'unknown', score: 0.4, rationale: 'No fundamentals.', evidence: [] };
  }
  const ks = years(f.annual);
  const span = Math.min(5, ks.length - 1);
  if (span < 3) {
    return { status: 'unknown', score: 0.4, rationale: 'Need 3y+ of fundamentals.', evidence: [] };
  }
  const last = f.annual[ks[ks.length - 1]!]!;
  const first = f.annual[ks[ks.length - 1 - span]!]!;
  const patC = cagr(first.pat_cr, last.pat_cr, span);
  const last5 = lastN(f.annual, 5);
  const roceAvg = avgNum(last5.map((r) => r.roce_pct ?? null));
  if (patC === null || roceAvg === null) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'Need both PAT history and ROCE.',
      evidence: [],
    };
  }
  const roceDec = roceAvg / 100;
  const target = roceDec * 0.5;
  const ev = [`PAT CAGR ${(patC * 100).toFixed(1)}% vs ROCE×0.5 = ${(target * 100).toFixed(1)}%`];
  if (patC >= target) {
    return {
      status: 'pass',
      score: 1.0,
      rationale: 'PAT growth ≥ ROCE × 0.5 — Akre reinvestment math intact.',
      evidence: ev,
    };
  }
  if (patC >= target * 0.6) {
    return {
      status: 'partial',
      score: 0.55,
      rationale: 'Reinvestment rate is moderate — runway exists but execution lighter than ideal.',
      evidence: ev,
    };
  }
  return {
    status: 'fail',
    score: 0.2,
    rationale:
      'PAT growth well below ROCE-implied reinvestment — likely paying out earnings rather than compounding them.',
    evidence: ev,
  };
}

function evalFcfConversion(input: SymbolInputs): FactorVerdict {
  const f = input.fundamentals;
  if (!f || !f.annual) {
    return { status: 'unknown', score: 0.4, rationale: 'No fundamentals.', evidence: [] };
  }
  const last3 = lastN(f.annual, 3);
  const cfos = last3.map((r) => r.cfo_cr).filter((x): x is number => typeof x === 'number');
  const pats = last3.map((r) => r.pat_cr).filter((x): x is number => typeof x === 'number');
  if (cfos.length < 3 || pats.length < 3) {
    return { status: 'unknown', score: 0.4, rationale: 'Need 3y of CFO + PAT.', evidence: [] };
  }
  const sumCfo = cfos.reduce((a, b) => a + b, 0);
  const sumPat = pats.reduce((a, b) => a + b, 0);
  if (sumPat <= 0) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'PAT non-positive aggregated — cannot compute ratio.',
      evidence: [],
    };
  }
  const ratio = sumCfo / sumPat;
  const ev = [
    `3y CFO/PAT = ${ratio.toFixed(2)} (sum ₹${sumCfo.toFixed(0)} Cr / ₹${sumPat.toFixed(0)} Cr)`,
  ];
  // Banks/NBFCs have negative CFO from lending growth — explicitly flag as unknown not fail.
  if (ratio < 0) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale:
        'CFO is structurally distorted (financials, leverage growth) — ratio not informative.',
      evidence: ev,
    };
  }
  if (ratio >= 0.7) {
    return {
      status: 'pass',
      score: 1.0,
      rationale: 'Cash conversion ≥ 0.7 — earnings are real.',
      evidence: ev,
    };
  }
  if (ratio >= 0.5) {
    return {
      status: 'partial',
      score: 0.55,
      rationale: '0.5–0.7 conversion — working-capital drag worth monitoring.',
      evidence: ev,
    };
  }
  return {
    status: 'fail',
    score: 0.2,
    rationale:
      'Cash conversion < 0.5 — accounting earnings not translating to cash (Mukherjea forensic flag).',
    evidence: ev,
  };
}

function evalCapitalAllocation(input: SymbolInputs): FactorVerdict {
  // Heuristic: equity book value should not balloon disproportionately to PAT
  // (proxy for dilution). And payout sanity — we use D/E low + no equity dilution.
  const f = input.fundamentals;
  if (!f || !f.annual) {
    return { status: 'unknown', score: 0.4, rationale: 'No fundamentals.', evidence: [] };
  }
  const ks = years(f.annual);
  if (ks.length < 5) {
    return { status: 'unknown', score: 0.4, rationale: 'Need 5y of fundamentals.', evidence: [] };
  }
  const last = f.annual[ks[ks.length - 1]!]!;
  const five = f.annual[ks[ks.length - 6] ?? ks[0]!]!;
  // Equity-BV CAGR vs PAT CAGR: if BV grows much faster, equity dilution likely.
  const bvC = cagr(five.equity_bv_cr, last.equity_bv_cr, 5);
  const patC = cagr(five.pat_cr, last.pat_cr, 5);
  const ev: string[] = [];
  if (bvC === null || patC === null) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'Insufficient equity-BV / PAT history.',
      evidence: ev,
    };
  }
  ev.push(`5y BV CAGR ${(bvC * 100).toFixed(1)}% · PAT CAGR ${(patC * 100).toFixed(1)}%`);
  // If BV grew >> PAT (ratio > 1.5), suggests dilutive capital raises.
  const dilutionRatio = patC > 0 ? bvC / patC : 99;
  if (dilutionRatio > 1.8) {
    return {
      status: 'fail',
      score: 0.25,
      rationale:
        'Book value compounded materially faster than PAT — likely equity dilution or value-destructive M&A.',
      evidence: ev,
    };
  }
  if (dilutionRatio < 1.2) {
    return {
      status: 'pass',
      score: 1.0,
      rationale:
        'Earnings compounded as fast or faster than book value — disciplined capital allocation.',
      evidence: ev,
    };
  }
  return {
    status: 'partial',
    score: 0.6,
    rationale: 'Mild book-value drag vs earnings — capital allocation acceptable.',
    evidence: ev,
  };
}

function evalCyclicality(input: SymbolInputs): FactorVerdict {
  const NON_CYCLICAL = new Set([
    'Software Services',
    'Information Technology',
    'Healthcare',
    'Fast Moving Consumer Goods',
    'Building Materials',
    'Defence',
  ]);
  const CYCLICAL_HARD = new Set([
    'Realty',
    'Construction Materials',
    'Oil Gas & Consumable Fuels',
    'Power',
    'Telecommunication',
  ]);
  const CYCLICAL_SOFT = new Set([
    'Auto Ancillary',
    'Automobile',
    'Chemicals',
    'Capital Goods',
    'Engineering & Capital Goods',
    'Consumer Durables',
    'Energy',
    'Financial Services',
  ]);
  if (NON_CYCLICAL.has(input.sector)) {
    return {
      status: 'pass',
      score: 1.0,
      rationale: `Sector "${input.sector}" is non-cyclical — predictable compounding.`,
      evidence: [],
    };
  }
  if (CYCLICAL_SOFT.has(input.sector)) {
    return {
      status: 'partial',
      score: 0.55,
      rationale: `Sector "${input.sector}" is mildly cyclical — earnings vary with the cycle.`,
      evidence: [],
    };
  }
  if (CYCLICAL_HARD.has(input.sector)) {
    return {
      status: 'fail',
      score: 0.2,
      rationale: `Sector "${input.sector}" is highly cyclical — not a pure compounder.`,
      evidence: [],
    };
  }
  return {
    status: 'unknown',
    score: 0.4,
    rationale: `Cyclicality classification missing for "${input.sector}".`,
    evidence: [],
  };
}

/**
 * Valuation factor — answers "is the multiple justifiable given quality?"
 * along three calibration axes:
 *   1. PEG (Lynch)              — PE / 5y PAT-CAGR-percent
 *   2. PE vs sector median       — quality compounders earn a premium, but
 *                                  paying ≥ 1.5× the sector median demands
 *                                  visibly better fundamentals than peers.
 *   3. PE vs own 5y/10y history  — own-history calibration: a stock at the
 *                                  90th percentile of its OWN 10y range is
 *                                  usually expensive even if it's "always
 *                                  been expensive".
 *
 * Verdict policy (each axis votes; majority + worst-axis-veto):
 *   pass     — PEG ≤ 1.0 AND PE ≤ sector median × 1.3 AND PE ≤ own 5y median × 1.2
 *   partial  — PEG 1.0–1.5, OR PE 1.3–1.7× sector, OR PE 1.2–1.5× own median
 *   fail     — PEG > 1.5 AND (PE > 1.5× sector OR PE > 1.5× own median),
 *              OR PE10y_percentile ≥ 0.85 (top 15% of own history)
 *   unknown  — none of the three axes have data
 */
function evalValuation(input: SymbolInputs): FactorVerdict {
  const v = input.valuation;
  if (!v) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'No valuation context provided.',
      evidence: [],
    };
  }
  const evidence: string[] = [];
  const have: {
    peg?: 'pass' | 'partial' | 'fail';
    sector?: 'pass' | 'partial' | 'fail';
    own?: 'pass' | 'partial' | 'fail';
  } = {};

  // PEG axis (Lynch).
  if (typeof v.peg === 'number' && Number.isFinite(v.peg)) {
    if (v.peg <= 1.0) {
      have.peg = 'pass';
      evidence.push(`PEG ${v.peg.toFixed(2)} ≤ 1.0 (Lynch's GARP threshold)`);
    } else if (v.peg <= 1.5) {
      have.peg = 'partial';
      evidence.push(`PEG ${v.peg.toFixed(2)} in 1.0–1.5 — multiple is fair vs growth`);
    } else {
      have.peg = 'fail';
      evidence.push(`PEG ${v.peg.toFixed(2)} > 1.5 — paying ahead of growth`);
    }
  } else {
    evidence.push('PEG: unknown (PAT growth or PE missing)');
  }

  // Sector axis: PE vs sector median.
  if (typeof v.peVsSectorMedian === 'number' && Number.isFinite(v.peVsSectorMedian)) {
    const ratio = v.peVsSectorMedian;
    const sectorPe = v.peSectorMedian ?? 0;
    if (ratio <= 1.3) {
      have.sector = 'pass';
      evidence.push(
        `PE ${(ratio * sectorPe).toFixed(0)} at ${ratio.toFixed(2)}× sector median ${sectorPe.toFixed(0)}`,
      );
    } else if (ratio <= 1.7) {
      have.sector = 'partial';
      evidence.push(
        `PE ${(ratio * sectorPe).toFixed(0)} at ${ratio.toFixed(2)}× sector median ${sectorPe.toFixed(0)} — premium needs to be earned by fundamentals`,
      );
    } else {
      have.sector = 'fail';
      evidence.push(
        `PE ${(ratio * sectorPe).toFixed(0)} at ${ratio.toFixed(2)}× sector median ${sectorPe.toFixed(0)} — expensive vs peers`,
      );
    }
  } else {
    evidence.push('Sector PE: unknown');
  }

  // Own-history axis: prefer 5y median when available, else 10y percentile.
  if (
    typeof v.pe === 'number' &&
    typeof v.pe5yMedian === 'number' &&
    Number.isFinite(v.pe5yMedian) &&
    v.pe5yMedian > 0
  ) {
    const ratio = v.pe / v.pe5yMedian;
    if (ratio <= 1.2) {
      have.own = 'pass';
      evidence.push(
        `PE ${v.pe.toFixed(0)} at ${ratio.toFixed(2)}× own 5y median ${v.pe5yMedian.toFixed(0)}`,
      );
    } else if (ratio <= 1.5) {
      have.own = 'partial';
      evidence.push(
        `PE ${v.pe.toFixed(0)} at ${ratio.toFixed(2)}× own 5y median ${v.pe5yMedian.toFixed(0)} — slightly elevated`,
      );
    } else {
      have.own = 'fail';
      evidence.push(
        `PE ${v.pe.toFixed(0)} at ${ratio.toFixed(2)}× own 5y median ${v.pe5yMedian.toFixed(0)} — well above own history`,
      );
    }
  } else if (typeof v.pe10yPercentile === 'number' && Number.isFinite(v.pe10yPercentile)) {
    const p = v.pe10yPercentile;
    if (p <= 0.5) {
      have.own = 'pass';
      evidence.push(`PE at ${(p * 100).toFixed(0)}th percentile of own 10y range`);
    } else if (p <= 0.8) {
      have.own = 'partial';
      evidence.push(`PE at ${(p * 100).toFixed(0)}th percentile of own 10y range — upper-half`);
    } else {
      have.own = 'fail';
      evidence.push(`PE at ${(p * 100).toFixed(0)}th percentile of own 10y range — top 20%`);
    }
  } else {
    evidence.push('Own-history PE: unknown');
  }

  // 10y percentile veto: ≥ 0.85 forces fail regardless of other axes.
  if (typeof v.pe10yPercentile === 'number' && v.pe10yPercentile >= 0.85) {
    return {
      status: 'fail',
      score: 0.15,
      rationale: `PE in top 15% of own 10y history — overdue for mean reversion.`,
      evidence,
    };
  }

  const axes = Object.values(have).filter((x): x is 'pass' | 'partial' | 'fail' => !!x);
  if (axes.length === 0) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'No valuation axis had usable data.',
      evidence,
    };
  }
  const passes = axes.filter((a) => a === 'pass').length;
  const fails = axes.filter((a) => a === 'fail').length;
  const partials = axes.filter((a) => a === 'partial').length;

  // Mean per-axis score (pass=+1, partial=0, fail=-1). A single fail isn't
  // washed away by a single pass — they average to 0 (partial), which is the
  // honest read.
  const axisAvg = (passes - fails) / axes.length;
  if (passes === axes.length) {
    return {
      status: 'pass',
      score: 1.0,
      rationale: `All ${axes.length} valuation axes pass — entry multiple is reasonable.`,
      evidence,
    };
  }
  if (fails >= 2) {
    return {
      status: 'fail',
      score: 0.2,
      rationale: `${fails} of ${axes.length} valuation axes fail — multiple unjustified.`,
      evidence,
    };
  }
  if (axisAvg >= 0.5) {
    return {
      status: 'pass',
      score: 0.85,
      rationale: `Majority of valuation axes pass (${passes}P / ${partials}Pa / ${fails}F).`,
      evidence,
    };
  }
  if (axisAvg <= -0.34) {
    return {
      status: 'fail',
      score: 0.25,
      rationale: `Net-negative valuation: ${passes}P / ${partials}Pa / ${fails}F.`,
      evidence,
    };
  }
  return {
    status: 'partial',
    score: fails === 0 ? 0.6 : 0.4,
    rationale: `Mixed valuation: ${passes}P / ${partials}Pa / ${fails}F.`,
    evidence,
  };
}

/**
 * Thematic-tailwind factor — does the company sit in a structurally-growing
 * theme that gives it an extra "10x optionality" (AI compute, EV, drones,
 * renewables, semis, India consumer premium, etc.)?
 *
 * Verdict by best tier among the symbol's tagged themes:
 *   structural  → pass    (1.0)  — multi-decade tailwind, cross-source consensus
 *   emerging    → pass    (0.85) — early but well-funded; visible 5–10y runway
 *   maturing    → partial (0.5)  — saturating, GDP-like
 *   declining   → fail    (0.2)  — structural headwind
 *   untagged    → unknown (0.4)  — neutral default
 *
 * If a symbol has BOTH a structural and a declining theme (e.g., a legacy
 * auto OEM expanding into EVs), we use the strongest tier — the optionality
 * argument applies — but surface both in the rationale so the user sees
 * the dual narrative.
 */
function evalThematicTailwind(input: SymbolInputs): FactorVerdict {
  const r = resolveSymbolThemes(input.symbol);
  if (r.themes.length === 0) {
    return {
      status: 'unknown',
      score: 0.4,
      rationale: 'Symbol not tagged to any theme — refresh thematic_tailwinds.json.',
      evidence: [],
    };
  }
  const evidence = r.themes.map((t) => `${t.id}: ${t.entry.tier} · ${t.entry.label}`);
  switch (r.bestTier) {
    case 'structural':
      return {
        status: 'pass',
        score: 1.0,
        rationale: `Sits in a structural theme — multi-decade tailwind, cross-source consensus.`,
        evidence,
      };
    case 'emerging':
      return {
        status: 'pass',
        score: 0.85,
        rationale: `Sits in an emerging theme — early but well-funded; visible 5–10y runway.`,
        evidence,
      };
    case 'maturing':
      return {
        status: 'partial',
        score: 0.5,
        rationale: `Theme is maturing — growth approaching GDP-like, no multi-bagger optionality.`,
        evidence,
      };
    case 'declining':
      return {
        status: 'fail',
        score: 0.2,
        rationale: `Theme is in structural decline — capital flowing away.`,
        evidence,
      };
    default:
      return {
        status: 'unknown',
        score: 0.4,
        rationale: 'Theme tier could not be resolved.',
        evidence,
      };
  }
}

// -----------------------------------------------------------------------------
// Factor registry (final 12).
// -----------------------------------------------------------------------------

export const FACTORS: CompounderFactor[] = [
  {
    id: 'tam',
    label: 'Large TAM',
    description: 'Addressable market large enough to support 10y of growth without saturation.',
    citation: 'consensus.md#1-4',
    weight: 0.1,
    evaluator: evalTam,
  },
  {
    id: 'execution',
    label: 'Execution',
    description: '5y revenue + PAT CAGR ≥ 15% — proof the team is capturing the market.',
    citation: 'consensus.md#1-4',
    weight: 0.11,
    evaluator: evalExecution,
  },
  {
    id: 'roce',
    label: 'High ROCE',
    description: '5y average ROCE ≥ 18% — capital efficiency above hurdle.',
    citation: 'consensus.md#1-4',
    weight: 0.11,
    evaluator: evalRoce,
  },
  {
    id: 'moat',
    label: 'Moat',
    description: 'Durable competitive advantage protecting ROCE from mean reversion.',
    citation: 'consensus.md#1-6',
    weight: 0.11,
    evaluator: evalMoat,
  },
  {
    id: 'management',
    label: 'Management quality',
    description: 'Integrity + capital allocation skill (consensus §1.1 + India §4.1).',
    citation: 'consensus.md#1-1',
    weight: 0.1,
    evaluator: evalManagement,
  },
  {
    id: 'valuation',
    label: 'Valuation discipline',
    description:
      'PEG · sector-PE · own 5y/10y PE history — entry multiple must be justifiable by quality.',
    citation: 'consensus.md#7-5',
    weight: 0.1,
    evaluator: evalValuation,
  },
  {
    id: 'thematic_tailwind',
    label: 'Thematic tailwind',
    description:
      'Sits in a structural theme (AI, EV, drones, renewables, semis, India consumer premium) — multi-decade demand-side optionality for the multi-bagger thesis.',
    citation: 'thematic_tailwinds.json',
    weight: 0.08,
    evaluator: evalThematicTailwind,
  },
  {
    id: 'pricing_power',
    label: 'Pricing power',
    description: 'Stable or expanding gross/EBITDA margin through inflation cycles.',
    citation: 'stalwart:akre.md#three-legged-stool',
    weight: 0.06,
    evaluator: evalPricingPower,
  },
  {
    id: 'reinvestment',
    label: 'Reinvestment runway',
    description:
      "Akre's math: PAT growth ≥ ROCE × reinvestment-rate keeps the compounder spinning.",
    citation: 'stalwart:akre.md#three-legged-stool',
    weight: 0.08,
    evaluator: evalReinvestment,
  },
  {
    id: 'fcf_conversion',
    label: 'FCF conversion',
    description: '3y CFO / PAT ≥ 0.7 — earnings translate to real cash.',
    citation: 'consensus.md#1-5',
    weight: 0.06,
    evaluator: evalFcfConversion,
  },
  {
    id: 'capital_alloc',
    label: 'Capital allocation',
    description: 'No equity dilution; book value not outpacing earnings (Buffett).',
    citation: 'stalwart:buffett.md#capital-allocation',
    weight: 0.05,
    evaluator: evalCapitalAllocation,
  },
  {
    id: 'cyclicality',
    label: 'Non-cyclicality',
    description: 'Predictable demand profile — compounders prefer non-cyclical industries.',
    citation: 'consensus.md#3-5',
    weight: 0.04,
    evaluator: evalCyclicality,
  },
];

// Sanity check at module load (cheap).
const totalW = FACTORS.reduce((s, f) => s + f.weight, 0);
if (Math.abs(totalW - 1.0) > 0.001) {
  // eslint-disable-next-line no-console
  console.warn(`[compounder/factors] weights sum to ${totalW}, expected 1.0`);
}
