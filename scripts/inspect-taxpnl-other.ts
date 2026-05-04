import * as XLSX from 'xlsx';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DIR = resolve('./data/zerodha_taxpnl');
const files = readdirSync(DIR)
  .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
  .sort();

const TARGET_SHEETS = [
  'Other Debits and Credits',
  'Equity and Non Equity', // includes intraday P&L summary
  'Tradewise Exits from 2020-04-01',
  'Tradewise Exits from 2021-04-01',
  'Tradewise Exits from 2022-04-01',
  'Tradewise Exits from 2023-04-01',
  'Tradewise Exits from 2024-04-01',
  'Tradewise Exits from 2025-04-01',
  'Tradewise Exits from 2026-04-01',
];

for (const f of files) {
  const wb = XLSX.read(readFileSync(resolve(DIR, f)), { type: 'buffer', cellDates: false });
  console.log(`\n========= ${f} =========`);
  console.log(`  sheets: ${wb.SheetNames.join(', ')}`);
  for (const sheet of TARGET_SHEETS) {
    const ws = wb.Sheets[sheet];
    if (!ws) continue;
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      blankrows: true,
      defval: null,
    });
    console.log(`  --- ${sheet} (${aoa.length} rows) ---`);
    const max = sheet.startsWith('Tradewise') ? 25 : aoa.length;
    for (let i = 0; i < Math.min(aoa.length, max); i++) {
      const row = aoa[i] ?? [];
      const trimmed = row.slice(0, 8);
      if (trimmed.every((c) => c == null)) continue;
      console.log(`    ${i}`, JSON.stringify(trimmed));
    }
  }
}
