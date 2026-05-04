import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('./data/zerodha_taxpnl');
const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.xlsx'))
  .sort();

for (const f of files) {
  const wb = XLSX.read(readFileSync(resolve(DIR, f)), { type: 'buffer', cellDates: false });
  console.log(`\n=== ${f} ===`);
  const ws = wb.Sheets['Equity Dividends'];
  if (!ws) {
    console.log('  (no Equity Dividends sheet)');
    continue;
  }
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  for (let i = 0; i < Math.min(aoa.length, 40); i++) {
    const row = aoa[i] ?? [];
    console.log(i, JSON.stringify(row.slice(0, 8)));
  }
  console.log(`  total rows: ${aoa.length}`);
}
