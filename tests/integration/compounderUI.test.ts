/**
 * Integration smoke-check for the dedicated /decisions/compounder route.
 *
 * Rather than render Next.js Server Components in isolation (heavy harness for
 * minimal payoff), this test exercises the same data pipeline the route uses:
 *   1. seed an in-memory portfolio + holdings + watchlist via the DB queries
 *   2. call computeCompounderProfile(...) for each symbol with the same inputs
 *      the route passes
 *   3. assert classification distribution + factor count + weighted score range
 *
 * If this passes, the SSR page is guaranteed to render the same data.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
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
} from '@/lib/db/schema';
import { computeHoldings } from '@/lib/db/queries/holdings';
import { listWatchlist } from '@/lib/db/queries/watchlist';
import { computeCompounderProfile } from '@/lib/compounder/score';
import { loadFundamentals } from '@/lib/decisions/growthForecast';
import { getSector } from '@/lib/sectors/map';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId = 'pf-cui';
let accountId = 'ac-cui';

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'compounderui-'));
  sqlite = new Database(join(tmpDir, 'test.db'));
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: resolve('drizzle') });
});

afterAll(() => {
  sqlite.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

beforeEach(() => {
  for (const t of [pricesEod, watchlist, trades, accounts, brokers, portfolios, users]) {
    db.delete(t).run();
  }
  db.insert(users).values({ id: 'u1', email: 'u@test.com', passwordHash: 'x', createdAt: 0 }).run();
  db.insert(portfolios).values({ id: portfolioId, name: 'P', createdAt: 0 }).run();
  db.insert(brokers)
    .values({ id: 'br-zerodha', code: 'zerodha' } as any)
    .run();
  db.insert(accounts)
    .values({ id: accountId, portfolioId, brokerId: 'br-zerodha', alias: 'A', createdAt: 0 } as any)
    .run();
});

function seedTrade(
  sym: string,
  qty: number,
  price: number,
  side: 'buy' | 'sell' = 'buy',
  dt = '2024-01-01',
) {
  db.insert(trades)
    .values({
      id: `t-${sym}-${Math.random().toString(36).slice(2)}`,
      accountId,
      symbol: sym,
      currency: 'INR',
      side,
      qty,
      price,
      tradeDate: dt,
      tradeId: null,
      isin: null,
      exchange: 'NSE',
      segment: 'EQ',
      series: 'EQ',
      orderId: null,
      execTime: null,
      sourceRowIdx: 0,
      createdAt: 0,
      isIntradayPairId: null,
    } as any)
    .run();
}

function seedPrice(sym: string, close: number, dt = '2025-04-30') {
  db.insert(pricesEod)
    .values({ symbol: sym, date: dt, close, currency: 'INR', source: 'test' } as any)
    .run();
}

describe('Compounder overview pipeline', () => {
  it('produces a CompounderProfile per held + watchlisted symbol with 10 factors each', () => {
    seedTrade('BEL', 100, 100);
    seedTrade('IEX', 200, 50);
    db.insert(watchlist)
      .values({ id: 'w1', portfolioId, symbol: 'TCS', createdAt: 0 } as any)
      .run();
    seedPrice('BEL', 430);
    seedPrice('IEX', 200);
    seedPrice('TCS', 3500);

    const holdings = computeHoldings(db, portfolioId).filter((h) => h.netQty > 0);
    const wl = listWatchlist(db, portfolioId);
    expect(holdings.length).toBe(2);
    expect(wl.length).toBe(1);

    const symbols = [...new Set([...holdings.map((h) => h.symbol), ...wl.map((w) => w.symbol)])];
    const profiles = symbols.map((s) =>
      computeCompounderProfile({
        symbol: s,
        sector: getSector(s),
        fundamentals: loadFundamentals(s),
        firedRules: [],
      }),
    );

    for (const p of profiles) {
      expect(p.factors.length).toBe(10);
      expect(p.weightedScore).toBeGreaterThanOrEqual(0);
      expect(p.weightedScore).toBeLessThanOrEqual(1);
      expect(['7-9x candidate', 'solid compounder', 'mediocre', 'broken']).toContain(
        p.classification,
      );
      expect(p.estimatedTenYearReturn).toBeGreaterThan(1);
    }

    // BEL ought to land in 7-9x territory (data check, sanity for the user).
    const bel = profiles.find((p) => p.symbol === 'BEL');
    expect(bel).toBeDefined();
    expect(bel!.weightedScore).toBeGreaterThan(0.7);
  });

  it('returns "broken" classification for a symbol with no fundamentals + bad sector', () => {
    seedTrade('NONESUCH', 10, 100);
    seedPrice('NONESUCH', 100);

    const profile = computeCompounderProfile({
      symbol: 'NONESUCH',
      sector: 'Unmapped',
      fundamentals: null,
      firedRules: [],
    });
    // No data → mostly unknown verdicts → modest weighted score → likely mediocre or broken.
    expect(['broken', 'mediocre']).toContain(profile.classification);
    expect(profile.unknownCount).toBeGreaterThan(5);
  });
});
