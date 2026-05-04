/**
 * codex-backtest — for each rule in a Rule Library, replay against historical
 * trades + price history. Computes hit-rate, avg forward return, etc.
 *
 * "Replay" here is intentionally simple: we test whether the rule's action
 * lines up with the user's actual trade direction at that time. A buy rule
 * that fired before/around a buy trade counts as a hit. Tracks 1-year
 * forward return vs benchmark (Nifty 50) per signal.
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import type { RuleLibrary, SynthesizedRule } from '@/lib/codex/synthesize';

export type BacktestTrade = {
  symbol: string;
  side: 'buy' | 'sell';
  date: string; // YYYY-MM-DD
  price: number;
};

export type PriceSeries = Map<string, { date: string; close: number }[]>;

export type RuleBacktest = {
  rule_id: string;
  rule_library_version: string;
  universe: string;
  period: { start: string; end: string };
  n_signals: number;
  n_with_outcome: number;
  hit_rate: number;
  avg_return_when_triggered: number;
  avg_return_baseline: number;
  max_drawdown_when_triggered: number;
  false_positive_rate: number;
  notes_md: string;
};

const BUY_ACTIONS = new Set(['fresh_buy', 'add']);
const SELL_ACTIONS = new Set(['trim_25', 'trim_50', 'exit']);

function returnAfter(
  series: { date: string; close: number }[] | undefined,
  fromDate: string,
  days: number,
): number | null {
  if (!series || series.length === 0) return null;
  const start = series.find((p) => p.date >= fromDate);
  if (!start) return null;
  const targetMs = new Date(fromDate).getTime() + days * 86400_000;
  const targetDate = new Date(targetMs).toISOString().slice(0, 10);
  // Find closest >= targetDate.
  const end = series.find((p) => p.date >= targetDate);
  if (!end) return null;
  if (start.close <= 0) return null;
  return (end.close - start.close) / start.close;
}

/**
 * Score a single rule against a list of trades. The rule is considered to
 * "fire" at every trade matching the rule's action class (buy-rules vs each
 * buy trade etc). Hit = forward return aligned with intended action.
 */
export function backtestRule(
  rule: SynthesizedRule,
  trades: BacktestTrade[],
  prices: PriceSeries,
  benchmark: { date: string; close: number }[],
  forwardDays = 365,
): RuleBacktest {
  const action = rule.action;
  const isBuyRule = BUY_ACTIONS.has(action);
  const isSellRule = SELL_ACTIONS.has(action);

  // A rule "fires" on each trade whose side matches the rule's action class.
  const signals = trades.filter((t) =>
    isBuyRule ? t.side === 'buy' : isSellRule ? t.side === 'sell' : true,
  );

  let nWithOutcome = 0;
  let hits = 0;
  let sumReturn = 0;
  let sumBaseline = 0;
  let maxDd = 0;

  const periodStart = signals.length > 0 ? (signals[0]?.date ?? '') : '';
  const periodEnd = signals.length > 0 ? (signals[signals.length - 1]?.date ?? '') : '';

  for (const sig of signals) {
    const fwd = returnAfter(prices.get(sig.symbol), sig.date, forwardDays);
    const base = returnAfter(benchmark, sig.date, forwardDays);
    if (fwd == null || base == null) continue;
    nWithOutcome += 1;
    sumReturn += fwd;
    sumBaseline += base;

    // Hit = direction aligns with action.
    if (isBuyRule && fwd > base) hits += 1;
    else if (isSellRule && fwd < base) hits += 1;
    else if (action === 'hold' && Math.abs(fwd - base) < 0.05) hits += 1;

    if (fwd < maxDd) maxDd = fwd;
  }

  const hitRate = nWithOutcome > 0 ? hits / nWithOutcome : 0;
  const avgReturn = nWithOutcome > 0 ? sumReturn / nWithOutcome : 0;
  const avgBaseline = nWithOutcome > 0 ? sumBaseline / nWithOutcome : 0;
  const fpRate = nWithOutcome > 0 ? 1 - hitRate : 0;

  return {
    rule_id: rule.id,
    rule_library_version: '',
    universe: 'user_tradebook',
    period: { start: periodStart, end: periodEnd },
    n_signals: signals.length,
    n_with_outcome: nWithOutcome,
    hit_rate: Number(hitRate.toFixed(3)),
    avg_return_when_triggered: Number(avgReturn.toFixed(3)),
    avg_return_baseline: Number(avgBaseline.toFixed(3)),
    max_drawdown_when_triggered: Number(maxDd.toFixed(3)),
    false_positive_rate: Number(fpRate.toFixed(3)),
    notes_md: `Tested against ${signals.length} trades; ${nWithOutcome} had ${forwardDays}d forward outcome.`,
  };
}

export function backtestLibrary(
  library: RuleLibrary,
  trades: BacktestTrade[],
  prices: PriceSeries,
  benchmark: { date: string; close: number }[],
  forwardDays = 365,
): RuleBacktest[] {
  return library.rules.map((r) => ({
    ...backtestRule(r, trades, prices, benchmark, forwardDays),
    rule_library_version: library.version,
  }));
}

export function writeBacktests(
  results: RuleBacktest[],
  version: string,
  root = 'data/codex/backtests',
): string {
  const dir = join(root, `v${version}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  for (const r of results) {
    const safe = r.rule_id.replace(/[^a-z0-9.\-]+/gi, '_');
    writeFileSync(join(dir, `${safe}.json`), JSON.stringify(r, null, 2), 'utf-8');
  }
  return dir;
}

/**
 * Apply backtest results to a rule library: rules with hit_rate < 0.5 AND
 * n_signals >= 20 get weight zeroed; otherwise weight is rescaled lightly
 * around 0.5 baseline using hit_rate.
 */
export function applyBacktestToLibrary(
  library: RuleLibrary,
  results: RuleBacktest[],
  newVersion: string,
): RuleLibrary {
  const byId = new Map(results.map((r) => [r.rule_id, r]));
  const rules: SynthesizedRule[] = library.rules.map((r) => {
    const b = byId.get(r.id);
    if (!b) return r;
    if (b.n_signals >= 20 && b.hit_rate < 0.5) {
      return { ...r, weight: 0 };
    }
    if (b.n_with_outcome >= 5) {
      // Move weight a third of the way toward 2 * hit_rate to amplify good rules.
      const target = Math.max(0.05, Math.min(0.95, 2 * b.hit_rate));
      const next = (r.weight * 2) / 3 + target / 3;
      return { ...r, weight: Number(next.toFixed(3)) };
    }
    return r;
  });
  return { ...library, version: newVersion, generated_at: new Date().toISOString(), rules };
}
