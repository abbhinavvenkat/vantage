import { describe, it, expect } from 'vitest';

import {
  buildActionTiles,
  buildCompounderDistribution,
  buildRecentSnapshots,
  findFrameworkConflicts,
  topStyleInvestors,
  type ActionKey,
  type DecisionLite,
} from '@/lib/decisions/summarise';
import type { CagrAction } from '@/lib/cagr/portfolioPlan';
import type { CompounderProfile } from '@/lib/compounder/score';

function dec(
  symbol: string,
  action: ActionKey,
  votes: { ruleId: string; action: ActionKey; weight: number }[] = [],
  score = 1,
): DecisionLite {
  return { symbol, action, score, votes };
}

function profile(
  symbol: string,
  classification: CompounderProfile['classification'],
  tenX = 5,
  weightedScore = 0.5,
): CompounderProfile {
  return {
    symbol,
    factors: [],
    passCount: 0,
    partialCount: 0,
    failCount: 0,
    unknownCount: 0,
    weightedScore,
    classification,
    estimatedTenYearReturn: tenX,
    estimatedAnnualisedCagr: 0.15,
    caveats: [],
  };
}

describe('buildActionTiles', () => {
  it('counts symbols and aggregates weights per action', () => {
    const tiles = buildActionTiles([
      dec('A', 'add', [
        { ruleId: 'r1', action: 'add', weight: 0.4 },
        { ruleId: 'r2', action: 'hold', weight: 0.1 },
      ]),
      dec('B', 'add', [{ ruleId: 'r3', action: 'add', weight: 0.6 }]),
      dec('C', 'exit', [{ ruleId: 'r4', action: 'exit', weight: 0.8 }]),
    ]);
    expect(tiles.add.count).toBe(2);
    expect(tiles.add.totalWeight).toBeCloseTo(1.0, 3);
    expect(tiles.exit.count).toBe(1);
    expect(tiles.exit.totalWeight).toBeCloseTo(0.8, 3);
    expect(tiles.hold.count).toBe(0);
  });

  it('returns top symbols ranked by weight then score', () => {
    const tiles = buildActionTiles(
      [
        dec('A', 'add', [{ ruleId: 'r', action: 'add', weight: 0.2 }], 0.2),
        dec('B', 'add', [{ ruleId: 'r', action: 'add', weight: 0.5 }], 0.5),
        dec('C', 'add', [{ ruleId: 'r', action: 'add', weight: 0.3 }], 0.3),
        dec('D', 'add', [{ ruleId: 'r', action: 'add', weight: 0.5 }], 0.7),
      ],
      3,
    );
    expect(tiles.add.topSymbols.map((s) => s.symbol)).toEqual(['D', 'B', 'C']);
  });

  it('handles empty input', () => {
    const tiles = buildActionTiles([]);
    for (const k of ['fresh_buy', 'add', 'hold', 'trim_25', 'trim_50', 'exit'] as ActionKey[]) {
      expect(tiles[k].count).toBe(0);
      expect(tiles[k].topSymbols).toEqual([]);
    }
  });
});

describe('buildCompounderDistribution', () => {
  it('counts each classification and computes fractions', () => {
    const dist = buildCompounderDistribution([
      profile('A', '7-9x candidate', 8.5, 0.85),
      profile('B', '7-9x candidate', 7.8, 0.78),
      profile('C', 'solid compounder', 5.2, 0.6),
      profile('D', 'mediocre', 3.0, 0.4),
      profile('E', 'broken', 1.8, 0.1),
    ]);
    expect(dist.total).toBe(5);
    expect(dist.counts['7-9x candidate']).toBe(2);
    expect(dist.counts.broken).toBe(1);
    expect(dist.fractions['7-9x candidate']).toBeCloseTo(0.4, 3);
    expect(dist.topCandidates.map((c) => c.symbol)).toEqual(['A', 'B']);
    expect(dist.topCandidates[0]!.tenYearMultiple).toBe(8.5);
  });

  it('returns zero fractions for empty input', () => {
    const dist = buildCompounderDistribution([]);
    expect(dist.total).toBe(0);
    expect(dist.fractions['7-9x candidate']).toBe(0);
    expect(dist.topCandidates).toEqual([]);
  });
});

