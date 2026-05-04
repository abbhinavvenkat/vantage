/**
 * Parses Zerodha Tax P&L xlsx files for the "Equity Dividends" sheet.
 *
 * Sheet structure (consistent FY20-21 → present):
 *   Row 0-9:  metadata (Client ID/Name/PAN — STRIPPED)
 *   Row 10:   "Equity Dividends from <date> to <date>"
 *   Row 14:   header — Symbol | ISIN | Ex-date | Quantity | Dividend Per Share | Net Dividend Amount
 *   Row 15+:  data rows
 *   ends at:  "Total Dividend Amount" footer + a disclaimer line
 *
 * Some symbols carry historical suffixes that need cleaning:
 *   LALPATHLAB6 → LALPATHLAB   (ISIN-suffix variant)
 *   BAJFINANCE6 → BAJFINANCE
 *   BAJAJ-AUTO* → BAJAJ-AUTO   (footnote marker)
 *   HDFC, AMARAJABAT, LTI       → handled by the existing applySymbolAliases() at use-time.
 */

import * as XLSX from 'xlsx';

export type DividendRow = {
  symbol: string;
  isin?: string;
  exDate: string;
  qty: number;
  dividendPerShare: number;
  netAmount: number;
  currency: 'INR';
};

const HEADER_ROW_IDX = 14;
const EXPECTED_HEADERS = [
  'Symbol',
  'ISIN',
  'Ex-date',
  'Quantity',
  'Dividend Per Share',
  'Net Dividend Amount',
] as const;

function readWorkbook(bytes: Buffer): XLSX.WorkBook | null {
  try {
    return XLSX.read(bytes, { type: 'buffer', cellDates: false });
  } catch {
    return null;
  }
}

function aoaForSheet(wb: XLSX.WorkBook, sheetName: string): unknown[][] | null {
  const ws = wb.Sheets[sheetName];
  if (!ws) return null;
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
}

function headerMatches(row: unknown[] | undefined): boolean {
  if (!row) return false;
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    if (typeof row[i] !== 'string') return false;
    if ((row[i] as string).trim() !== EXPECTED_HEADERS[i]) return false;
  }
  return true;
}

function toIsoDate(value: unknown): string {
  if (typeof value === 'string') {
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    }
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  throw new Error(`zerodhaTaxPnlDividends: unparseable ex-date: ${String(value)}`);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    const n = Number(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`zerodhaTaxPnlDividends: expected numeric, got ${String(value)}`);
}

/**
 * Strips Zerodha's footnote markers and ISIN-suffix variants.
 * Does NOT apply HDFC→HDFCBANK or LTI→LTIM aliases — that is handled centrally
 * by `applySymbolAliases` at the analytics layer so dividend rows remain consistent
 * with whatever the broker statement showed.
 */
function cleanSymbol(raw: string): string {
  let s = raw.trim();
  // Strip trailing footnote markers (* and ^)
  s = s.replace(/[*^]+$/, '');
  // Strip trailing single-digit ISIN-suffix (e.g. LALPATHLAB6, BAJFINANCE6)
  s = s.replace(/(\D)\d$/, '$1');
  return s;
}

export function detectTaxPnlDividends(bytes: Buffer): boolean {
  const wb = readWorkbook(bytes);
  if (!wb) return false;
  const aoa = aoaForSheet(wb, 'Equity Dividends');
  if (!aoa) return false;
  return headerMatches(aoa[HEADER_ROW_IDX]);
}

export function parseTaxPnlDividends(bytes: Buffer): DividendRow[] {
  const wb = readWorkbook(bytes);
  if (!wb) throw new Error('zerodhaTaxPnlDividends: could not read workbook');
  const aoa = aoaForSheet(wb, 'Equity Dividends');
  if (!aoa) throw new Error('zerodhaTaxPnlDividends: missing "Equity Dividends" sheet');
  if (!headerMatches(aoa[HEADER_ROW_IDX])) {
    throw new Error('zerodhaTaxPnlDividends: header row mismatch at row 15');
  }

  const out: DividendRow[] = [];
  for (let i = HEADER_ROW_IDX + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row) continue;
    const sym = row[0];
    if (typeof sym !== 'string' || !sym) continue;
    if (sym.trim() === 'Total Dividend Amount') break;

    const symbol = cleanSymbol(sym);
    const isin = typeof row[1] === 'string' ? (row[1] as string).trim() || undefined : undefined;
    const exDate = toIsoDate(row[2]);
    const qty = toNumber(row[3]);
    const dividendPerShare = toNumber(row[4]);
    const netAmount = toNumber(row[5]);

    out.push({ symbol, isin, exDate, qty, dividendPerShare, netAmount, currency: 'INR' });
  }
  return out;
}
