import type { NormalizedTrade } from '@/lib/parsers/types';
import type { Lot } from '@/lib/analytics/corporateActions';
import { computeFifo, type CorporateAction } from '@/lib/analytics/fifo';
import { applySymbolAliases } from '@/lib/analytics/symbolAliases';

export type Eligibility = 'LTCL' | 'STCL' | 'none';

export type LotClassification = {
  daysHeld: number;
  potentialLoss: number;
  eligibility: Eligibility;
  lastPrice: number | null;
};

export type HarvestRow = {
  symbol: string;
  lotDate: string;
  qty: number;
  costPerShare: number;
  costBasis: number;
  lastPrice: number | null;
  marketValue: number | null;
  potentialLoss: number;
  daysHeld: number;
  eligibility: Eligibility;
};

export type SymbolSummary = {
  symbol: string;
  lotCount: number;
  ltclLoss: number;
  stclLoss: number;
  totalLoss: number;
};

export type HarvestTotals = {
  totalLtcl: number;
  totalStcl: number;
  totalLoss: number;
  ltclLotCount: number;
  stclLotCount: number;
  totalLotCount: number;
};

export type HarvestResult = {
  rows: HarvestRow[];
  bySymbol: SymbolSummary[];
  totals: HarvestTotals;
};

const LTCG_THRESHOLD_DAYS = 365;

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/**
 * Classifies a single open lot for tax-loss harvesting eligibility (Indian equity rules).
 * - LTCL: held >= 365 days AND current price < cost.
 * - STCL: held < 365 days AND current price < cost.
 * - none: profitable, flat, or no current price.
 */
export function classifyLot(
  lot: Lot,
  lastPrice: number | null,
  asOfDate: string,
): LotClassification {
  const daysHeld = daysBetween(lot.date, asOfDate);
  if (lastPrice == null || lastPrice >= lot.costPerShare) {
    return { daysHeld, potentialLoss: 0, eligibility: 'none', lastPrice };
  }
  const potentialLoss = lot.qty * (lastPrice - lot.costPerShare);
  const eligibility: Eligibility = daysHeld >= LTCG_THRESHOLD_DAYS ? 'LTCL' : 'STCL';
  return { daysHeld, potentialLoss, eligibility, lastPrice };
}

/**
 * Runs FIFO per symbol and returns a Map<symbol, Lot[]> of open lots.
 * Wraps `computeFifo` (which already aliases + nets intraday + applies corporate actions)
 * and re-attaches the symbol key that the bulk return shape drops.
 */
export function computeOpenLotsBySymbol(
  trades: NormalizedTrade[],
  corporateActions: CorporateAction[],
): Map<string, Lot[]> {
  // Apply symbol aliases first so legacy tickers (LTI→LTIM, HDFC→HDFCBANK, etc.) collapse
  // BEFORE we group by symbol; otherwise per-symbol FIFO sees an oversold history.
  // (computeFifo also calls applySymbolAliases internally — calling it once up-front is
  // idempotent since the second pass becomes a no-op.)
  const aliased = applySymbolAliases(trades);
  const bySymbol = new Map<string, NormalizedTrade[]>();
  for (const t of aliased) {
    const arr = bySymbol.get(t.symbol);
    if (arr) arr.push(t);
    else bySymbol.set(t.symbol, [t]);
  }
  const out = new Map<string, Lot[]>();
  for (const [symbol, symTrades] of bySymbol) {
    const symActions = corporateActions.filter((a) => a.symbol === symbol);
    const { lots } = computeFifo(symTrades, symActions);
    if (lots.length > 0) out.set(symbol, lots);
  }
  return out;
}

/**
 * Computes per-lot tax-loss harvesting rows + per-symbol rollups + portfolio totals.
 */
export function computeTaxHarvest(
  trades: NormalizedTrade[],
  corporateActions: CorporateAction[],
  prices: Map<string, number>,
  asOfDate: string,
): HarvestResult {
  const lotsBySymbol = computeOpenLotsBySymbol(trades, corporateActions);

  const rows: HarvestRow[] = [];
  for (const [symbol, lots] of lotsBySymbol) {
    const lastPrice = prices.get(symbol) ?? null;
    for (const lot of lots) {
      const cls = classifyLot(lot, lastPrice, asOfDate);
      rows.push({
        symbol,
        lotDate: lot.date,
        qty: lot.qty,
        costPerShare: lot.costPerShare,
        costBasis: lot.qty * lot.costPerShare,
        lastPrice: cls.lastPrice,
        marketValue: cls.lastPrice != null ? cls.lastPrice * lot.qty : null,
        potentialLoss: cls.potentialLoss,
        daysHeld: cls.daysHeld,
        eligibility: cls.eligibility,
      });
    }
  }

  const symMap = new Map<string, SymbolSummary>();
  for (const r of rows) {
    let s = symMap.get(r.symbol);
    if (!s) {
      s = { symbol: r.symbol, lotCount: 0, ltclLoss: 0, stclLoss: 0, totalLoss: 0 };
      symMap.set(r.symbol, s);
    }
    s.lotCount++;
    if (r.eligibility === 'LTCL') s.ltclLoss += r.potentialLoss;
    if (r.eligibility === 'STCL') s.stclLoss += r.potentialLoss;
    s.totalLoss += r.potentialLoss;
  }
  const bySymbol = [...symMap.values()].sort((a, b) => a.totalLoss - b.totalLoss);

  let totalLtcl = 0;
  let totalStcl = 0;
  let ltclLotCount = 0;
  let stclLotCount = 0;
  for (const r of rows) {
    if (r.eligibility === 'LTCL') {
      totalLtcl += r.potentialLoss;
      ltclLotCount++;
    } else if (r.eligibility === 'STCL') {
      totalStcl += r.potentialLoss;
      stclLotCount++;
    }
  }
  const totals: HarvestTotals = {
    totalLtcl,
    totalStcl,
    totalLoss: totalLtcl + totalStcl,
    ltclLotCount,
    stclLotCount,
    totalLotCount: rows.length,
  };

  return { rows, bySymbol, totals };
}
