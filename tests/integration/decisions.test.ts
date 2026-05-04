import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import {
  users,
  portfolios,
  brokers,
  accounts,
  trades,
  pricesEod,
  watchlist,
  decisions,
  portfolioStyleWeights,
} from '@/lib/db/schema';
import { runDecisions } from '@/lib/decisions/run';
import { latestDecisionsByPortfolio, listDecisionSnapshots } from '@/lib/db/queries/decisions';
import {
  loadAllDistilled,
  synthesizeFromDistilled,
  writeRuleLibrary,
} from '@/lib/codex/synthesize';
import { distillInvestor, writeDistilled } from '@/lib/codex/distill';
import { paragraphsToMarkdown } from '@/lib/codex/extract';
import { mkdirSync } from 'node:fs';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let accountId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-decisions-'));
  const dbPath = resolve(tmpDir, 'test.db');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });
});

afterAll(() => {
  try {
    sqlite.close();
  } catch {
    /* ignore */
  }
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const t of [
    'decisions',
    'portfolio_style_weights',
    'trades',
    'accounts',
    'brokers',
    'watchlist',
    'prices_eod',
    'portfolios',
    'users',
  ]) {
    sqlite.exec(`DELETE FROM ${t};`);
  }
  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  portfolioId = pf.id;
  const broker = db.insert(brokers).values({ code: 'zerodha' }).returning().get();
  const acc = db
    .insert(accounts)
    .values({ portfolioId, brokerId: broker.id, alias: 'Test' })
    .returning()
    .get();
  accountId = acc.id;
});

function buildFixtureLibrary(workDir: string) {
  // Create a minimal extracted markdown file for one investor, distill it, then
  // synthesise. This exercises the same code path the live pipeline uses.
  const slugDir = join(workDir, 'extracted', 'buffett');
  mkdirSync(slugDir, { recursive: true });
  const paragraphs = [
    'Only invest within your circle of competence — buy what you can understand.',
    'A margin of safety is the bedrock of intelligent investing.',
    'Our valuation framework is based on discounted cash flow and owner earnings, not multiples.',
    'We hold our compounders for the long term — our favourite holding period is forever.',
    'Mr. Market offers prices every day; be greedy when others are fearful.',
  ];
  const md =
    '---\ntitle: "fx"\nsource_url: https://example.com/letter\nkind: annual_letter\n---\n\n' +
    paragraphsToMarkdown(paragraphs);
  writeFileSync(join(slugDir, 'doc1.md'), md, 'utf-8');

  const distilled = distillInvestor('buffett', 'Warren Buffett', join(workDir, 'extracted'));
  writeDistilled(distilled, join(workDir, 'distilled'));

  const investors = loadAllDistilled(join(workDir, 'distilled'));
  const lib = synthesizeFromDistilled(investors, '0.1.0');
  // Write to a synth dir for completeness, then return the library object.
  writeRuleLibrary(lib, join(workDir, 'synthesized'));
  return lib;
}

describe('runDecisions integration', () => {
  it('seeds trades + prices, runs decisions, and persists per-symbol rows', () => {
    const lib = buildFixtureLibrary(tmpDir);
    expect(lib.rules.length).toBeGreaterThan(0);

    // Seed: 1 buy trade in ACME 18 months ago, current price -25% from 52w high.
    db.insert(trades)
      .values({
        accountId,
        symbol: 'ACME',
        tradeDate: '2024-11-01',
        side: 'buy',
        qty: 100,
        price: 100,
        currency: 'INR',
        tradeId: 't1',
      })
      .run();

    // Seed prices_eod with synthetic history: 52w high 200, current 150 (-25%).
    const today = '2026-05-03';
    db.insert(pricesEod)
      .values([
        { symbol: 'ACME', date: '2025-08-01', close: 200, source: 'test' },
        { symbol: 'ACME', date: today, close: 150, source: 'test' },
      ])
      .run();

    // Add a watchlist symbol with no trade.
    db.insert(watchlist).values({ portfolioId, symbol: 'WATCH', conviction: 'high' }).run();
    db.insert(pricesEod)
      .values([
        { symbol: 'WATCH', date: '2025-08-01', close: 100, source: 'test' },
        { symbol: 'WATCH', date: today, close: 60, source: 'test' },
      ])
      .run();

    // Set explicit style weights.
    db.insert(portfolioStyleWeights)
      .values({ portfolioId, weightsJson: { buffett: 1 } })
      .run();

    const result = runDecisions(db, portfolioId, lib);
    expect(result.inserted).toBe(2);
    expect(result.ruleLibraryVersion).toBe('0.1.0');

    const persisted = latestDecisionsByPortfolio(db, portfolioId);
    expect(persisted.length).toBe(2);
    const byId = new Map(persisted.map((r) => [r.symbol, r]));
    expect(byId.has('ACME')).toBe(true);
    expect(byId.has('WATCH')).toBe(true);

    const snapshots = listDecisionSnapshots(db, portfolioId);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]!.n).toBe(2);

    // Re-running creates a NEW snapshot (audit log preserved).
    runDecisions(db, portfolioId, lib);
    const snapshots2 = listDecisionSnapshots(db, portfolioId);
    expect(snapshots2.length).toBeGreaterThanOrEqual(2);
  });
});

// Silence "unused import" when the file gets reformatted.
void readFileSync;
void decisions;
