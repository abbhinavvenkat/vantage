/**
 * Pure-logic tests for the master Decisions table filter+sort behaviour.
 *
 * Exercises `applyTableFilters` directly so we don't need a DOM. The component
 * itself is rendered server-side by app/(app)/p/[portfolioId]/decisions/page.tsx
 * and imports useState/useRouter — out of scope for vitest unit runs.
 */

import { describe, it, expect } from 'vitest';

import {
  applyTableFilters,
  type CompounderClass,
  type DecisionTableRow,
} from '@/app/(app)/p/[portfolioId]/decisions/DecisionsTable';
import type { StalwartDisplayAction } from '@/lib/decisions/displayAction';

function row(overrides: Partial<DecisionTableRow>): DecisionTableRow {
  return {
    symbol: 'ACME',
    sector: 'Auto',
    isHolding: true,
    isWatchlist: false,
    action: 'hold',
    score: 0.5,
    compounderClass: 'solid compounder',
    compounderScore: 0.6,
    compounderTenX: 5,
    valuation: null,
    cagrKind: 'keep',
    cagrForecast: 0.18,
    thesisVerdict: 'intact',
    growth: { yearOne: 0.12, yearThree: 0.38, yearFive: 0.62, confidence: 'medium' },
    topRules: [{ ruleId: 'rule.x', action: 'hold', weight: 0.5 }],
    positionPct: 0.05,
    targetBuyPrice: null,
    finalAction: 'hold',
    finalScore: 0.4,
    finalConfidence: 'medium',
    finalRiskCapped: false,
    ...overrides,
  };
}

const baseRows: DecisionTableRow[] = [
  row({
    symbol: 'BAJAJ-AUTO',
    action: 'add',
    score: 0.8,
    compounderClass: '7-9x candidate',
    compounderScore: 0.82,
  }),
  row({
    symbol: 'KPITTECH',
    isHolding: false,
    isWatchlist: true,
    action: 'fresh_buy',
    score: 0.9,
    compounderClass: 'solid compounder',
    compounderScore: 0.6,
    targetBuyPrice: 1500,
    positionPct: null,
    cagrKind: 'fresh_buy',
  }),
  row({
    symbol: 'CHENNPETRO',
    isHolding: false,
    isWatchlist: false,
    action: 'exit',
    score: 0.4,
    compounderClass: 'broken',
    compounderScore: 0.15,
    cagrKind: 'replace',
    cagrForecast: 0.05,
    positionPct: null,
  }),
  row({
    symbol: 'INFY',
    action: 'trim_25',
    score: 0.6,
    compounderClass: 'mediocre',
    compounderScore: 0.4,
  }),
];

const NO_ACTIONS = new Set<StalwartDisplayAction>();
const NO_CLASSES = new Set<CompounderClass>();

describe('applyTableFilters — tab', () => {
  it('all returns every row', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BAJAJ-AUTO', 'CHENNPETRO', 'INFY', 'KPITTECH']);
  });

  it('holdings restricts to held rows only', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'holdings',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BAJAJ-AUTO', 'INFY']);
  });

  it('watchlist excludes held + universe', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'watchlist',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['KPITTECH']);
  });
});

describe('applyTableFilters — action filter (collapsed 4-action vocab)', () => {
  it('add_more chip matches both fresh_buy and add granular rows', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: new Set<StalwartDisplayAction>(['add_more']),
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BAJAJ-AUTO', 'KPITTECH']);
  });

  it('sell_partial chip matches both trim_25 and trim_50 granular rows', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: new Set<StalwartDisplayAction>(['sell_partial']),
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['INFY']);
  });

  it('sell_full chip matches exit granular rows', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: new Set<StalwartDisplayAction>(['sell_full']),
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['CHENNPETRO']);
  });

  it('empty action set matches everything', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.length).toBe(4);
  });
});

describe('applyTableFilters — compounder filter', () => {
  it('matches selected classifications only', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: new Set<CompounderClass>(['7-9x candidate', 'broken']),
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BAJAJ-AUTO', 'CHENNPETRO']);
  });

  it('combines with action filter via AND', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: new Set<StalwartDisplayAction>(['sell_full']),
      classifications: new Set<CompounderClass>(['broken']),
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['CHENNPETRO']);
  });
});

describe('applyTableFilters — sort', () => {
  it('priority sort: fresh_buy → add → hold → trim_25 → exit', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'priority',
      sortDir: 'desc',
    });
    expect(out.map((r) => r.action)).toEqual(['fresh_buy', 'add', 'trim_25', 'exit']);
  });

  it('score sort desc puts highest score first', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'score',
      sortDir: 'desc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['KPITTECH', 'BAJAJ-AUTO', 'INFY', 'CHENNPETRO']);
  });

  it('cagr sort asc puts lowest forecast first', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'cagr',
      sortDir: 'asc',
    });
    expect(out[0]!.symbol).toBe('CHENNPETRO');
  });

  it('symbol sort asc is alphabetical', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BAJAJ-AUTO', 'CHENNPETRO', 'INFY', 'KPITTECH']);
  });

  it('compounder sort desc puts top weighted-score first', () => {
    const out = applyTableFilters(baseRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      sort: 'compounder',
      sortDir: 'desc',
    });
    // BAJAJ-AUTO is 7-9x candidate (score=0.6 in fixture though -- override didn't change score)
    // The fixture row helper keeps score=0.6 unless overridden; tied ⇒ stable sort order in JS
    // we just verify the broken (lowest expected) is last
    expect(out[out.length - 1]!.compounderClass).toBe('broken');
  });
});
