import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import type { NormalizedTrade, ParserModule } from '@/lib/parsers/types';

// Groww trade history exports come in two shapes we accept here:
//   - xlsx: Tradebook with the header row at the top of the first sheet
//   - csv:  same column layout, comma-separated
//
// We always sniff by header content (NEVER filename) per .claude/rules/stock-platform.md.
//
// Canonical column layout (case-insensitive, whitespace-tolerant):
//   Stock Symbol | ISIN | Trade Date | Exchange | Segment | Series |
//   Trade Type   | Quantity | Price | Trade ID | Order ID | Order Execution Time
//
// We also tolerate the older Groww header `Symbol` instead of `Stock Symbol`.

type FieldKey =
  | 'symbol'
  | 'isin'
  | 'tradeDate'
  | 'exchange'
  | 'segment'
  | 'series'
  | 'side'
  | 'qty'
  | 'price'
  | 'tradeId'
  | 'orderId'
  | 'execTime';

const HEADER_ALIASES: Record<FieldKey, string[]> = {
  symbol: ['stock symbol', 'symbol', 'scrip', 'tradingsymbol'],
  isin: ['isin'],
  tradeDate: ['trade date', 'date'],
  exchange: ['exchange'],
  segment: ['segment'],
  series: ['series'],
  side: ['trade type', 'buy/sell', 'side'],
  qty: ['quantity', 'qty'],
  price: ['price', 'avg price', 'average price'],
  tradeId: ['trade id', 'tradeid', 'trade no', 'trade number'],
  orderId: ['order id', 'orderid', 'order no', 'order number'],
  execTime: ['order execution time', 'execution time', 'time', 'trade time'],
};

const REQUIRED_FIELDS: FieldKey[] = ['symbol', 'tradeDate', 'side', 'qty', 'price'];
// At least one of these dedup-id fields must be present in a Groww header row.
// Avoids false-positives on ad-hoc trade CSVs that share the basic columns.
const REQUIRED_ANY_OF: FieldKey[] = ['tradeId', 'orderId'];

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
  if (!REQUIRED_ANY_OF.some((f) => idx[f] !== undefined)) return null;
  return idx;
}

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

function findHeaderRow(aoa: unknown[][]): {
  rowIdx: number;
  index: Partial<Record<FieldKey, number>>;
} | null {
  // Scan up to first 30 rows; Groww xlsx puts headers on row 0 but be permissive.
  const limit = Math.min(aoa.length, 30);
  for (let i = 0; i < limit; i++) {
    const row = aoa[i];
    if (!row || row.length === 0) continue;
    const idx = buildHeaderIndex(row);
    if (idx) return { rowIdx: i, index: idx };
  }
  return null;
}

function looksLikeCsv(bytes: Buffer): boolean {
  // Heuristic: utf-8 decodable, contains a newline and a comma in the first 4 KB,
  // and does not start with the ZIP signature 'PK' that xlsx files have.
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) return false;
  const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('utf8');
  if (!head.includes('\n')) return false;
  if (!head.includes(',')) return false;
  // Reject if the head contains too many NUL bytes (binary file).
  let nulls = 0;
  for (let i = 0; i < Math.min(head.length, 1024); i++) {
    if (head.charCodeAt(i) === 0) nulls++;
  }
  return nulls < 4;
}

function parseCsvAoa(bytes: Buffer): unknown[][] | null {
  try {
    const text = bytes.toString('utf8');
    const result = Papa.parse<unknown[]>(text, {
      header: false,
      skipEmptyLines: false,
      dynamicTyping: false,
    });
    if (!result?.data) return null;
    return result.data;
  } catch {
    return null;
  }
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
  throw new Error(`growwParser: unrecognised trade date value: ${String(value)}`);
}

function toSide(value: unknown): 'buy' | 'sell' {
  const s = String(value ?? '')
    .trim()
    .toLowerCase();
  if (s === 'buy' || s === 'b') return 'buy';
  if (s === 'sell' || s === 's') return 'sell';
  throw new Error(`growwParser: unknown trade type: ${String(value)}`);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    const n = Number(cleaned);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`growwParser: expected numeric value, got ${String(value)}`);
}

function toOptionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s.length === 0 ? undefined : s;
}

// xlsx auto-coerces ISO datetimes to Excel date serials when the sheet is built
// from a JS string. When we read them back, `Order Execution Time` arrives as a
// number. Convert it back to an ISO `yyyy-mm-ddTHH:MM:SS` string so dedup keys
// stay stable across xlsx and csv ingest paths.
function toOptionalExecTime(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return undefined;
    const y = String(parsed.y).padStart(4, '0');
    const m = String(parsed.m).padStart(2, '0');
    const d = String(parsed.d).padStart(2, '0');
    const hh = String(parsed.H).padStart(2, '0');
    const mm = String(parsed.M).padStart(2, '0');
    const ss = String(Math.round(parsed.S)).padStart(2, '0');
    return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
  }
  return toOptionalString(value);
}

function loadAoa(file: { name: string; bytes: Buffer }): unknown[][] | null {
  // Try xlsx first.
  const wb = readWorkbook(file.bytes);
  if (wb) {
    const aoa = firstSheetAoa(wb);
    if (aoa && aoa.some((r) => r && r.length > 0)) return aoa;
  }
  // Fall back to CSV.
  if (looksLikeCsv(file.bytes)) {
    return parseCsvAoa(file.bytes);
  }
  return null;
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

    const trade: NormalizedTrade = {
      brokerCode: 'groww',
      symbol,
      tradeDate: toIsoDate(row[index.tradeDate!]),
      side: toSide(row[index.side!]),
      qty: toNumber(row[index.qty!]),
      price: toNumber(row[index.price!]),
      currency: 'INR',
      rawRowIdx: i + 1,
    };

    if (index.isin !== undefined) {
      const isin = toOptionalString(row[index.isin]);
      if (isin) trade.isin = isin;
    }
    if (index.exchange !== undefined) {
      const exchange = toOptionalString(row[index.exchange]);
      if (exchange) trade.exchange = exchange;
    }
    if (index.segment !== undefined) {
      const segment = toOptionalString(row[index.segment]);
      if (segment) trade.segment = segment;
    }
    if (index.series !== undefined) {
      const series = toOptionalString(row[index.series]);
      if (series) trade.series = series;
    }
    if (index.tradeId !== undefined) {
      const tradeId = toOptionalString(row[index.tradeId]);
      if (tradeId) trade.tradeId = tradeId;
    }
    if (index.orderId !== undefined) {
      const orderId = toOptionalString(row[index.orderId]);
      if (orderId) trade.orderId = orderId;
    }
    if (index.execTime !== undefined) {
      const execTime = toOptionalExecTime(row[index.execTime]);
      if (execTime) trade.execTime = execTime;
    }
    trades.push(trade);
  }
  return trades;
}

export const growwParser: ParserModule = {
  code: 'groww',

  detect(file) {
    const aoa = loadAoa(file);
    if (!aoa) return false;
    return findHeaderRow(aoa) !== null;
  },

  parse(file) {
    const aoa = loadAoa(file);
    if (!aoa) throw new Error('growwParser: could not read input as xlsx or csv');
    const header = findHeaderRow(aoa);
    if (!header) throw new Error('growwParser: header row not found');
    return rowsToTrades(aoa, header.rowIdx, header.index);
  },
};
