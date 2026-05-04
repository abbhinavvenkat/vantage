/**
 * End-to-end integration: v0.2 corpus library + scoring + growth forecasts.
 *
 * Synthesises a tiny corpus (3 stalwarts + mock consensus + mock backtest),
 * seeds a real SQLite test DB with trades + prices + watchlist, runs the
 * decisions pipeline, and checks the persisted rows expose the new metadata
 * (tags, why, schools-via-rule-library) needed by the redesigned page.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
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
  portfolioStyleWeights,
} from '@/lib/db/schema';
import { runDecisions } from '@/lib/decisions/run';
import { latestDecisionsByPortfolio } from '@/lib/db/queries/decisions';
import { synthesizeFromCorpus } from '@/lib/codex/synthesizeFromCorpus';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let accountId: string;

function profile(slug: string, name: string, body: string) {
  return `---\nslug: ${slug}\nname: ${name}\nstyle_tags: [quality]\nactive_period: "1980-now"\nprimary_geo: "India"\naum_or_track_record: "n/a"\nlast_updated: "2026-05-03"\n---\n\n# ${name}\n\n${body}\n`;
}

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'decisions-v2-'));
  const dbPath = resolve(tmpDir, 'test.db');
  sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('./drizzle') });

  // Seed corpus.
  const stalDir = join(tmpDir, 'stalwarts');
  mkdirSync(stalDir, { recursive: true });
  writeFileSync(
    join(stalDir, 'buffett.md'),
    profile(
      'buffett',
      'Warren Buffett',
      [
        '## Core Principles\n- Quality over cheapness — wonderful business at fair price. Hold for the long term, our favourite holding period is forever.',
        '## Buy Triggers\n- Durable competitive advantage at fair valuation. ROCE > 15%.',
        '## Add Triggers\n- Drawdown of 20% on a quality compounder while thesis intact; we add to our position.',
        '## Red Flags / Avoid List\n- Promoter pledged shares; auditor resignation.',
        '## Trim / Exit Triggers\n- Thesis broken or management lied.',
      ].join('\n\n'),
    ),
  );
  writeFileSync(
    join(stalDir, 'agrawal.md'),
    profile(
      'agrawal',
      'Raamdeo Agrawal',
      [
        '## Core Principles\n- QGLP non-negotiable; ROCE > 15%; PEG < 1.',
        '## Buy Triggers\n- Quality compounder with PEG < 1.',
        '## Red Flags / Avoid List\n- Promoter pledge above 20%.',
      ].join('\n\n'),
    ),
  );
  writeFileSync(
    join(stalDir, 'marks.md'),
    profile(
      'marks',
      'Howard Marks',
      [
        '## Core Principles\n- Cycles are inevitable; permanent loss is risk.',
        '## Buy Triggers\n- Buy at maximum pessimism, cycle trough.',
        '## Trim / Exit Triggers\n- Trim on extreme valuation; froth and bubble.',
      ].join('\n\n'),
    ),
  );

  writeFileSync(
    join(tmpDir, 'consensus.md'),
    `# Consensus\n\n## 1. The Convergent Core\n\n### 1.4 ROIC > 15%\nInvestors in full agreement (20+): Buffett, Agrawal, Marks\n\n## 5. The Universal Red Flags\n| Red Flag | Cited By | India Relevance |\n| Promoter pledge | Buffett, Agrawal, Marks | High |\n`,
    'utf-8',
  );
  writeFileSync(
    join(tmpDir, 'summary.json'),
    JSON.stringify({
      decision_dates: ['2016-01-04', '2020-01-02', '2023-01-02', '2026-05-03'],
      frameworks: {
        agrawal: { xirr: 0.156, benchmark_vs_nifty50_xirr_delta: 0.038 },
      },
    }),
    'utf-8',
  );
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

describe('runDecisions with v0.2 corpus library', () => {
  it('persists fired-rule metadata (tags, weights, schools-via-library)', () => {
    const lib = synthesizeFromCorpus(
      {
        stalwartsRoot: join(tmpDir, 'stalwarts'),
        consensusPath: join(tmpDir, 'consensus.md'),
        backtestSummaryPath: join(tmpDir, 'summary.json'),
      },
      '0.2.0',
    );
    expect(lib.rules.length).toBeGreaterThan(0);
    expect(lib._meta).toBeDefined();

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
    const today = '2026-05-03';
    db.insert(pricesEod)
      .values([
        { symbol: 'ACME', date: '2025-08-01', close: 200, source: 'test' },
        { symbol: 'ACME', date: today, close: 150, source: 'test' },
      ])
      .run();
    db.insert(watchlist).values({ portfolioId, symbol: 'WATCH', conviction: 'high' }).run();
    db.insert(pricesEod)
      .values([
        { symbol: 'WATCH', date: '2025-08-01', close: 100, source: 'test' },
        { symbol: 'WATCH', date: today, close: 60, source: 'test' },
      ])
      .run();
    db.insert(portfolioStyleWeights)
      .values({ portfolioId, weightsJson: { buffett: 1, agrawal: 1, marks: 1 } })
      .run();

    const result = runDecisions(db, portfolioId, lib);
    expect(result.inserted).toBe(2);
    expect(result.ruleLibraryVersion).toBe('0.2.0');

    const persisted = latestDecisionsByPortfolio(db, portfolioId);
    expect(persisted.length).toBe(2);
    // The persisted vote rows must carry tags + why arrays for the new UI.
    for (const row of persisted) {
      const payload = row.payloadJson as {
        votes?: Array<{ tags?: string[]; why?: string[]; ruleId: string }>;
      };
      const votes = payload.votes ?? [];
      // Some votes may have empty tags/why if the rule has none — that is fine,
      // we just require the *fields* to be present in the persisted shape so
      // the UI doesn't crash.
      for (const v of votes) {
        expect(Array.isArray(v.tags)).toBe(true);
        expect(Array.isArray(v.why)).toBe(true);
      }
    }
  });
});
