/**
 * Aggregates per-symbol research outputs (loaded by `loadOutputs.ts`) into
 * the dashboard-level summary buckets shown on
 * `/p/<id>/decisions` -> "Research signals" section.
 *
 * Pure function over loader results — keep it net-additive and side-effect
 * free so unit tests can stub the loader inputs directly.
 */

import {
  getResearchRoot,
  loadLatestManagementAccountability,
  loadLatestThesisStressTest,
  type ManagementAccountability,
  type ThesisStressTest,
} from '@/lib/research/loadOutputs';

export type ThesisHealthBucket = 'intact' | 'watch' | 'weakened' | 'broken' | 'untested';

export type ThesisHealthDistribution = {
  intact: number;
  watch: number;
  weakened: number;
  broken: number;
  untested: number;
  total: number;
};

export type ConcerningThesis = {
  symbol: string;
  verdict: 'weakened' | 'broken';
  lastReviewed: string; // YYYY-MM-DD
  rationale: string; // one-line truncation
};

export type GuidanceMissRow = {
  symbol: string;
  consistencyScore: number; // 0..1
  delivered: number;
  totalScored: number; // = delivered + partial + missed (excludes 'na')
  topDriftSignal: string | null;
};

export type ResearchSignalsSummary = {
  distribution: ThesisHealthDistribution;
  concerningTheses: ConcerningThesis[];
  guidanceMissWatch: GuidanceMissRow[];
};

export type SymbolResearchInputs = {
  symbol: string;
  thesisStressTest: ThesisStressTest | null;
  managementAccountability: ManagementAccountability | null;
};

const TRUNC = 140;

function truncate(s: string, max = TRUNC): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function bucketFor(stressTest: ThesisStressTest | null): ThesisHealthBucket {
  if (!stressTest) return 'untested';
  return stressTest.verdict;
}

function countDeliveryVerdicts(acc: ManagementAccountability): {
  delivered: number;
  partial: number;
  missed: number;
} {
  let delivered = 0;
  let partial = 0;
  let missed = 0;
  for (const q of acc.quarters) {
    if (q.verdict === 'delivered') delivered += 1;
    else if (q.verdict === 'partial') partial += 1;
    else if (q.verdict === 'missed') missed += 1;
  }
  return { delivered, partial, missed };
}

/**
 * Pure aggregator. Takes a fully-resolved list of per-symbol research
 * payloads and produces the dashboard summary.
 */
export function aggregateResearchSignals(inputs: SymbolResearchInputs[]): ResearchSignalsSummary {
  const distribution: ThesisHealthDistribution = {
    intact: 0,
    watch: 0,
    weakened: 0,
    broken: 0,
    untested: 0,
    total: inputs.length,
  };

  const concerning: ConcerningThesis[] = [];
  const misses: GuidanceMissRow[] = [];

  for (const { symbol, thesisStressTest, managementAccountability } of inputs) {
    const bucket = bucketFor(thesisStressTest);
    distribution[bucket] += 1;

    if (
      thesisStressTest &&
      (thesisStressTest.verdict === 'weakened' || thesisStressTest.verdict === 'broken')
    ) {
      concerning.push({
        symbol,
        verdict: thesisStressTest.verdict,
        lastReviewed: thesisStressTest.run_at.slice(0, 10),
        rationale: truncate(thesisStressTest.verdict_rationale_md || '(no rationale recorded)'),
      });
    }

    if (managementAccountability) {
      const counts = countDeliveryVerdicts(managementAccountability);
      const totalScored = counts.delivered + counts.partial + counts.missed;
      const concerningQuarters = counts.partial + counts.missed;
      if (concerningQuarters >= 2) {
        // Most recent quarter's first drift signal (if any).
        const latest = [...managementAccountability.quarters]
          .reverse()
          .find((q) => (q.drift_signals?.length ?? 0) > 0);
        const top = latest?.drift_signals?.[0] ?? null;
        misses.push({
          symbol,
          consistencyScore: managementAccountability.consistency_score,
          delivered: counts.delivered,
          totalScored,
          topDriftSignal: top ? truncate(top) : null,
        });
      }
    }
  }

  // Worst first: broken before weakened, then most recently reviewed.
  concerning.sort((a, b) => {
    if (a.verdict !== b.verdict) return a.verdict === 'broken' ? -1 : 1;
    return b.lastReviewed.localeCompare(a.lastReviewed);
  });

  // Worst consistency first.
  misses.sort((a, b) => a.consistencyScore - b.consistencyScore);

  return {
    distribution,
    concerningTheses: concerning,
    guidanceMissWatch: misses,
  };
}

/**
 * Convenience: read the latest stress-test + management-accountability for
 * each symbol and feed the aggregator. Pure read-side; no DB access.
 *
 * `root` defaults to the configured research root (env-aware).
 */
export function summariseResearchSignals(symbols: string[], root?: string): ResearchSignalsSummary {
  const r = root ?? getResearchRoot();
  const inputs: SymbolResearchInputs[] = symbols.map((symbol) => ({
    symbol,
    thesisStressTest: loadLatestThesisStressTest(symbol, r),
    managementAccountability: loadLatestManagementAccountability(symbol, r),
  }));
  return aggregateResearchSignals(inputs);
}
