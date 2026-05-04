import * as XLSX from 'xlsx';
import type { NormalizedTrade, ParserModule } from '@/lib/parsers/types';

// IndMoney US-equities order report ("IND-ORDER_REPORT...xls").
// Single sheet `ORDER_BOOK`. The first ~10 rows are an account-metadata block
// (Broker Account, Period From/To, totals) that contains the user's broker
// client ID — we must NEVER read or persist any of those values. The trade
// header row is found by sniffing for IndMoney's specific column signature.
//
// Canonical column layout (case-insensitive, whitespace-tolerant):
//   Stock Name | Stock Symbol | Order Placed Time | Order Execution Time |
//   Broker Reference Id | Transaction Type | Order Type |
//   Quantity | Price ($) | Order Amount ($) | Brokerage ($)
//
// Currency is USD (price column header is "Price ($)").

type FieldKey =
  | 'stockName'
  | 'symbol'
  | 'placedTime'
  | 'execTime'
  | 'brokerRef'
  | 'side'
  | 'orderType'
  | 'qty'
  | 'price'
  | 'orderAmount'
  | 'brokerage';

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  stockName: ['stock name'],
  symbol: ['stock symbol', 'symbol'],
  placedTime: ['order placed time'],
  execTime: ['order execution time'],
  brokerRef: ['broker reference id', 'broker reference', 'reference id'],
  side: ['transaction type', 'trade type'],
  orderType: ['order type'],
  qty: ['quantity', 'qty'],
  price: ['price ($)', 'price'],
  orderAmount: ['order amount ($)', 'order amount'],
  brokerage: ['brokerage ($)', 'brokerage'],
};

