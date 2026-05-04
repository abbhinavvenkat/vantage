import * as XLSX from 'xlsx';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const HEADERS = [
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

const SYMBOLS: Record<string, string> = {
  'ACME-EQ': 'INE000ACME01',
  'BETA-EQ': 'INE000BETA02',
  'GAMMA-EQ': 'INE000GAMM03',
  'DELTA-EQ': 'INE000DELT04',
  'EPSILON-EQ': 'INE000EPSI05',
};

export type SyntheticTradeSpec = {
  symbol: string;
  date: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  hms: string;
};

export const SYNTHETIC_TRADES: SyntheticTradeSpec[] = [
  { symbol: 'ACME-EQ', date: '2024-04-02', side: 'buy', qty: 50, price: 100.5, hms: '09:20:11' },
  { symbol: 'ACME-EQ', date: '2024-04-15', side: 'buy', qty: 25, price: 110.0, hms: '10:05:00' },
  { symbol: 'ACME-EQ', date: '2024-06-10', side: 'sell', qty: 30, price: 130.25, hms: '11:30:45' },

  { symbol: 'BETA-EQ', date: '2024-04-03', side: 'buy', qty: 100, price: 250.0, hms: '09:30:00' },
  { symbol: 'BETA-EQ', date: '2024-05-20', side: 'buy', qty: 50, price: 275.5, hms: '14:15:22' },
  { symbol: 'BETA-EQ', date: '2024-08-12', side: 'sell', qty: 60, price: 310.75, hms: '13:45:10' },
  { symbol: 'BETA-EQ', date: '2024-10-05', side: 'buy', qty: 30, price: 295.0, hms: '10:10:10' },

  { symbol: 'GAMMA-EQ', date: '2024-04-08', side: 'buy', qty: 200, price: 50.0, hms: '09:45:00' },
  { symbol: 'GAMMA-EQ', date: '2024-07-22', side: 'sell', qty: 100, price: 65.5, hms: '12:00:00' },
  { symbol: 'GAMMA-EQ', date: '2024-09-30', side: 'sell', qty: 50, price: 72.0, hms: '15:10:00' },
  { symbol: 'GAMMA-EQ', date: '2024-11-11', side: 'buy', qty: 75, price: 68.25, hms: '11:11:11' },

  { symbol: 'DELTA-EQ', date: '2024-05-01', side: 'buy', qty: 40, price: 480.0, hms: '09:25:00' },
  { symbol: 'DELTA-EQ', date: '2024-06-18', side: 'buy', qty: 20, price: 510.5, hms: '10:30:30' },
  { symbol: 'DELTA-EQ', date: '2024-08-29', side: 'buy', qty: 15, price: 495.0, hms: '14:00:00' },
  { symbol: 'DELTA-EQ', date: '2024-12-03', side: 'sell', qty: 25, price: 555.75, hms: '13:20:00' },

  { symbol: 'EPSILON-EQ', date: '2024-04-22', side: 'buy', qty: 80, price: 75.5, hms: '09:50:00' },
  { symbol: 'EPSILON-EQ', date: '2024-07-10', side: 'buy', qty: 40, price: 82.0, hms: '11:00:00' },
  {
    symbol: 'EPSILON-EQ',
    date: '2024-09-05',
    side: 'sell',
    qty: 50,
    price: 95.25,
    hms: '14:45:00',
  },
  { symbol: 'EPSILON-EQ', date: '2024-10-19', side: 'sell', qty: 30, price: 88.0, hms: '10:20:00' },
  { symbol: 'EPSILON-EQ', date: '2024-12-15', side: 'buy', qty: 60, price: 90.5, hms: '12:30:00' },

  { symbol: 'ACME-EQ', date: '2024-09-12', side: 'buy', qty: 20, price: 125.0, hms: '09:35:00' },
  { symbol: 'BETA-EQ', date: '2024-11-25', side: 'sell', qty: 40, price: 320.0, hms: '13:00:00' },
  { symbol: 'GAMMA-EQ', date: '2024-12-20', side: 'buy', qty: 100, price: 70.0, hms: '11:45:00' },
  { symbol: 'DELTA-EQ', date: '2025-01-15', side: 'sell', qty: 30, price: 540.0, hms: '14:30:00' },

  { symbol: 'ACME-EQ', date: '2024-05-06', side: 'buy', qty: 10, price: 200.0, hms: '10:00:00' },

  { symbol: 'GAMMA-EQ', date: '2024-06-05', side: 'buy', qty: 50, price: 60.0, hms: '09:30:00' },
  { symbol: 'GAMMA-EQ', date: '2024-06-05', side: 'sell', qty: 50, price: 62.5, hms: '14:30:00' },

  { symbol: 'DELTA-EQ', date: '2024-07-15', side: 'buy', qty: 10, price: 500.0, hms: '10:15:00' },
  { symbol: 'DELTA-EQ', date: '2024-07-15', side: 'sell', qty: 10, price: 495.0, hms: '15:00:00' },

  { symbol: 'EPSILON-EQ', date: '2024-08-08', side: 'sell', qty: 25, price: 85.0, hms: '09:45:00' },
  { symbol: 'EPSILON-EQ', date: '2024-08-08', side: 'buy', qty: 25, price: 80.0, hms: '14:00:00' },
];

export function buildZerodhaWorkbook(): XLSX.WorkBook {
  const aoa: (string | number)[][] = [];
  for (let i = 0; i < 14; i++) {
    if (i === 0) aoa.push(['Tradebook for synthetic test fixture']);
    else if (i === 2) aoa.push(['Account', 'SYNTHETIC']);
    else if (i === 4) aoa.push(['Period', '2024-04-01 to 2025-03-31']);
    else aoa.push([]);
  }
  aoa.push([...HEADERS]);
  let tradeSeq = 100000000;
  let orderSeq = 200000000;
  for (const t of SYNTHETIC_TRADES) {
    aoa.push([
      t.symbol,
      SYMBOLS[t.symbol] ?? 'INE000XXXX00',
      t.date,
      'NSE',
      'EQ',
      'EQ',
      t.side,
      'false',
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

export function writeZerodhaFixture(outPath: string): void {
  mkdirSync(dirname(outPath), { recursive: true });
  XLSX.writeFile(buildZerodhaWorkbook(), outPath);
}

export const SAMPLE_FIXTURE_PATH = resolve(
  process.cwd(),
  'data/sample/synthetic-tradebook-zerodha.xlsx',
);

export function ensureZerodhaFixture(path: string = SAMPLE_FIXTURE_PATH): string {
  if (!existsSync(path)) writeZerodhaFixture(path);
  return path;
}