describe('findFrameworkConflicts', () => {
  function cagrAction(kind: CagrAction['kind'], symbol: string): CagrAction {
    if (kind === 'replace') {
      return {
        kind,
        symbol,
        replacementSymbol: 'X',
        rationale: '',
        currentWeightPct: 5,
        targetWeightPct: 5,
        deltaInr: 0,
        forecastedCagr: 0.1,
        thesisMd: '',
      };
    }
    if (kind === 'fresh_buy') {
      return {
        kind,
        symbol,
        rationale: '',
        targetWeightPct: 5,
        deltaInr: 0,
        forecastedCagr: 0.1,
        thesisMd: '',
      };
    }
    return {
      kind,
      symbol,
      rationale: '',
      currentWeightPct: 5,
      targetWeightPct: 5,
      deltaInr: 0,
      forecastedCagr: 0.1,
    };
  }

  it('flags ADD vs broken', () => {
    const conflicts = findFrameworkConflicts({
      decisions: [dec('A', 'add')],
      profilesBySymbol: new Map([['A', profile('A', 'broken')]]),
      cagrActionsBySymbol: new Map(),
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('rule-add-vs-compounder-broken');
  });

  it('flags EXIT vs 7-9x', () => {
    const conflicts = findFrameworkConflicts({
      decisions: [dec('A', 'exit')],
      profilesBySymbol: new Map([['A', profile('A', '7-9x candidate')]]),
      cagrActionsBySymbol: new Map(),
    });
    expect(conflicts.map((c) => c.kind)).toEqual(['rule-exit-vs-compounder-7-9x']);
  });

  it('flags CAGR replace vs 7-9x', () => {
    const conflicts = findFrameworkConflicts({
      decisions: [dec('A', 'hold')],
      profilesBySymbol: new Map([['A', profile('A', '7-9x candidate')]]),
      cagrActionsBySymbol: new Map([['A', cagrAction('replace', 'A')]]),
    });
    expect(conflicts.map((c) => c.kind)).toContain('cagr-replace-vs-compounder-7-9x');
  });

  it('flags CAGR replace vs rule library ADD', () => {
    const conflicts = findFrameworkConflicts({
      decisions: [dec('A', 'add')],
      profilesBySymbol: new Map([['A', profile('A', 'solid compounder')]]),
      cagrActionsBySymbol: new Map([['A', cagrAction('replace', 'A')]]),
    });
    expect(conflicts.map((c) => c.kind)).toContain('cagr-replace-vs-rule-add');
  });

  it('emits no conflict when frameworks agree', () => {
    const conflicts = findFrameworkConflicts({
      decisions: [dec('A', 'hold')],
      profilesBySymbol: new Map([['A', profile('A', 'solid compounder')]]),
      cagrActionsBySymbol: new Map([['A', cagrAction('keep', 'A')]]),
    });
    expect(conflicts).toEqual([]);
  });
});

describe('topStyleInvestors', () => {
  it('returns top-N investors by weight', () => {
    const top = topStyleInvestors({ buffett: 0.1, agrawal: 0.4, marks: 0.3, lynch: 0.2 }, 3);
    expect(top.map((t) => t.investor)).toEqual(['agrawal', 'marks', 'lynch']);
  });

  it('skips zero / negative weights', () => {
    const top = topStyleInvestors({ a: 0, b: 0.5, c: -0.1 }, 5);
    expect(top.map((t) => t.investor)).toEqual(['b']);
  });
});

describe('buildRecentSnapshots', () => {
  it('computes changed-from-prior count vs the next-older snapshot', () => {
    const snapshots = [
      { snapshotAt: 300, ruleLibraryVersion: '0.2.0', n: 3 },
      { snapshotAt: 200, ruleLibraryVersion: '0.2.0', n: 3 },
      { snapshotAt: 100, ruleLibraryVersion: '0.1.0', n: 3 },
    ];
    const at = (ts: number): Map<string, ActionKey> => {
      if (ts === 300)
        return new Map([
          ['A', 'add'],
          ['B', 'hold'],
          ['C', 'exit'],
        ]);
      if (ts === 200)
        return new Map([
          ['A', 'hold'],
          ['B', 'hold'],
          ['C', 'exit'],
        ]);
      return new Map([
        ['A', 'fresh_buy'],
        ['B', 'hold'],
        ['C', 'hold'],
      ]);
    };
    const out = buildRecentSnapshots(snapshots, at, 3);
    expect(out).toHaveLength(3);
    expect(out[0]!.changedFromPrior).toBe(1); // A changed add vs hold
    expect(out[1]!.changedFromPrior).toBe(2); // A and C changed
  });

  it('returns null for the oldest snapshot when nothing older exists', () => {
    const snapshots = [{ snapshotAt: 100, ruleLibraryVersion: '0.1.0', n: 1 }];
    const out = buildRecentSnapshots(snapshots, () => new Map(), 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.changedFromPrior).toBeNull();
  });
});
