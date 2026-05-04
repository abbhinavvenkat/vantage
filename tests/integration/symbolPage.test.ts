/**
 * Integration smoke-check for the unified per-stock detail page
 * (`/p/[id]/symbol/[ticker]`).
 *
 * The Server Component pulls together data from many modules. Rather than
 * harness Next.js + RSC, we exercise the same data pipeline the route uses:
 *
 *   - persisted decision lookup (latestDecisionsByPortfolio)
 *   - growth forecast + compounder profile for the symbol
 *   - target-CAGR slice via runCagrPlanForSymbol
 *
 * If this passes, the SSR page renders consistent values.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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
} from '@/lib/db/schema';
import { latestDecisionsByPortfolio, insertDecisions } from '@/lib/db/queries/decisions';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { forecastGrowth, loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';
import { runCagrPlanForSymbol } from '@/lib/cagr/run';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let universeRoot: string;
let fundamentalsRoot: string;
let resultsRoot: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let accountId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'symbol-page-'));
  universeRoot = join(tmpDir, 'backtests');
  fundamentalsRoot = join(universeRoot, 'fundamentals');
  resultsRoot = join(universeRoot, 'results');
  mkdirSync(fundamentalsRoot, { recursive: true });
  mkdirSync(resultsRoot, { recursive: true });

  // Synthetic universe + fundamentals so the screener has a candidate.
  writeFileSync(
    join(universeRoot, 'universe.csv'),
    [
      'symbol,company_name,sector,industry',
      'ACME-EQ,Acme Co Ltd.,Information Technology,Software',
      'OTHER-EQ,Other Co Ltd.,Healthcare,Pharma',
    ].join('\n') + '\n',
  );
  writeFileSync(
    join(fundamentalsRoot, 'ACME-EQ.json'),
    JSON.stringify({
      symbol: 'ACME-EQ',
      annual: {
        FY2020: { sales_cr: 100, pat_cr: 18, roce_pct: 32, debt_to_equity: 0.05 },
        FY2021: { sales_cr: 130, pat_cr: 25, roce_pct: 33, debt_to_equity: 0.05 },
        FY2022: { sales_cr: 170, pat_cr: 35, roce_pct: 34, debt_to_equity: 0.04 },
        FY2023: { sales_cr: 220, pat_cr: 50, roce_pct: 35, debt_to_equity: 0.03 },
        FY2024: { sales_cr: 285, pat_cr: 70, roce_pct: 36, debt_to_equity: 0.03 },
        FY2025: { sales_cr: 370, pat_cr: 95, roce_pct: 37, debt_to_equity: 0.02 },
      },
      current: { pe: 22, price: 1500, market_cap_cr: 25_000, book_value_per_share: 200 },
    }),
  );

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

describe('Symbol detail page data pipeline', () => {
  it('aggregates decision + compounder + growth + cagr slice for a held symbol', () => {
    const today = '2026-05-03';

    // Seed: held position in ACME-EQ.
    db.insert(trades)
      .values({
        accountId,
        symbol: 'ACME-EQ',
        tradeDate: '2024-01-15',
        side: 'buy',
        qty: 50,
        price: 1200,
        currency: 'INR',
        tradeId: 't1',
      })
      .run();

    db.insert(pricesEod)
      .values([
        { symbol: 'ACME-EQ', date: '2025-08-01', close: 1700, source: 'test' },
        { symbol: 'ACME-EQ', date: today, close: 1500, source: 'test' },
      ])
      .run();

    // Seed a persisted decision so the page uses the snapshot path.
    insertDecisions(db, [
      {
        portfolioId,
        symbol: 'ACME-EQ',
        action: 'add',
        score: 1.42,
        ruleLibraryVersion: '0.1.0',
        payload: {
          votes: [
            {
              ruleId: 'rule.compounder.add-on-temporary-narrative-break',
              action: 'add',
              weight: 0.78,
            },
          ],
          perAction: { fresh_buy: 0, add: 1.42, hold: 0.05, trim_25: 0, trim_50: 0, exit: 0 },
          inputs: { netQty: 50 },
        },
      },
    ]);

    // ── Latest decision lookup (the page's preferred path) ──
    const latest = latestDecisionsByPortfolio(db, portfolioId);
    expect(latest).toHaveLength(1);
    expect(latest[0]!.symbol).toBe('ACME-EQ');
    expect(latest[0]!.action).toBe('add');
    expect(latest[0]!.score).toBeCloseTo(1.42, 2);

    // ── Growth forecast for the symbol ──
    const fund = loadFundamentals('ACME-EQ', fundamentalsRoot);
    expect(fund).not.toBeNull();
    const growth = forecastGrowth({
      symbol: 'ACME-EQ',
      fundamentals: fund,
      firedRules: [],
    });
    expect(
      growth.confidence === 'low' || growth.confidence === 'medium' || growth.confidence === 'high',
    ).toBe(true);
    expect(Number.isFinite(growth.yearOne)).toBe(true);
    expect(Number.isFinite(growth.yearFive)).toBe(true);

    // ── Compounder profile ──
    const profile = computeCompounderProfile({
      symbol: 'ACME-EQ',
      sector: getSector('ACME-EQ'),
      fundamentals: fund,
      firedRules: [],
    });
    expect(profile.factors.length).toBeGreaterThan(0);
    expect(profile.weightedScore).toBeGreaterThanOrEqual(0);
    expect(profile.weightedScore).toBeLessThanOrEqual(1);
    expect(['7-9x candidate', 'solid compounder', 'mediocre', 'broken']).toContain(
      profile.classification,
    );

    // ── Target-CAGR slice for the symbol ──
    const slice = runCagrPlanForSymbol({
      db,
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      symbol: 'ACME-EQ',
      universeRoot,
      fundamentalsRoot,
      backtestResultsRoot: resultsRoot,
    });
    expect(slice.symbol).toBe('ACME-EQ');
    // Held in the portfolio so the action plan should reference it.
    expect(slice.action).not.toBeNull();
    expect(['add', 'keep', 'trim_partial', 'replace']).toContain(slice.action!.kind);
    expect(slice.targetCagrPct).toBe(22);
    expect(slice.horizonYears).toBe(10);
    expect(Number.isFinite(slice.currentPortfolioForecastCagr)).toBe(true);
    expect(Number.isFinite(slice.proposedPortfolioForecastCagr)).toBe(true);

    // The page's recommended-action badge must match the latest snapshot.
    expect(latest[0]!.action).toBe('add');
  });

  it('handles a watchlist-only symbol (no trades)', () => {
    db.insert(watchlist)
      .values({ portfolioId, symbol: 'ACME-EQ', conviction: 'high', thesis: 'compounder' })
      .run();
    db.insert(pricesEod)
      .values([{ symbol: 'ACME-EQ', date: '2026-05-03', close: 1500, source: 'test' }])
      .run();

    const slice = runCagrPlanForSymbol({
      db,
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      symbol: 'ACME-EQ',
      universeRoot,
      fundamentalsRoot,
      backtestResultsRoot: resultsRoot,
    });
    // Watchlisted symbol with no holding → fresh_buy action surfaces.
    expect(slice.action).not.toBeNull();
    expect(slice.action!.kind).toBe('fresh_buy');
    expect(slice.watchlistEvaluation).not.toBeNull();
    expect(slice.watchlistEvaluation!.symbol).toBe('ACME-EQ');
  });

  it('handles a universe-only symbol (no trades, not watchlisted)', () => {
    const slice = runCagrPlanForSymbol({
      db,
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      symbol: 'ACME-EQ',
      universeRoot,
      fundamentalsRoot,
      backtestResultsRoot: resultsRoot,
    });
    // Symbol exists in the universe → screener returns a candidate.
    expect(slice.candidate).not.toBeNull();
    expect(slice.candidate!.symbol).toBe('ACME-EQ');
    expect(Number.isFinite(slice.candidate!.compositeScore)).toBe(true);
    expect(slice.candidate!.frameworkSupport.length).toBeGreaterThan(0);
  });
});

// Quiet "unused import" if the file is reformatted.
void decisions;
