import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  aggregateResearchSignals,
  summariseResearchSignals,
  type SymbolResearchInputs,
} from '@/lib/research/signals';
import type { ManagementAccountability, ThesisStressTest } from '@/lib/research/loadOutputs';

function stressTest(
  symbol: string,
  verdict: ThesisStressTest['verdict'],
  rationale = 'rationale',
  runAt = '2026-05-01T00:00:00Z',
): ThesisStressTest {
  return {
    symbol,
    run_at: runAt,
    checklist: [],
    verdict,
    verdict_rationale_md: rationale,
  };
}

function accountability(
  symbol: string,
  verdicts: Array<ManagementAccountability['quarters'][number]['verdict']>,
  consistency: number,
  driftSignals: string[] = [],
): ManagementAccountability {
  return {
    symbol,
    generated_at: '2026-05-01T00:00:00Z',
    quarters: verdicts.map((verdict, i) => ({
      fq: `Q${(i % 4) + 1}-FY26`,
      guidance_vs_actuals: [],
      drift_signals: i === verdicts.length - 1 ? driftSignals : [],
      tone_delta: 0,
      verdict,
    })),
    consistency_score: consistency,
    red_flags: [],
    thesis_impact_md: '',
  };
}

describe('aggregateResearchSignals', () => {
  it('counts thesis-health buckets across symbols, treating missing stress-test as untested', () => {
    const inputs: SymbolResearchInputs[] = [
      {
        symbol: 'AAA',
        thesisStressTest: stressTest('AAA', 'intact'),
        managementAccountability: null,
      },
      {
        symbol: 'BBB',
        thesisStressTest: stressTest('BBB', 'intact'),
        managementAccountability: null,
      },
      {
        symbol: 'CCC',
        thesisStressTest: stressTest('CCC', 'weakened', 'demand softening'),
        managementAccountability: null,
      },
      {
        symbol: 'DDD',
        thesisStressTest: stressTest('DDD', 'broken', 'capital misallocation'),
        managementAccountability: null,
      },
      {
        symbol: 'EEE',
        thesisStressTest: stressTest('EEE', 'watch'),
        managementAccountability: null,
      },
      { symbol: 'FFF', thesisStressTest: null, managementAccountability: null },
    ];

    const summary = aggregateResearchSignals(inputs);
    expect(summary.distribution).toEqual({
      intact: 2,
      watch: 1,
      weakened: 1,
      broken: 1,
      untested: 1,
      total: 6,
    });
  });

  it('lists concerning theses sorted broken-first then most-recent', () => {
    const inputs: SymbolResearchInputs[] = [
      {
        symbol: 'OLDWEAK',
        thesisStressTest: stressTest('OLDWEAK', 'weakened', 'old', '2026-01-01T00:00:00Z'),
        managementAccountability: null,
      },
      {
        symbol: 'NEWWEAK',
        thesisStressTest: stressTest('NEWWEAK', 'weakened', 'new', '2026-04-01T00:00:00Z'),
        managementAccountability: null,
      },
      {
        symbol: 'BROKEN',
        thesisStressTest: stressTest('BROKEN', 'broken', 'gone', '2026-02-01T00:00:00Z'),
        managementAccountability: null,
      },
      {
        symbol: 'OK',
        thesisStressTest: stressTest('OK', 'intact'),
        managementAccountability: null,
      },
    ];

    const summary = aggregateResearchSignals(inputs);
    expect(summary.concerningTheses.map((c) => c.symbol)).toEqual(['BROKEN', 'NEWWEAK', 'OLDWEAK']);
    expect(summary.concerningTheses[0]!.verdict).toBe('broken');
    expect(summary.concerningTheses[0]!.lastReviewed).toBe('2026-02-01');
  });

  it('flags symbols with 2+ partial/missed quarters and surfaces the latest drift signal', () => {
    const inputs: SymbolResearchInputs[] = [
      {
        symbol: 'MISS',
        thesisStressTest: null,
        managementAccountability: accountability(
          'MISS',
          ['delivered', 'partial', 'missed', 'partial'],
          0.25,
          ['Margin guide cut twice', 'Order book softening'],
        ),
      },
      {
        symbol: 'STEADY',
        thesisStressTest: null,
        // only 1 partial — should NOT surface
        managementAccountability: accountability(
          'STEADY',
          ['delivered', 'delivered', 'partial'],
          0.83,
        ),
      },
      {
        symbol: 'WORST',
        thesisStressTest: null,
        managementAccountability: accountability('WORST', ['missed', 'missed', 'partial'], 0.1, [
          'Capex deferred again',
        ]),
      },
    ];

    const summary = aggregateResearchSignals(inputs);
    expect(summary.guidanceMissWatch.map((m) => m.symbol)).toEqual(['WORST', 'MISS']);
    expect(summary.guidanceMissWatch[0]).toMatchObject({
      symbol: 'WORST',
      consistencyScore: 0.1,
      delivered: 0,
      totalScored: 3,
      topDriftSignal: 'Capex deferred again',
    });
    expect(summary.guidanceMissWatch[1]).toMatchObject({
      symbol: 'MISS',
      delivered: 1,
      totalScored: 4,
    });
    // top drift signal pulled from latest quarter that has any
    expect(summary.guidanceMissWatch[1]!.topDriftSignal).toBe('Margin guide cut twice');
  });

  it('truncates long rationales and drift signals', () => {
    const long = 'x'.repeat(500);
    const inputs: SymbolResearchInputs[] = [
      {
        symbol: 'LONG',
        thesisStressTest: stressTest('LONG', 'broken', long),
        managementAccountability: accountability('LONG', ['missed', 'missed'], 0, [long]),
      },
    ];
    const summary = aggregateResearchSignals(inputs);
    expect(summary.concerningTheses[0]!.rationale.length).toBeLessThanOrEqual(140);
    expect(summary.concerningTheses[0]!.rationale.endsWith('…')).toBe(true);
    expect(summary.guidanceMissWatch[0]!.topDriftSignal!.length).toBeLessThanOrEqual(140);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration test: write fixtures to a tmp dir and let summariseResearchSignals
// read them via the existing loader functions (no mocking).
// ─────────────────────────────────────────────────────────────────────────────

let root: string;

beforeAll(() => {
  root = mkdtempSync(resolve(tmpdir(), 'stock-platform-signals-'));

  // ALPHA: weakened thesis + 2 partial quarters
  mkdirSync(resolve(root, 'research/ALPHA/thesis-stress-test'), { recursive: true });
  writeFileSync(
    resolve(root, 'research/ALPHA/thesis-stress-test/run.json'),
    JSON.stringify({
      symbol: 'ALPHA',
      run_at: '2026-04-15T00:00:00Z',
      checklist: [],
      verdict: 'weakened',
      verdict_rationale_md: 'Margin compression accelerating.',
    }),
  );

  mkdirSync(resolve(root, 'research/ALPHA/management-accountability'), { recursive: true });
  writeFileSync(
    resolve(root, 'research/ALPHA/management-accountability/run.json'),
    JSON.stringify({
      symbol: 'ALPHA',
      generated_at: '2026-04-15T00:00:00Z',
      quarters: [
        {
          fq: 'Q1-FY26',
          guidance_vs_actuals: [],
          drift_signals: [],
          tone_delta: 0,
          verdict: 'partial',
        },
        {
          fq: 'Q2-FY26',
          guidance_vs_actuals: [],
          drift_signals: ['Margin guide cut'],
          tone_delta: -1,
          verdict: 'partial',
        },
      ],
      consistency_score: 0.4,
      red_flags: [],
    }),
  );

  // BETA: intact, no accountability data
  mkdirSync(resolve(root, 'research/BETA/thesis-stress-test'), { recursive: true });
  writeFileSync(
    resolve(root, 'research/BETA/thesis-stress-test/run.json'),
    JSON.stringify({
      symbol: 'BETA',
      run_at: '2026-04-20T00:00:00Z',
      checklist: [],
      verdict: 'intact',
      verdict_rationale_md: 'All checks pass.',
    }),
  );

  // GAMMA: nothing on disk → untested
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('summariseResearchSignals (file-system integration)', () => {
  it('reads disk fixtures and aggregates correctly', () => {
    const summary = summariseResearchSignals(['ALPHA', 'BETA', 'GAMMA'], root);

    expect(summary.distribution).toEqual({
      intact: 1,
      watch: 0,
      weakened: 1,
      broken: 0,
      untested: 1,
      total: 3,
    });
    expect(summary.concerningTheses.map((c) => c.symbol)).toEqual(['ALPHA']);
    expect(summary.concerningTheses[0]!.rationale).toContain('Margin compression');
    expect(summary.guidanceMissWatch.map((m) => m.symbol)).toEqual(['ALPHA']);
    expect(summary.guidanceMissWatch[0]!.topDriftSignal).toBe('Margin guide cut');
    expect(summary.guidanceMissWatch[0]!.delivered).toBe(0);
    expect(summary.guidanceMissWatch[0]!.totalScored).toBe(2);
  });

  it('returns an empty distribution when no symbols are passed', () => {
    const summary = summariseResearchSignals([], root);
    expect(summary.distribution.total).toBe(0);
    expect(summary.concerningTheses).toEqual([]);
    expect(summary.guidanceMissWatch).toEqual([]);
  });
});
