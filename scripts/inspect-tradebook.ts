import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('./Zerodha Data');
const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.xlsx'))
  .sort();

for (const f of files) {
  const wb = XLSX.read(readFileSync(resolve(DIR, f)), { type: 'buffer', cellDates: false });
  console.log(`\n=== ${f} ===`);
  console.log(`  sheets: ${wb.SheetNames.join(', ')}`);
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      blankrows: true,
      defval: null,
    });
    console.log(
      `  [${name}] rows=${aoa.length}, header@row15: ${JSON.stringify((aoa[14] ?? []).slice(0, 13))}`,
    );
    // Count ITC rows in this sheet
    let itcRows = 0;
    let firstItc: unknown[] | null = null;
    for (let i = 15; i < aoa.length; i++) {
      const row = aoa[i];
      if (!row) continue;
      if (typeof row[0] === 'string' && row[0].trim() === 'ITC') {
        itcRows++;
        if (!firstItc) firstItc = row;
      }
    }
    if (itcRows > 0) {
      console.log(`    ITC rows in this sheet: ${itcRows}, first: ${JSON.stringify(firstItc)}`);
    }
  }
}
