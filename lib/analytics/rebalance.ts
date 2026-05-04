import type { OpenPosition } from '@/lib/analytics/fifoHoldings';
import type { LatestPrice } from '@/lib/db/queries/prices';
import { getSector } from '@/lib/sectors/map';

export type RebalanceMode = 'symbol' | 'sector';

export type RebalanceTarget = {
  mode: RebalanceMode;
  key: string; // symbol or sector name
  targetPct: number; // 0..100
};

export type RebalanceAction = {
  /** Symbol (mode=symbol or sector child) or sector name (mode=sector parent). */
  key: string;
  /** Set when this row is a child of a sector roll-up. */
  parentSector?: string;
  /** Sector for symbol-mode rows (purely informational). */
  sector?: string;
  currentPct: number;
  targetPct: number;
  deltaPct: number;
  /** ₹ delta required (desired MV − current MV). Negative ⇒ sell. */
  deltaInr: number;
  action: 'buy' | 'sell' | 'hold';
  /** Whole-share qty change. Negative ⇒ sell. 0 for sector parents and "consider" recs. */
  qtyChange: number;
  /** ₹ value of the rounded whole-share trade. */
  estTradeValue: number;
  note?: string;
};

/** Trades with absolute ₹ value below this are filtered out as noise. */
const NOISE_THRESHOLD_INR = 500;
/** Whole-share rounding residual above this triggers a "fractional" note. */
const FRACTIONAL_RESIDUAL_INR = 100;

/**
 * Computes per-target rebalancing actions.
 *
 * - mode='symbol': one action per target symbol; whole-share rounding for non-fractional brokers.
 * - mode='sector': one parent action per sector + per-symbol child actions (pro-rata by current MV
 *   weight within the sector). Sectors with no current symbols emit a "consider adding" recommendation.
 *
 * Caller is responsible for tax considerations.
 */
export function computeRebalanceTrades(
  positions: OpenPosition[],
  prices: Map<string, LatestPrice>,
  targets: RebalanceTarget[],
  mode: RebalanceMode,
  totalMv: number,
): RebalanceAction[] {
  if (totalMv <= 0) return [];

  const cmpFor = (sym: string): number =>
    prices.get(sym)?.close ?? positions.find((p) => p.symbol === sym)?.avgCost ?? 0;

  const symbolMv = new Map<string, number>();
  for (const p of positions) {
    symbolMv.set(p.symbol, p.qty * cmpFor(p.symbol));
  }

  if (mode === 'symbol') {
    return computeSymbolMode(positions, prices, targets, totalMv, symbolMv);
  }
  return computeSectorMode(positions, prices, targets, totalMv, symbolMv);
}

function computeSymbolMode(
  positions: OpenPosition[],
  prices: Map<string, LatestPrice>,
  targets: RebalanceTarget[],
  totalMv: number,
  symbolMv: Map<string, number>,
): RebalanceAction[] {
  const out: RebalanceAction[] = [];
  for (const t of targets) {
    if (t.mode !== 'symbol') continue;
    const cmp = prices.get(t.key)?.close ?? null;
    const pos = positions.find((p) => p.symbol === t.key) ?? null;
    const currentMv = symbolMv.get(t.key) ?? 0;
    const desiredMv = (t.targetPct / 100) * totalMv;
    const deltaInr = desiredMv - currentMv;
    const currentPct = totalMv > 0 ? (currentMv / totalMv) * 100 : 0;
    const deltaPct = t.targetPct - currentPct;

    // Determine qty change.
    let qtyChange = 0;
    let note: string | undefined;
    let estTradeValue = 0;

    if (deltaInr > 0) {
      // BUY
      if (cmp == null || cmp <= 0) {
        out.push({
          key: t.key,
          sector: getSector(t.key),
          currentPct,
          targetPct: t.targetPct,
          deltaPct,
          deltaInr,
          action: 'buy',
          qtyChange: 0,
          estTradeValue: 0,
          note: 'no_price — refresh prices to compute qty',
        });
        continue;
      }
      const ideal = deltaInr / cmp;
      qtyChange = Math.floor(ideal);
      estTradeValue = qtyChange * cmp;
      const residual = deltaInr - estTradeValue;
      if (residual > FRACTIONAL_RESIDUAL_INR) {
        note = `fractional residual ₹${Math.round(residual)} — broker dependent`;
      }
    } else if (deltaInr < 0) {
      // SELL
      if (cmp == null || cmp <= 0 || pos == null) {
        // Can't price the sell; mark as informational.
        out.push({
          key: t.key,
          sector: getSector(t.key),
          currentPct,
          targetPct: t.targetPct,
          deltaPct,
          deltaInr,
          action: 'sell',
          qtyChange: 0,
          estTradeValue: 0,
          note: pos == null ? 'not_currently_held' : 'no_price',
        });
        continue;
      }
      // Special-case target=0 ⇒ exit the entire position regardless of rounding.
      if (t.targetPct === 0 && pos.qty > 0) {
        qtyChange = -pos.qty;
        estTradeValue = qtyChange * cmp;
      } else {
        const ideal = deltaInr / cmp; // negative
        qtyChange = -Math.floor(Math.abs(ideal));
        // Don't sell more than you hold.
        if (Math.abs(qtyChange) > pos.qty) qtyChange = -pos.qty;
        estTradeValue = qtyChange * cmp;
        const residual = Math.abs(deltaInr - estTradeValue);
        if (residual > FRACTIONAL_RESIDUAL_INR && Math.abs(qtyChange) < pos.qty) {
          note = `fractional residual ₹${Math.round(residual)} — broker dependent`;
        }
      }
    }

    // Filter noise: under-threshold or zero-qty after rounding ⇒ HOLD.
    let action: RebalanceAction['action'];
    if (qtyChange === 0 || Math.abs(deltaInr) < NOISE_THRESHOLD_INR) {
      action = 'hold';
      qtyChange = 0;
      estTradeValue = 0;
      note = note ?? (Math.abs(deltaInr) < NOISE_THRESHOLD_INR ? 'within_noise_threshold' : note);
    } else {
      action = qtyChange > 0 ? 'buy' : 'sell';
    }

    out.push({
      key: t.key,
      sector: getSector(t.key),
      currentPct,
      targetPct: t.targetPct,
      deltaPct,
      deltaInr,
      action,
      qtyChange,
      estTradeValue,
      note,
    });
  }
  return out;
}

