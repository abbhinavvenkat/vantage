import { describe, it, expect } from 'vitest';

import { backtestRule, type BacktestTrade, type PriceSeries } from '@/lib/codex/backtest';
import type { SynthesizedRule } from '@/lib/codex/synthesize';

function buyRule(): SynthesizedRule {
  return {
    id: 'rule.test.buy',
    statement: 'Test buy rule.',
    action: 'fresh_buy',
    conditions: {},
    supporting_investors: [{ investor: 'buffett', rule_ids: ['buffett.x'] }],
    counterexamples: [],
    weight: 0.5,
    evidence_strength: 'weak',
    rationale_md: '',
    citations: [],
  };
}

function priceSeries(symbol: string, base: number, dailyDelta: number, days: number) {
  const out: { date: string; close: number }[] = [];
  const start = Date.UTC(2022, 0, 1);
  for (let i = 0; i < days; i += 1) {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: d, close: base + dailyDelta * i });
  }
  return out;
}

describe('backtestRule', () => {
  it('reports hit_rate=1 when every buy trade was followed by outperformance', () => {
    const trades: BacktestTrade[] = [
      { symbol: 'ACME', side: 'buy', date: '2022-01-05', price: 100 },
      { symbol: 'ACME', side: 'buy', date: '2022-02-10', price: 105 },
      { symbol: 'ACME', side: 'buy', date: '2022-03-15', price: 108 },
    ];
    // ACME goes up 1/day, benchmark goes up 0.1/day -> ACME outperforms forward 1y.
    const prices: PriceSeries = new Map([['ACME', priceSeries('ACME', 100, 1, 800)]]);
    const benchmark = priceSeries('NIFTY', 18000, 1.8, 800); // ~0.01% daily

    const result = backtestRule(buyRule(), trades, prices, benchmark, 365);
    expect(result.n_signals).toBe(3);
    expect(result.n_with_outcome).toBe(3);
    expect(result.hit_rate).toBe(1);
    expect(result.avg_return_when_triggered).toBeGreaterThan(result.avg_return_baseline);
  });

  it('returns hit_rate=0 when the buy rule fires before underperformance', () => {
    const trades: BacktestTrade[] = [
      { symbol: 'ACME', side: 'buy', date: '2022-01-05', price: 100 },
      { symbol: 'ACME', side: 'buy', date: '2022-02-10', price: 100 },
    ];
    const prices: PriceSeries = new Map([['ACME', priceSeries('ACME', 100, -0.05, 800)]]);
    const benchmark = priceSeries('NIFTY', 18000, 5, 800); // benchmark rising fast

    const result = backtestRule(buyRule(), trades, prices, benchmark, 365);
    expect(result.n_signals).toBe(2);
    expect(result.n_with_outcome).toBe(2);
    expect(result.hit_rate).toBe(0);
  });
});
