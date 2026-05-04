/**
 * Seed the DB with the synthetic Zerodha fixture for testing.
 * Usage: DATABASE_URL=file:./data/test.db npx tsx scripts/seed-sample.ts
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hash } from '@/lib/auth/password';
import { createUser, userCount } from '@/lib/db/queries/users';
import { createPortfolio } from '@/lib/db/queries/portfolios';
import { getOrCreateAccount } from '@/lib/db/queries/accounts';
import { insertTrades } from '@/lib/db/queries/trades';
import { zerodhaParser } from '@/lib/parsers/zerodha';
import { ensureZerodhaFixture, SAMPLE_FIXTURE_PATH } from '@/tests/fixtures/zerodhaSample';
import * as schema from '@/lib/db/schema';
import { createHash } from 'node:crypto';

function resolveDbPath(): string {
  const url = process.env.DATABASE_URL ?? 'file:./data/app.db';
  if (url.startsWith('file:')) return resolve(url.slice('file:'.length));
  return resolve(url);
}

async function main() {
  const dbPath = resolveDbPath();
  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });
  console.log('[seed] migrations applied');

  // Create user if absent
  if (userCount(db) === 0) {
    const passwordHash = await hash('test_password_123!');
    const user = createUser(db, passwordHash);
    console.log(`[seed] user created id=${user.id}`);
  }

  // Create portfolio
  const portfolio = createPortfolio(db, { name: 'Sample', baseCurrency: 'INR' });
  console.log(`[seed] portfolio created id=${portfolio.id}`);

  // Ingest synthetic fixture
  ensureZerodhaFixture(SAMPLE_FIXTURE_PATH);
  const bytes = readFileSync(SAMPLE_FIXTURE_PATH);
  const trades = zerodhaParser.parse({ name: 'synthetic-tradebook.xlsx', bytes });
  const fileHash = createHash('sha256').update(bytes).digest('hex');

  const account = getOrCreateAccount(db, portfolio.id, 'zerodha', 'zerodha');
  const rows = trades.map((t) => ({
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
    sourceFileHash: fileHash,
    sourceRowIdx: t.rawRowIdx,
  }));

  const result = insertTrades(db, account.id, rows);
  console.log(`[seed] inserted=${result.inserted} skipped=${result.skipped}`);
  console.log(
    `[seed] portfolio id=${portfolio.id} — open http://localhost:3000/p/${portfolio.id}/holdings`,
  );
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