function computeSectorMode(
  positions: OpenPosition[],
  prices: Map<string, LatestPrice>,
  targets: RebalanceTarget[],
  totalMv: number,
  symbolMv: Map<string, number>,
): RebalanceAction[] {
  // Bucket symbols by sector.
  const sectorMembers = new Map<string, { symbol: string; mv: number }[]>();
  for (const p of positions) {
    const sector = getSector(p.symbol);
    const arr = sectorMembers.get(sector) ?? [];
    arr.push({ symbol: p.symbol, mv: symbolMv.get(p.symbol) ?? 0 });
    sectorMembers.set(sector, arr);
  }
  const sectorMv = new Map<string, number>();
  for (const [s, arr] of sectorMembers) {
    sectorMv.set(
      s,
      arr.reduce((sum, x) => sum + x.mv, 0),
    );
  }

  const out: RebalanceAction[] = [];
  for (const t of targets) {
    if (t.mode !== 'sector') continue;
    const currentMv = sectorMv.get(t.key) ?? 0;
    const desiredMv = (t.targetPct / 100) * totalMv;
    const deltaInr = desiredMv - currentMv;
    const currentPct = totalMv > 0 ? (currentMv / totalMv) * 100 : 0;
    const deltaPct = t.targetPct - currentPct;
    const members = sectorMembers.get(t.key) ?? [];

    // Sector under-allocated AND no holdings in this sector ⇒ recommend adding.
    if (members.length === 0 && deltaInr > NOISE_THRESHOLD_INR) {
      out.push({
        key: t.key,
        currentPct,
        targetPct: t.targetPct,
        deltaPct,
        deltaInr,
        action: 'buy',
        qtyChange: 0,
        estTradeValue: 0,
        note: 'consider adding sector — no symbols currently held',
      });
      continue;
    }

    // Hold when sector delta is within noise threshold.
    if (Math.abs(deltaInr) < NOISE_THRESHOLD_INR) {
      out.push({
        key: t.key,
        currentPct,
        targetPct: t.targetPct,
        deltaPct,
        deltaInr,
        action: 'hold',
        qtyChange: 0,
        estTradeValue: 0,
      });
      continue;
    }

    const sectorAction: RebalanceAction = {
      key: t.key,
      currentPct,
      targetPct: t.targetPct,
      deltaPct,
      deltaInr,
      action: deltaInr > 0 ? 'buy' : 'sell',
      qtyChange: 0,
      estTradeValue: 0,
    };
    out.push(sectorAction);

    // Pro-rata distribute the sector delta across member symbols by current MV weight.
    const sectorTotalMv = sectorMv.get(t.key) ?? 0;
    if (sectorTotalMv <= 0) continue;
    for (const m of members) {
      const share = m.mv / sectorTotalMv;
      const childDelta = deltaInr * share;
      const cmp = prices.get(m.symbol)?.close ?? null;
      const pos = positions.find((p) => p.symbol === m.symbol) ?? null;
      const childCurrentPct = totalMv > 0 ? (m.mv / totalMv) * 100 : 0;
      const childTargetPct = childCurrentPct + (childDelta / totalMv) * 100;

      let qtyChange = 0;
      let estTradeValue = 0;
      let note: string | undefined;

      if (cmp == null || cmp <= 0) {
        note = 'no_price';
      } else if (childDelta > 0) {
        qtyChange = Math.floor(childDelta / cmp);
        estTradeValue = qtyChange * cmp;
        const residual = childDelta - estTradeValue;
        if (residual > FRACTIONAL_RESIDUAL_INR) {
          note = `fractional residual ₹${Math.round(residual)} — broker dependent`;
        }
      } else if (childDelta < 0 && pos != null) {
        qtyChange = -Math.floor(Math.abs(childDelta) / cmp);
        if (Math.abs(qtyChange) > pos.qty) qtyChange = -pos.qty;
        estTradeValue = qtyChange * cmp;
      }

      let action: RebalanceAction['action'];
      if (qtyChange === 0 || Math.abs(childDelta) < NOISE_THRESHOLD_INR) {
        action = 'hold';
        qtyChange = 0;
        estTradeValue = 0;
      } else {
        action = qtyChange > 0 ? 'buy' : 'sell';
      }

      out.push({
        key: m.symbol,
        parentSector: t.key,
        sector: t.key,
        currentPct: childCurrentPct,
        targetPct: childTargetPct,
        deltaPct: childTargetPct - childCurrentPct,
        deltaInr: childDelta,
        action,
        qtyChange,
        estTradeValue,
        note,
      });
    }
  }
  return out;
}