// IndMoney's distinguishing column set: these four together don't appear in
// Zerodha or Groww headers, so detect can return true ONLY for IndMoney files.
const REQUIRED_FIELDS: FieldKey[] = [
  'symbol',
  'execTime',
  'brokerRef',
  'side',
  'qty',
  'price',
  'orderAmount',
];

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function normalizeHeader(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function buildHeaderIndex(headerRow: unknown[]): Partial<Record<FieldKey, number>> | null {
  const idx: Partial<Record<FieldKey, number>> = {};
  const normalized = headerRow.map(normalizeHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [FieldKey, string[]][]) {
    for (let i = 0; i < normalized.length; i++) {
      const cell = normalized[i];
      if (cell !== undefined && aliases.includes(cell)) {
        idx[field] = i;
        break;
      }
    }
  }
  for (const req of REQUIRED_FIELDS) {
    if (idx[req] === undefined) return null;
  }
  return idx;
}

function readWorkbook(bytes: Buffer): XLSX.WorkBook | null {
  try {
    return XLSX.read(bytes, { type: 'buffer', cellDates: false });
  } catch {
    return null;
  }
}

function orderBookAoa(wb: XLSX.WorkBook): unknown[][] | null {
  // Prefer a sheet named ORDER_BOOK; fall back to the first sheet.
  const name = wb.SheetNames.find((n) => n.toUpperCase() === 'ORDER_BOOK') ?? wb.SheetNames[0];
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

function findHeaderRow(aoa: unknown[][]): {
  rowIdx: number;
  index: Partial<Record<FieldKey, number>>;
} | null {
  // Header is at row 10 in known fixtures; scan the first 30 rows defensively.
  const limit = Math.min(aoa.length, 30);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const idx = buildHeaderIndex(row);
    if (idx) return { rowIdx: i, index: idx };
  }
  return null;
}

function parseIndmoneyDateTime(value: unknown): { iso: string; timestamp: string } {
  // Expected format: "15 Apr 2025, 09:23 PM" (also accept "9 Apr 2025, 9:03 AM").
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const m = trimmed.match(
      /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm]))?/,
    );
    if (m) {
      const day = Number(m[1]);
      const monStr = (m[2] ?? '').toLowerCase();
      const year = Number(m[3]);
      const monNum = MONTHS[monStr];
      if (!monNum) throw new Error(`indmoneyParser: unknown month "${m[2]}" in "${trimmed}"`);
      const yyyy = String(year).padStart(4, '0');
      const mm = String(monNum).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      const iso = `${yyyy}-${mm}-${dd}`;
      let hh = 0;
      let min = 0;
      let sec = 0;
      if (m[4] !== undefined) {
        hh = Number(m[4]);
        min = Number(m[5]);
        sec = m[6] !== undefined ? Number(m[6]) : 0;
        const ampm = m[7]?.toLowerCase();
        if (ampm === 'pm' && hh < 12) hh += 12;
        if (ampm === 'am' && hh === 12) hh = 0;
      }
      const timestamp = `${iso}T${String(hh).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
      return { iso, timestamp };
    }
    // Fallback: ISO-like.
    const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      const iso = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      return { iso, timestamp: iso };
    }
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) {
      const yyyy = String(parsed.y).padStart(4, '0');
      const mm = String(parsed.m).padStart(2, '0');
      const dd = String(parsed.d).padStart(2, '0');
      const hh = String(parsed.H).padStart(2, '0');
      const min = String(parsed.M).padStart(2, '0');
      const sec = String(Math.round(parsed.S)).padStart(2, '0');
      const iso = `${yyyy}-${mm}-${dd}`;
      return { iso, timestamp: `${iso}T${hh}:${min}:${sec}` };
    }
  }
  throw new Error(`indmoneyParser: unrecognised date value: ${String(value)}`);
}

function toSide(value: unknown): 'buy' | 'sell' {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  throw new Error(`indmoneyParser: unknown transaction type: ${String(value)}`);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,$\s]/g, '').trim();
    const n = Number(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`indmoneyParser: expected numeric value, got ${String(value)}`);
}

function toOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length === 0 ? undefined : s;
}

function loadAoa(file: { name: string; bytes: Buffer }): unknown[][] | null {
  const wb = readWorkbook(file.bytes);
  if (!wb) return null;
  return orderBookAoa(wb);
}

function rowsToTrades(
  aoa: unknown[][],
  headerRowIdx: number,
  index: Partial<Record<FieldKey, number>>,
): NormalizedTrade[] {
  const trades: NormalizedTrade[] = [];
  for (let i = headerRowIdx + 1; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row) continue;
    const symbol = toOptionalString(row[index.symbol!]);
    if (!symbol) continue;
    // Skip the disclaimer block at the bottom: those rows have no value in the
    // exec-time column.
    const execRaw = row[index.execTime!];
    if (execRaw === null || execRaw === undefined || execRaw === '') continue;

    const { iso: tradeDate, timestamp: execTime } = parseIndmoneyDateTime(execRaw);

    const trade: NormalizedTrade = {
      brokerCode: 'indmoney',
      symbol,
      tradeDate,
      side: toSide(row[index.side!]),
      qty: toNumber(row[index.qty!]),
      price: toNumber(row[index.price!]),
      currency: 'USD',
      execTime,
      rawRowIdx: i + 1,
    };

    if (index.brokerRef !== undefined) {
      const ref = toOptionalString(row[index.brokerRef]);
      if (ref) trade.orderId = ref;
    }
    trades.push(trade);
  }
  return trades;
}

export const indmoneyParser: ParserModule = {
  code: 'indmoney',

  detect(file) {
    const aoa = loadAoa(file);
    if (!aoa) return false;
    return findHeaderRow(aoa) !== null;
  },

  parse(file) {
    const aoa = loadAoa(file);
    if (!aoa) throw new Error('indmoneyParser: could not read input as xlsx');
    const header = findHeaderRow(aoa);
    if (!header) throw new Error('indmoneyParser: header row not found');
    return rowsToTrades(aoa, header.rowIdx, header.index);
  },
};
