import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('./Zerodha Data');
const TARGET = (process.argv[2] ?? 'ITC').toUpperCase();
const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.xlsx'))
  .sort();

type Row = {
  date: string;
  side: string;
  qty: number;
  price: number;
  tradeId: string;
  file: string;
};
const rows: Row[] = [];

for (const f of files) {
  const wb = XLSX.read(readFileSync(resolve(DIR, f)), { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  for (let i = 15; i < aoa.length; i++) {
    const row = aoa[i];
    if (!row || typeof row[0] !== 'string') continue;
    if (row[0].trim() !== TARGET) continue;
    rows.push({
      date: String(row[2]),
      side: String(row[6]),
      qty: Number(row[8]),
      price: Number(row[9]),
      tradeId: String(row[10]),
      file: f,
    });
  }
}

rows.sort((a, b) => a.date.localeCompare(b.date));

let cum = 0;
console.log(`${TARGET} trades (cumulative net qty):`);
console.log(
  `${'Date'.padEnd(12)} ${'Side'.padEnd(6)} ${'Qty'.padStart(8)} ${'Price'.padStart(12)} ${'Cum'.padStart(8)}  TradeID  File`,
);
for (const r of rows) {
  cum += r.side === 'buy' ? r.qty : -r.qty;
  const flag = cum < 0 ? '  ⚠ NEGATIVE' : '';
  console.log(
    `${r.date.padEnd(12)} ${r.side.padEnd(6)} ${String(r.qty).padStart(8)} ${r.price.toFixed(2).padStart(12)} ${String(cum).padStart(8)}  ${r.tradeId}  ${r.file}${flag}`,
  );
}
