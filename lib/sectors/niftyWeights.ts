/**
 * Approximate Nifty 50 sector weights — representative snapshot.
 *
 * As-of: 2026-04-30 (sourced from public Nifty 50 sector composition disclosed
 * by NSE Indices factsheet; rounded to whole percent. Numbers shift quarterly
 * with rebalancing — treat this as an at-a-glance benchmark, not a live feed.)
 *
 * Sector labels are aligned with the strings used in `lib/sectors/map.ts`
 * (which carries Zerodha's own sector tag), so left-joining a user's portfolio
 * onto this map "just works" for the Risk page's sector-vs-Nifty comparison.
 *
 * Sums to ~100% (small residual rolled into "Other").
 */
export const NIFTY50_SECTOR_WEIGHTS: Record<string, number> = {
  'Financial Services': 37,
  'Software Services': 14,
  Energy: 12, // Oil & Gas + power utilities
  'Auto Ancillary': 7, // Autos + ancillary
  Healthcare: 4,
  'Building Materials': 3, // Cement + paints (HUL, Asian Paints)
  'Engineering & Capital Goods': 4, // L&T, BEL absent from Nifty 50 typically
  Defence: 0, // not yet in Nifty 50 free-float
  Chemicals: 1,
  ETF: 0,
  Telecom: 3,
  Metals: 4,
  Other: 11, // FMCG ex-paints, consumer durables, residual
};

export const NIFTY50_AS_OF = '2026-04-30';

/** Returns the Nifty 50 weight (in percent) for a sector label, or 0. */
export function getNiftyWeight(sector: string): number {
  return NIFTY50_SECTOR_WEIGHTS[sector] ?? 0;
}
