import * as XLSX from 'xlsx';
import type { NormalizedTrade, ParserModule } from '@/lib/parsers/types';

const HEADER_ROW_IDX = 14;
const EXPECTED_HEADERS = [
  'Symbol',
  'ISIN',
  'Trade Date',
  'Exchange',
  'Segment',
  'Series',
  'Trade Type',
  'Auction',
  'Quantity',
  'Price',
  'Trade ID',
  'Order ID',
  'Order Execution Time',
] as const;

function readWorkbook(bytes: Buffer): XLSX.WorkBook | null {
  try {
    return XLSX.read(bytes, { type: 'buffer', cellDates: false });
  } catch {
    return null;
  }
}

function firstSheetAoa(wb: XLSX.WorkBook): unknown[][] | null {
  const name = wb.SheetNames[0];
  if (!name) return null;
  const ws = wb.Sheets[name];
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
  if (row.length < EXPECTED_HEADERS.length) return false;
  for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
    const cell = row[i];
    if (typeof cell !== 'string') return false;
    if (cell.trim() !== EXPECTED_HEADERS[i]) return false;
  }
  return true;
}

function toIsoDate(value: unknown): string {
  if (value instanceof Date) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const y = String(parsed.y).padStart(4, '0');
      const m = String(parsed.m).padStart(2, '0');
      const d = String(parsed.d).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const dmyMatch = trimmed.match(/^(\d{2})[/-](\d{2})[/-](\d{4})/);
    if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
  }
  throw new Error(`zerodhaParser: unrecognised trade date value: ${String(value)}`);
}

function toSide(value: unknown): 'buy' | 'sell' {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  throw new Error(`zerodhaParser: unknown trade type: ${String(value)}`);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    const n = Number(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`zerodhaParser: expected numeric value, got ${String(value)}`);
}

function toOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length === 0 ? undefined : s;
}

export const zerodhaParser: ParserModule = {
  code: 'zerodha',

  detect(file) {
    const wb = readWorkbook(file.bytes);
    if (!wb) return false;
    const aoa = firstSheetAoa(wb);
    if (!aoa) return false;
    return headerMatches(aoa[HEADER_ROW_IDX]);
  },

  parse(file) {
    const wb = readWorkbook(file.bytes);
    if (!wb) throw new Error('zerodhaParser: could not read workbook');
    const aoa = firstSheetAoa(wb);
    if (!aoa) throw new Error('zerodhaParser: empty workbook');
    if (!headerMatches(aoa[HEADER_ROW_IDX])) {
      throw new Error('zerodhaParser: header row mismatch at row 15');
    }

    const trades: NormalizedTrade[] = [];
    for (let i = HEADER_ROW_IDX + 1; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row) continue;
      const symbol = toOptionalString(row[0]);
      if (!symbol) continue;
      const trade: NormalizedTrade = {
        brokerCode: 'zerodha',
        symbol,
        tradeDate: toIsoDate(row[2]),
        side: toSide(row[6]),
        qty: toNumber(row[8]),
        price: toNumber(row[9]),
        currency: 'INR',
        rawRowIdx: i + 1,
      };
      const isin = toOptionalString(row[1]);
      if (isin) trade.isin = isin;
      const exchange = toOptionalString(row[3]);
      if (exchange) trade.exchange = exchange;
      const segment = toOptionalString(row[4]);
      if (segment) trade.segment = segment;
      const series = toOptionalString(row[5]);
      if (series) trade.series = series;
      const tradeId = toOptionalString(row[10]);
      if (tradeId) trade.tradeId = tradeId;
      const orderId = toOptionalString(row[11]);
      if (orderId) trade.orderId = orderId;
      const execTime = toOptionalString(row[12]);
      if (execTime) trade.execTime = execTime;
      trades.push(trade);
    }
    return trades;
  },
};
