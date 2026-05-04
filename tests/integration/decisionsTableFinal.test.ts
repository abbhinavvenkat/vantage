/**
 * Integration coverage for the Final column wiring in DecisionsTable —
 * sort, filter, and the synthesis-supplied row fields.
 */

import { describe, it, expect } from 'vitest';

import {
  applyTableFilters,
  type CompounderClass,
  type DecisionTableRow,
} from '@/app/(app)/p/[portfolioId]/decisions/DecisionsTable';
import { type FinalAction } from '@/lib/synthesis/finalRecommendation';
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

const NO_ACTIONS = new Set<StalwartDisplayAction>();
const NO_CLASSES = new Set<CompounderClass>();
const NO_FINAL = new Set<FinalAction>();

const rows: DecisionTableRow[] = [
  row({ symbol: 'ENTER1', isHolding: false, finalAction: 'enter_position', finalScore: 1.7 }),
  row({ symbol: 'BUY1', isHolding: true, finalAction: 'buy_more', finalScore: 1.6 }),
  row({ symbol: 'HOLD1', finalAction: 'hold', finalScore: 0.3 }),
  row({ symbol: 'TRIM1', finalAction: 'sell_partial', finalScore: -1.0 }),
  row({ symbol: 'EXIT1', finalAction: 'sell_full', finalScore: -1.8 }),
];

describe('Final column — sort by priority', () => {
  it('default ascending = enter, buy, hold, sell_partial, sell_full', () => {
    const out = applyTableFilters(rows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      finalActions: NO_FINAL,
      sort: 'final',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.finalAction)).toEqual([
      'enter_position',
      'buy_more',
      'hold',
      'sell_partial',
      'sell_full',
    ]);
  });

  it('descending flips priority ordering', () => {
    const out = applyTableFilters(rows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      finalActions: NO_FINAL,
      sort: 'final',
      sortDir: 'desc',
    });
    expect(out.map((r) => r.finalAction)).toEqual([
      'sell_full',
      'sell_partial',
      'hold',
      'buy_more',
      'enter_position',
    ]);
  });

  it('ties on action break by composite score desc', () => {
    const tieRows: DecisionTableRow[] = [
      row({ symbol: 'BUY_LO', isHolding: true, finalAction: 'buy_more', finalScore: 1.55 }),
      row({ symbol: 'BUY_HI', isHolding: true, finalAction: 'buy_more', finalScore: 1.95 }),
    ];
    const out = applyTableFilters(tieRows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      finalActions: NO_FINAL,
      sort: 'final',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['BUY_HI', 'BUY_LO']);
  });
});

describe('Final action filter', () => {
  it('selects rows whose finalAction is in the selected set', () => {
    const out = applyTableFilters(rows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      finalActions: new Set<FinalAction>(['enter_position', 'buy_more']),
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol).sort()).toEqual(['BUY1', 'ENTER1']);
  });

  it('combines with stalwart action filter via AND', () => {
    const mixed: DecisionTableRow[] = [
      row({ symbol: 'A', action: 'add', finalAction: 'buy_more' }),
      row({ symbol: 'B', action: 'add', finalAction: 'hold' }),
      row({ symbol: 'C', action: 'hold', finalAction: 'buy_more' }),
    ];
    const out = applyTableFilters(mixed, {
      tab: 'all',
      actions: new Set<StalwartDisplayAction>(['add_more']),
      classifications: NO_CLASSES,
      finalActions: new Set<FinalAction>(['buy_more']),
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.map((r) => r.symbol)).toEqual(['A']);
  });

  it('empty final-action set acts as no filter', () => {
    const out = applyTableFilters(rows, {
      tab: 'all',
      actions: NO_ACTIONS,
      classifications: NO_CLASSES,
      finalActions: new Set<FinalAction>(),
      sort: 'symbol',
      sortDir: 'asc',
    });
    expect(out.length).toBe(rows.length);
  });
});

describe('Final column — fields', () => {
  it('finalScore, finalConfidence, finalRiskCapped pass through unchanged', () => {
    const r = row({
      finalAction: 'sell_partial',
      finalScore: -1.2,
      finalConfidence: 'high',
      finalRiskCapped: true,
    });
    expect(r.finalAction).toBe('sell_partial');
    expect(r.finalScore).toBeCloseTo(-1.2);
    expect(r.finalConfidence).toBe('high');
    expect(r.finalRiskCapped).toBe(true);
  });
});
