import { describe, expect, it } from 'vitest';

import {
  evaluateRules,
  type EvaluatorRule,
  type PriceSnapshot,
  type SymbolHistory,
} from '@/lib/analytics/alertEvaluator';

const TODAY = '2026-05-03';

function rule(
  partial: Partial<EvaluatorRule> & Pick<EvaluatorRule, 'ruleType' | 'threshold'>,
): EvaluatorRule {
  return {
    id: partial.id ?? 'r1',
    symbol: partial.symbol ?? 'ACME-EQ',
    ruleType: partial.ruleType,
    threshold: partial.threshold,
    enabled: partial.enabled ?? true,
  };
}

function price(symbol: string, close: number, volume: number | null = null): PriceSnapshot {
  return { symbol, close, volume, date: TODAY };
}

describe('evaluateRules — cmp_below', () => {
  it('fires when CMP <= threshold', () => {
    const rules = [rule({ ruleType: 'cmp_below', threshold: 100 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 95)]]);
    const events = evaluateRules(rules, prices, new Map(), TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]?.ruleId).toBe('r1');
    expect(events[0]?.currentValue).toBe(95);
    expect(events[0]?.triggerValue).toBe(100);
  });

  it('does not fire when CMP > threshold', () => {
    const rules = [rule({ ruleType: 'cmp_below', threshold: 100 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 105)]]);
    expect(evaluateRules(rules, prices, new Map(), TODAY)).toHaveLength(0);
  });

  it('skips disabled rules', () => {
    const rules = [rule({ ruleType: 'cmp_below', threshold: 100, enabled: false })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 50)]]);
    expect(evaluateRules(rules, prices, new Map(), TODAY)).toHaveLength(0);
  });

  it('skips when price missing', () => {
    const rules = [rule({ ruleType: 'cmp_below', threshold: 100 })];
    expect(evaluateRules(rules, new Map(), new Map(), TODAY)).toHaveLength(0);
  });
});

describe('evaluateRules — cmp_above', () => {
  it('fires when CMP >= threshold', () => {
    const rules = [rule({ ruleType: 'cmp_above', threshold: 100 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 110)]]);
    const events = evaluateRules(rules, prices, new Map(), TODAY);
    expect(events).toHaveLength(1);
  });

  it('does not fire when CMP < threshold', () => {
    const rules = [rule({ ruleType: 'cmp_above', threshold: 100 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 99)]]);
    expect(evaluateRules(rules, prices, new Map(), TODAY)).toHaveLength(0);
  });
});

describe('evaluateRules — pct_drop_from_52w_high', () => {
  it('fires when drawdown >= threshold (positive %)', () => {
    const hist: SymbolHistory = { high52w: 200, low52w: 100, avgVolume30d: null };
    const rules = [rule({ ruleType: 'pct_drop_from_52w_high', threshold: 20 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 150)]]); // 25% drop
    const events = evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY);
    expect(events).toHaveLength(1);
    expect(events[0]?.message).toContain('25');
  });

  it('does not fire when drawdown < threshold', () => {
    const hist: SymbolHistory = { high52w: 200, low52w: 100, avgVolume30d: null };
    const rules = [rule({ ruleType: 'pct_drop_from_52w_high', threshold: 20 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 180)]]); // 10% drop
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(0);
  });

  it('does not fire when 52w-high unknown', () => {
    const rules = [rule({ ruleType: 'pct_drop_from_52w_high', threshold: 20 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 50)]]);
    expect(evaluateRules(rules, prices, new Map(), TODAY)).toHaveLength(0);
  });
});

describe('evaluateRules — pct_rise_from_52w_low', () => {
  it('fires when rise >= threshold', () => {
    const hist: SymbolHistory = { high52w: 200, low52w: 100, avgVolume30d: null };
    const rules = [rule({ ruleType: 'pct_rise_from_52w_low', threshold: 50 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 160)]]); // +60%
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(1);
  });

  it('does not fire when rise < threshold', () => {
    const hist: SymbolHistory = { high52w: 200, low52w: 100, avgVolume30d: null };
    const rules = [rule({ ruleType: 'pct_rise_from_52w_low', threshold: 50 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 120)]]); // +20%
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(0);
  });
});

describe('evaluateRules — volume_spike', () => {
  it('fires when current volume >= threshold * avgVolume30d', () => {
    const hist: SymbolHistory = { high52w: null, low52w: null, avgVolume30d: 100_000 };
    const rules = [rule({ ruleType: 'volume_spike', threshold: 3 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 100, 350_000)]]); // 3.5×
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(1);
  });

  it('does not fire when volume below threshold', () => {
    const hist: SymbolHistory = { high52w: null, low52w: null, avgVolume30d: 100_000 };
    const rules = [rule({ ruleType: 'volume_spike', threshold: 3 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 100, 200_000)]]);
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(0);
  });

  it('does not fire (and does not error) when avgVolume30d is null', () => {
    const rules = [rule({ ruleType: 'volume_spike', threshold: 3 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 100, 999_999)]]);
    expect(evaluateRules(rules, prices, new Map(), TODAY)).toHaveLength(0);
  });

  it('does not fire when current volume is null', () => {
    const hist: SymbolHistory = { high52w: null, low52w: null, avgVolume30d: 100_000 };
    const rules = [rule({ ruleType: 'volume_spike', threshold: 3 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 100, null)]]);
    expect(evaluateRules(rules, prices, new Map([['ACME-EQ', hist]]), TODAY)).toHaveLength(0);
  });
});

describe('evaluateRules — dedupe', () => {
  it('skips a rule if alreadyFiredToday returns true', () => {
    const rules = [rule({ ruleType: 'cmp_below', threshold: 100 })];
    const prices = new Map([['ACME-EQ', price('ACME-EQ', 95)]]);
    const events = evaluateRules(rules, prices, new Map(), TODAY, {
      alreadyFiredToday: (ruleId) => ruleId === 'r1',
    });
    expect(events).toHaveLength(0);
  });
});

describe('evaluateRules — multiple rules', () => {
  it('fires only matching rules across symbols', () => {
    const rules: EvaluatorRule[] = [
      rule({ id: 'r1', symbol: 'ACME-EQ', ruleType: 'cmp_below', threshold: 100 }),
      rule({ id: 'r2', symbol: 'BRAVO-EQ', ruleType: 'cmp_above', threshold: 250 }),
      rule({ id: 'r3', symbol: 'CHARLIE-EQ', ruleType: 'cmp_below', threshold: 50 }),
    ];
    const prices = new Map<string, PriceSnapshot>([
      ['ACME-EQ', price('ACME-EQ', 95)], // r1 fires
      ['BRAVO-EQ', price('BRAVO-EQ', 240)], // r2 doesn't fire
      ['CHARLIE-EQ', price('CHARLIE-EQ', 60)], // r3 doesn't fire
    ]);
    const events = evaluateRules(rules, prices, new Map(), TODAY);
    expect(events.map((e) => e.ruleId)).toEqual(['r1']);
  });
});
