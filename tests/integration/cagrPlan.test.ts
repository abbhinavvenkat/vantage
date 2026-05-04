import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runCagrPlan } from '@/lib/cagr/run';
import * as schema from '@/lib/db/schema';
import {
  accounts,
  brokers,
  cagrPlans,
  portfolios,
  pricesEod,
  trades,
  users,
  watchlist,
} from '@/lib/db/schema';
import { insertCagrPlan, latestCagrPlan, listCagrPlans } from '@/lib/db/queries/cagrPlans';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let universeRoot: string;
let fundamentalsRoot: string;
let resultsRoot: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let accountId: string;

function writeFundamental(symbol: string, body: unknown): void {
  writeFileSync(join(fundamentalsRoot, `${symbol}.json`), JSON.stringify(body));
}

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-cagr-'));
  universeRoot = join(tmpDir, 'backtests');
  fundamentalsRoot = join(universeRoot, 'fundamentals');
  resultsRoot = join(universeRoot, 'results');
  mkdirSync(fundamentalsRoot, { recursive: true });
  mkdirSync(resultsRoot, { recursive: true });

  // Synthetic universe.
  writeFileSync(
    join(universeRoot, 'universe.csv'),
    [
      'symbol,company_name,sector,industry',
      'WIN-EQ,Win Co Ltd.,Information Technology,Software',
      'WIN2-EQ,Win Two Ltd.,Healthcare,Pharma',
      'LOSER-EQ,Loser Ltd.,Fast Moving Consumer Goods,FMCG',
    ].join('\n') + '\n',
  );

  // Synthetic fundamentals.
  writeFundamental('WIN-EQ', {
    symbol: 'WIN-EQ',
    annual: {
      FY2020: { sales_cr: 100, pat_cr: 18, roce_pct: 32, debt_to_equity: 0.05 },
      FY2021: { sales_cr: 130, pat_cr: 25, roce_pct: 33, debt_to_equity: 0.05 },
      FY2022: { sales_cr: 170, pat_cr: 35, roce_pct: 34, debt_to_equity: 0.04 },
      FY2023: { sales_cr: 220, pat_cr: 50, roce_pct: 35, debt_to_equity: 0.03 },
      FY2024: { sales_cr: 285, pat_cr: 70, roce_pct: 36, debt_to_equity: 0.03 },
      FY2025: { sales_cr: 370, pat_cr: 95, roce_pct: 37, debt_to_equity: 0.02 },
    },
    current: { pe: 22, price: 1500, market_cap_cr: 25_000, book_value_per_share: 200 },
  });
  writeFundamental('WIN2-EQ', {
    symbol: 'WIN2-EQ',
    annual: {
      FY2020: { sales_cr: 200, pat_cr: 30, roce_pct: 28, debt_to_equity: 0.1 },
      FY2021: { sales_cr: 260, pat_cr: 42, roce_pct: 29, debt_to_equity: 0.1 },
      FY2022: { sales_cr: 340, pat_cr: 60, roce_pct: 30, debt_to_equity: 0.08 },
      FY2023: { sales_cr: 440, pat_cr: 85, roce_pct: 31, debt_to_equity: 0.08 },
      FY2024: { sales_cr: 570, pat_cr: 115, roce_pct: 32, debt_to_equity: 0.07 },
      FY2025: { sales_cr: 740, pat_cr: 155, roce_pct: 33, debt_to_equity: 0.06 },
    },
    current: { pe: 24, price: 2400, market_cap_cr: 40_000, book_value_per_share: 350 },
  });
  writeFundamental('LOSER-EQ', {
    symbol: 'LOSER-EQ',
    annual: {
      FY2020: { sales_cr: 1000, pat_cr: 80, roce_pct: 9, debt_to_equity: 1.0 },
      FY2021: { sales_cr: 1010, pat_cr: 75, roce_pct: 8, debt_to_equity: 1.1 },
      FY2022: { sales_cr: 1015, pat_cr: 65, roce_pct: 7, debt_to_equity: 1.2 },
      FY2023: { sales_cr: 1010, pat_cr: 50, roce_pct: 6, debt_to_equity: 1.3 },
      FY2024: { sales_cr: 1005, pat_cr: 35, roce_pct: 5, debt_to_equity: 1.4 },
      FY2025: { sales_cr: 1000, pat_cr: 20, roce_pct: 4, debt_to_equity: 1.5 },
    },
    current: { pe: 60, price: 200, market_cap_cr: 60_000, book_value_per_share: 200 },
  });

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
  sqlite.exec('DELETE FROM cagr_plans;');
  sqlite.exec('DELETE FROM watchlist;');
  sqlite.exec('DELETE FROM trades;');
  sqlite.exec('DELETE FROM accounts;');
  sqlite.exec('DELETE FROM brokers;');
  sqlite.exec('DELETE FROM prices_eod;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  portfolioId = pf.id;
  const broker = db.insert(brokers).values({ code: 'zerodha' }).returning().get();
  const acct = db
    .insert(accounts)
    .values({ portfolioId, brokerId: broker.id, alias: 'main' })
    .returning()
    .get();
  accountId = acct.id;
});

