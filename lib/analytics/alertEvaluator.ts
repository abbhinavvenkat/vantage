import type { AlertRuleType } from '@/lib/db/schema';

export type EvaluatorRule = {
  id: string;
  symbol: string; // resolved symbol — synthetic rules from watchlist already resolved
  ruleType: AlertRuleType;
  threshold: number;
  enabled: boolean;
};

export type PriceSnapshot = {
  symbol: string;
  close: number;
  volume: number | null;
  date: string; // ISO YYYY-MM-DD
};

export type SymbolHistory = {
  high52w: number | null;
  low52w: number | null;
  avgVolume30d: number | null;
};

export type EvaluatedEvent = {
  ruleId: string;
  symbol: string;
  ruleType: AlertRuleType;
  triggeredAt: string; // ISO datetime
  currentValue: number;
  triggerValue: number;
  message: string;
};

export type EvaluatorOptions = {
  /** Returns true if a rule has already fired (unacked) on the given date. */
  alreadyFiredToday?: (ruleId: string, isoDate: string) => boolean;
  /** Override the timestamp for triggeredAt (useful for tests). */
  now?: () => Date;
};

/**
 * Pure function: given rules + latest prices + 52w history, return the events
 * that should fire. No side effects, no DB.
 *
 * - Rules with `enabled=false` are skipped.
 * - Rules referencing a symbol with no price are skipped.
 * - `volume_spike` rules silently skip when avgVolume30d or current volume is null.
 * - Duplicate suppression is delegated to `alreadyFiredToday(ruleId, isoDate)`.
 */
export function evaluateRules(
  rules: EvaluatorRule[],
  priceMap: Map<string, PriceSnapshot>,
  history: Map<string, SymbolHistory>,
  isoDate: string,
  opts: EvaluatorOptions = {},
): EvaluatedEvent[] {
  const out: EvaluatedEvent[] = [];
  const triggeredAt = (opts.now ?? (() => new Date()))().toISOString();

  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (opts.alreadyFiredToday?.(rule.id, isoDate)) continue;

    const snap = priceMap.get(rule.symbol);
    if (!snap) continue;

    const hist = history.get(rule.symbol);
    const fired = check(rule, snap, hist);
    if (fired) {
      out.push({
        ruleId: rule.id,
        symbol: rule.symbol,
        ruleType: rule.ruleType,
        triggeredAt,
        currentValue: fired.currentValue,
        triggerValue: fired.triggerValue,
        message: fired.message,
      });
    }
  }

  return out;
}

type Fire = { currentValue: number; triggerValue: number; message: string };

function check(
  rule: EvaluatorRule,
  snap: PriceSnapshot,
  hist: SymbolHistory | undefined,
): Fire | null {
  switch (rule.ruleType) {
    case 'cmp_below':
      if (snap.close <= rule.threshold) {
        return {
          currentValue: snap.close,
          triggerValue: rule.threshold,
          message: `${rule.symbol} CMP ₹${fmt(snap.close)} ≤ target ₹${fmt(rule.threshold)}`,
        };
      }
      return null;

    case 'cmp_above':
      if (snap.close >= rule.threshold) {
        return {
          currentValue: snap.close,
          triggerValue: rule.threshold,
          message: `${rule.symbol} CMP ₹${fmt(snap.close)} ≥ target ₹${fmt(rule.threshold)}`,
        };
      }
      return null;

    case 'pct_drop_from_52w_high': {
      if (!hist || hist.high52w == null || hist.high52w <= 0) return null;
      const dropPct = ((hist.high52w - snap.close) / hist.high52w) * 100;
      if (dropPct >= rule.threshold) {
        return {
          currentValue: snap.close,
          triggerValue: hist.high52w,
          message: `${rule.symbol} −${fmt(dropPct, 1)}% from 52w high (₹${fmt(hist.high52w)} → ₹${fmt(snap.close)})`,
        };
      }
      return null;
    }

    case 'pct_rise_from_52w_low': {
      if (!hist || hist.low52w == null || hist.low52w <= 0) return null;
      const risePct = ((snap.close - hist.low52w) / hist.low52w) * 100;
      if (risePct >= rule.threshold) {
        return {
          currentValue: snap.close,
          triggerValue: hist.low52w,
          message: `${rule.symbol} +${fmt(risePct, 1)}% from 52w low (₹${fmt(hist.low52w)} → ₹${fmt(snap.close)})`,
        };
      }
      return null;
    }

    case 'volume_spike': {
      if (!hist || hist.avgVolume30d == null || hist.avgVolume30d <= 0) return null;
      if (snap.volume == null) return null;
      const ratio = snap.volume / hist.avgVolume30d;
      if (ratio >= rule.threshold) {
        return {
          currentValue: snap.volume,
          triggerValue: hist.avgVolume30d * rule.threshold,
          message: `${rule.symbol} volume ${fmt(ratio, 2)}× 30d avg`,
        };
      }
      return null;
    }
  }
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
