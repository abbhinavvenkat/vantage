/**
 * Bulk-ingests dividends from Zerodha Tax P&L files.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/bulk-ingest-dividends.ts                  # uses ./data/zerodha_taxpnl
 *   npx tsx scripts/bulk-ingest-dividends.ts <dir>            # custom dir
 *   npx tsx scripts/bulk-ingest-dividends.ts <dir> <portfolioName>
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { detectTaxPnlDividends, parseTaxPnlDividends } from '@/lib/parsers/zerodhaTaxPnlDividends';
import { insertDividends, type DividendInput } from '@/lib/db/queries/dividends';

const DEFAULT_DIR = resolve('./data/zerodha_taxpnl');
const DEFAULT_PORTFOLIO = process.env.PORTFOLIO_NAME ?? '';
const dbUrl = process.env.DATABASE_URL ?? 'file:./data/app.db';
const dbPath = dbUrl.startsWith('file:') ? resolve(dbUrl.slice(5)) : resolve(dbUrl);

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? DEFAULT_DIR);
  const portfolioName = process.argv[3] ?? DEFAULT_PORTFOLIO;

  if (!existsSync(dir)) throw new Error(`Tax P&L dir not found: ${dir}`);
  if (!existsSync(dbPath)) throw new Error(`app.db not found: ${dbPath}`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  const all = db.select().from(portfolios).all();
  const target = all.find((p) => p.name.toLowerCase() === portfolioName.toLowerCase());
  if (!target) {
    console.error(
      `Portfolio "${portfolioName}" not found. Available: ${all.map((p) => p.name).join(', ')}`,
    );
    process.exit(1);
  }

  console.log(`db:        ${dbPath}`);
  console.log(`portfolio: ${target.name} (${target.id})`);
  console.log(`directory: ${dir}`);

  const files = readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.xlsx') && !f.startsWith('~$'))
    .sort();
  if (files.length === 0) {
    console.error('No xlsx files found.');
    process.exit(1);
  }

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalAmount = 0;

  for (const f of files) {
    const full = resolve(dir, f);
    const bytes = readFileSync(full);
    if (!detectTaxPnlDividends(bytes)) {
      console.log(`  ✗ ${f.padEnd(45)} — not a Tax P&L Equity Dividends sheet`);
      continue;
    }
    let parsed;
    try {
      parsed = parseTaxPnlDividends(bytes);
    } catch (err) {
      console.log(`  ✗ ${f.padEnd(45)} — parse error: ${(err as Error).message}`);
      continue;
    }
    const sourceFileHash = createHash('sha256').update(bytes).digest('hex');
    const rows: DividendInput[] = parsed.map((d) => ({
      symbol: d.symbol,
      isin: d.isin ?? null,
      exDate: d.exDate,
      qty: d.qty,
      dividendPerShare: d.dividendPerShare,
      netAmount: d.netAmount,
      currency: d.currency,
      sourceFileHash,
    }));
    const r = insertDividends(db, target.id, rows);
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
    const amt = parsed.reduce((s, d) => s + d.netAmount, 0);
    totalAmount += amt;
    console.log(
      `  ✓ ${f.padEnd(45)} parsed=${String(parsed.length).padStart(3)} inserted=${String(r.inserted).padStart(3)} skipped=${String(r.skipped).padStart(3)} ₹${amt.toFixed(2).padStart(10)}`,
    );
  }

  console.log(
    `\nTotal: ${totalInserted} new + ${totalSkipped} skipped (idempotent), gross dividends ingested: ₹${totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
  );
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