describe('runCagrPlan + cagrPlans persistence', () => {
  it('produces a plan with replace action for low-CAGR holding and persists JSON', () => {
    // Seed: bought 100 LOSER-EQ at 250, 50 WIN-EQ at 1000.
    db.insert(trades)
      .values([
        {
          accountId,
          symbol: 'LOSER-EQ',
          tradeDate: '2024-01-10',
          side: 'buy',
          qty: 100,
          price: 250,
          currency: 'INR',
          tradeId: 't-loser-1',
        },
        {
          accountId,
          symbol: 'WIN-EQ',
          tradeDate: '2024-02-20',
          side: 'buy',
          qty: 50,
          price: 1000,
          currency: 'INR',
          tradeId: 't-win-1',
        },
      ])
      .run();

    db.insert(pricesEod)
      .values([
        {
          symbol: 'LOSER-EQ',
          date: '2026-05-02',
          close: 200,
          open: 200,
          high: 205,
          low: 195,
          volume: 0,
          source: 'test',
        },
        {
          symbol: 'WIN-EQ',
          date: '2026-05-02',
          close: 1500,
          open: 1500,
          high: 1510,
          low: 1490,
          volume: 0,
          source: 'test',
        },
      ])
      .run();

    db.insert(watchlist).values({ portfolioId, symbol: 'WIN2-EQ' }).run();

    const { plan, candidates, holdings } = runCagrPlan({
      db,
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      universeRoot,
      fundamentalsRoot,
      backtestResultsRoot: resultsRoot,
    });

    expect(holdings.length).toBe(2);
    expect(candidates.length).toBeGreaterThan(0);

    // LOSER should be classified as replace
    const replace = plan.actions.find((a) => a.symbol === 'LOSER-EQ');
    expect(replace?.kind).toBe('replace');

    // Plan persistence
    const stored = insertCagrPlan(db, {
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      currentForecastCagr: plan.currentPortfolioForecastCagr,
      proposedForecastCagr: plan.proposedPortfolioForecastCagr,
      plan: plan as unknown as Record<string, unknown>,
    });
    expect(stored.id).toBeTruthy();

    const round = latestCagrPlan(db, portfolioId);
    expect(round?.id).toBe(stored.id);
    expect(round?.targetCagrPct).toBe(22);
    expect(round?.horizonYears).toBe(10);
    const planRound = round!.planJson as { actions?: unknown[] };
    expect(Array.isArray(planRound.actions)).toBe(true);

    const all = listCagrPlans(db, portfolioId);
    expect(all.length).toBe(1);
  });

  it('runs end-to-end with empty portfolio (fresh-buy candidates)', () => {
    const { plan, candidates } = runCagrPlan({
      db,
      portfolioId,
      targetCagrPct: 22,
      horizonYears: 10,
      universeRoot,
      fundamentalsRoot,
      backtestResultsRoot: resultsRoot,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(plan.actions.length).toBeGreaterThan(0);
    // Empty portfolio → forecasts default to 0.
    expect(plan.currentPortfolioForecastCagr).toBe(0);
  });
});
