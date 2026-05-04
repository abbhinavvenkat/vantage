import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const path = resolve(process.env.HOLDINGS_FILE ?? './Zerodha Data/holdings.xlsx');
const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: false });
console.log('Sheets:', wb.SheetNames);
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]!;
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });
  console.log(`\n=== ${name} (${aoa.length} rows) ===`);
  for (let i = 0; i < Math.min(aoa.length, 60); i++) {
    console.log(i, JSON.stringify(aoa[i]));
  }
}
