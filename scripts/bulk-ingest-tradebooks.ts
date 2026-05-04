/**
 * Bulk-ingest all xlsx tradebooks from a directory into the live app.db.
 * Idempotent — safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/bulk-ingest-tradebooks.ts                  # uses ./Zerodha Data
 *   npx tsx scripts/bulk-ingest-tradebooks.ts <dir>            # custom dir
 *   npx tsx scripts/bulk-ingest-tradebooks.ts <dir> <portfolioName>
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { detectParser } from '@/lib/parsers/registry';
import { getOrCreateAccount } from '@/lib/db/queries/accounts';
import { insertTrades, type NormalizedTradeInput } from '@/lib/db/queries/trades';

const DEFAULT_DIR = resolve('./Zerodha Data');
const DEFAULT_PORTFOLIO = process.env.PORTFOLIO_NAME ?? '';
const dbUrl = process.env.DATABASE_URL ?? 'file:./data/app.db';
const dbPath = dbUrl.startsWith('file:') ? resolve(dbUrl.slice(5)) : resolve(dbUrl);

async function main(): Promise<void> {
  const dir = resolve(process.argv[2] ?? DEFAULT_DIR);
  const portfolioName = process.argv[3] ?? DEFAULT_PORTFOLIO;

  if (!existsSync(dir)) throw new Error(`Tradebook directory not found: ${dir}`);
  if (!existsSync(dbPath)) throw new Error(`app.db not found at ${dbPath}. Run db:migrate first.`);

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });

  // Find target portfolio
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
    .filter((f) => f.toLowerCase().endsWith('.xlsx'))
    .sort();
  if (files.length === 0) {
    console.error(`No xlsx files in ${dir}`);
    process.exit(1);
  }

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const f of files) {
    const full = resolve(dir, f);
    const bytes = readFileSync(full);
    const parser = detectParser({ name: f, bytes });
    if (!parser) {
      console.log(`  ✗ ${f.padEnd(40)} — no parser matched`);
      continue;
    }
    let parsed;
    try {
      parsed = parser.parse({ name: f, bytes });
    } catch (err) {
      console.log(`  ✗ ${f.padEnd(40)} — parse error: ${(err as Error).message}`);
      continue;
    }
    const sourceFileHash = createHash('sha256').update(bytes).digest('hex');
    const account = getOrCreateAccount(db, target.id, parser.code, parser.code);
    const rows: NormalizedTradeInput[] = parsed.map((t) => ({
      symbol: t.symbol,
      isin: t.isin ?? null,
      tradeDate: t.tradeDate,
      side: t.side,
      qty: t.qty,
      price: t.price,
      currency: t.currency,
      exchange: t.exchange ?? null,
      segment: t.segment ?? null,
      series: t.series ?? null,
      tradeId: t.tradeId ?? null,
      orderId: t.orderId ?? null,
      execTime: t.execTime ?? null,
      sourceFileHash,
      sourceRowIdx: t.rawRowIdx ?? null,
    }));
    const r = insertTrades(db, account.id, rows);
    totalInserted += r.inserted;
    totalSkipped += r.skipped;
    console.log(
      `  ✓ ${f.padEnd(40)} broker=${parser.code} parsed=${String(parsed.length).padStart(4)} inserted=${String(r.inserted).padStart(4)} skipped=${String(r.skipped).padStart(4)}`,
    );
  }

  console.log(`\nTotal: ${totalInserted} inserted, ${totalSkipped} skipped (idempotent)`);
  sqlite.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
