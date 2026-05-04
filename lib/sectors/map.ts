/**
 * Symbol -> sector classification.
 *
 * Source of truth: Zerodha holdings statement (Equity sheet). Symbols not present
 * fall back to "Unclassified" — the page handles that case explicitly.
 *
 * Sector strings are kept verbatim from the Zerodha source so the labels match what
 * the user sees in the broker UI.
 */
export const SECTOR_MAP: Record<string, string> = {
  AFFLE: 'Software Services',
  AJANTPHARM: 'Healthcare',
  'ARE&M': 'Auto Ancillary',
  ASIANPAINT: 'Building Materials',
  'BAJAJ-AUTO': 'Auto Ancillary',
  BAJFINANCE: 'Financial Services',
  BEL: 'Defence',
  CAMS: 'Financial Services',
  DRREDDY: 'Healthcare',
  EICHERMOT: 'Auto Ancillary',
  HCLTECH: 'Software Services',
  HDFCBANK: 'Financial Services',
  IEX: 'Energy',
  JUNIORBEES: 'ETF',
  KOTAKBANK: 'Financial Services',
  LALPATHLAB: 'Healthcare',
  LT: 'Engineering & Capital Goods',
  MID150BEES: 'ETF',
  'MON100-E': 'ETF',
  NH: 'Healthcare',
  PIDILITIND: 'Chemicals',
  PIIND: 'Chemicals',
  SBICARD: 'Financial Services',
  SETFNIF50: 'ETF',
  SOLARINDS: 'Defence',
  SRF: 'Chemicals',
  SUPREMEIND: 'Engineering & Capital Goods',
  TATAELXSI: 'Software Services',
  TCS: 'Software Services',
};

export const UNCLASSIFIED = 'Unclassified';

export function getSector(symbol: string): string {
  return SECTOR_MAP[symbol] ?? UNCLASSIFIED;
}
