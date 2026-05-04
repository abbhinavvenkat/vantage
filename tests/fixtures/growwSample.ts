import * as XLSX from 'xlsx';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const GROWW_HEADERS = [
  'Stock Symbol',
  'ISIN',
  'Trade Date',
  'Exchange',
  'Segment',
  'Series',
  'Trade Type',
  'Quantity',
  'Price',
  'Trade ID',
  'Order ID',
  'Order Execution Time',
] as const;

const SYMBOLS: Record<string, string> = {
  'ACME-EQ': 'INE000ACME01',
  'BETA-EQ': 'INE000BETA02',
  'GAMMA-EQ': 'INE000GAMM03',
};

export type GrowwTradeSpec = {
  symbol: string;
  date: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  hms: string;
};

export const GROWW_SYNTHETIC_TRADES: GrowwTradeSpec[] = [
  { symbol: 'ACME-EQ', date: '2024-04-02', side: 'BUY', qty: 50, price: 100.5, hms: '09:20:11' },
  { symbol: 'ACME-EQ', date: '2024-04-15', side: 'BUY', qty: 25, price: 110.0, hms: '10:05:00' },
  { symbol: 'ACME-EQ', date: '2024-06-10', side: 'SELL', qty: 30, price: 130.25, hms: '11:30:45' },

  { symbol: 'BETA-EQ', date: '2024-04-03', side: 'BUY', qty: 100, price: 250.0, hms: '09:30:00' },
  { symbol: 'BETA-EQ', date: '2024-08-12', side: 'SELL', qty: 60, price: 310.75, hms: '13:45:10' },

  { symbol: 'GAMMA-EQ', date: '2024-04-08', side: 'BUY', qty: 200, price: 50.0, hms: '09:45:00' },
  { symbol: 'GAMMA-EQ', date: '2024-07-22', side: 'SELL', qty: 100, price: 65.5, hms: '12:00:00' },
];

export function buildGrowwWorkbook(): XLSX.WorkBook {
  const aoa: (string | number)[][] = [];
  aoa.push([...GROWW_HEADERS]);
  let tradeSeq = 700000000;
  let orderSeq = 800000000;
  for (const t of GROWW_SYNTHETIC_TRADES) {
    aoa.push([
      t.symbol,
      SYMBOLS[t.symbol] ?? 'INE000XXXX00',
      t.date,
      'NSE',
      'EQ',
      'EQ',
      t.side,
      t.qty,
      t.price,
      String(++tradeSeq),
      String(++orderSeq),
      `${t.date}T${t.hms}`,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tradebook');
  return wb;
}

export function buildGrowwCsv(): string {
  const lines: string[] = [];
  lines.push(GROWW_HEADERS.join(','));
  let tradeSeq = 700000000;
  let orderSeq = 800000000;
  for (const t of GROWW_SYNTHETIC_TRADES) {
    const row = [
      t.symbol,
      SYMBOLS[t.symbol] ?? 'INE000XXXX00',
      t.date,
      'NSE',
      'EQ',
      'EQ',
      t.side,
      String(t.qty),
      String(t.price),
      String(++tradeSeq),
      String(++orderSeq),
      `${t.date}T${t.hms}`,
    ];
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

export function writeGrowwXlsxFixture(outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  const buf = XLSX.write(buildGrowwWorkbook(), { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(outPath, buf);
}

export const GROWW_XLSX_FIXTURE_PATH = resolve(
  process.cwd(),
  'data/sample/synthetic-tradebook-groww.xlsx',
);

export function ensureGrowwXlsxFixture(path: string = GROWW_XLSX_FIXTURE_PATH): string {
  if (!existsSync(path)) writeGrowwXlsxFixture(path);
  return path;
}
