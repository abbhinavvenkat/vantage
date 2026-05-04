import Database from 'better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import * as schema from '@/lib/db/schema';
import { computeHoldings } from '@/lib/db/queries/holdings';
import {
  archivePortfolio,
  createPortfolio,
  getPortfolio,
  listPortfolios,
  renamePortfolio,
} from '@/lib/db/queries/portfolios';
import { insertTrades, getTradesForPortfolio } from '@/lib/db/queries/trades';
import { createUser, getSingleUser, userCount } from '@/lib/db/queries/users';

type Db = BetterSQLite3Database<typeof schema>;

let sqlite: Database.Database;
let db: Db;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('foreign_keys = ON');
  const raw = drizzle(sqlite);
  migrate(raw, { migrationsFolder: resolve('./drizzle') });
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

describe('schema: users', () => {
  it('counts, creates, and reads single user', () => {
    expect(userCount(db)).toBe(0);
    expect(getSingleUser(db)).toBeNull();
    const u = createUser(db, 'hash-abc');
    expect(u.passwordHash).toBe('hash-abc');
    expect(u.id).toMatch(/[0-9a-f-]{36}/);
    expect(u.createdAt).toBeGreaterThan(0);
    expect(userCount(db)).toBe(1);
    const single = getSingleUser(db);
    expect(single?.id).toBe(u.id);
  });
});

describe('schema: portfolios', () => {
  it('creates, lists, renames, archives', () => {
    const a = createPortfolio(db, { name: 'Primary' });
    const b = createPortfolio(db, { name: 'Family', baseCurrency: 'USD' });
    expect(a.baseCurrency).toBe('INR');
    expect(b.baseCurrency).toBe('USD');

    const all = listPortfolios(db);
    expect(all.map((p) => p.name).sort()).toEqual(['Family', 'Primary']);

    const renamed = renamePortfolio(db, a.id, 'Main');
    expect(renamed?.name).toBe('Main');
    expect(getPortfolio(db, a.id)?.name).toBe('Main');

    const archived = archivePortfolio(db, b.id);
    expect(archived?.archivedAt).not.toBeNull();
    const after = listPortfolios(db);
    expect(after.map((p) => p.name)).toEqual(['Main']);
  });

  it('returns null for unknown id', () => {
    expect(getPortfolio(db, '00000000-0000-0000-0000-000000000000')).toBeNull();
  });
});

describe('schema: foreign keys cascade portfolio -> account -> trade', () => {
  it('deleting a portfolio cascades to accounts and trades', () => {
    const p = createPortfolio(db, { name: 'Cascade' });
    const broker = db.insert(schema.brokers).values({ code: 'zerodha' }).returning().get();
    const acct = db
      .insert(schema.accounts)
      .values({ portfolioId: p.id, brokerId: broker.id, alias: 'Z-1' })
      .returning()
      .get();
    insertTrades(db, acct.id, [
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-04-01',
        side: 'buy',
        qty: 10,
        price: 100,
        currency: 'INR',
        tradeId: 'T-1',
      },
    ]);
    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.trades)
        .get()?.n,
    ).toBe(1);

    db.delete(schema.portfolios).where(eq(schema.portfolios.id, p.id)).run();

    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.accounts)
        .get()?.n,
    ).toBe(0);
    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.trades)
        .get()?.n,
    ).toBe(0);
  });

  it('blocks creating an account with unknown portfolio_id (FK enforced)', () => {
    const broker = db.insert(schema.brokers).values({ code: 'groww' }).returning().get();
    expect(() =>
      db
        .insert(schema.accounts)
        .values({
          portfolioId: 'ghost-portfolio',
          brokerId: broker.id,
          alias: 'X',
        })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('schema: trades idempotent upsert', () => {
  function setup() {
    const p = createPortfolio(db, { name: 'Idem' });
    const broker = db.insert(schema.brokers).values({ code: 'zerodha' }).returning().get();
    const acct = db
      .insert(schema.accounts)
      .values({ portfolioId: p.id, brokerId: broker.id, alias: 'Z' })
      .returning()
      .get();
    return { portfolio: p, account: acct };
  }

  it('dedupes by (account_id, trade_id) on re-insert', () => {
    const { portfolio, account } = setup();
    const rows = [
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-04-01',
        side: 'buy' as const,
        qty: 10,
        price: 100,
        currency: 'INR',
        tradeId: 'T-1',
      },
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-04-02',
        side: 'sell' as const,
        qty: 5,
        price: 110,
        currency: 'INR',
        tradeId: 'T-2',
      },
    ];

    const r1 = insertTrades(db, account.id, rows);
    expect(r1).toEqual({ inserted: 2, skipped: 0 });

    const r2 = insertTrades(db, account.id, rows);
    expect(r2).toEqual({ inserted: 0, skipped: 2 });

    const all = getTradesForPortfolio(db, portfolio.id);
    expect(all).toHaveLength(2);
    expect(all.map((t) => t.tradeId).sort()).toEqual(['T-1', 'T-2']);
  });

  it('dedupes via natural key when trade_id missing', () => {
    const { account } = setup();
    const rows = [
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-04-01',
        side: 'buy' as const,
        qty: 7,
        price: 99.5,
        currency: 'INR',
        execTime: '2024-04-01T09:30:00',
      },
    ];
    expect(insertTrades(db, account.id, rows).inserted).toBe(1);
    expect(insertTrades(db, account.id, rows).skipped).toBe(1);
  });
});

describe('schema: holdings aggregation', () => {
  it('nets buys minus sells per symbol, ignores intraday-paired', () => {
    const p = createPortfolio(db, { name: 'Hold' });
    const broker = db.insert(schema.brokers).values({ code: 'zerodha' }).returning().get();
    const acct = db
      .insert(schema.accounts)
      .values({ portfolioId: p.id, brokerId: broker.id, alias: 'Z' })
      .returning()
      .get();

    insertTrades(db, acct.id, [
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-04-01',
        side: 'buy',
        qty: 100,
        price: 50,
        currency: 'INR',
        tradeId: 'B-1',
      },
      {
        symbol: 'ACME-EQ',
        tradeDate: '2024-05-01',
        side: 'sell',
        qty: 30,
        price: 60,
        currency: 'INR',
        tradeId: 'S-1',
      },
      {
        symbol: 'BETA-EQ',
        tradeDate: '2024-06-01',
        side: 'buy',
        qty: 10,
        price: 200,
        currency: 'INR',
        tradeId: 'B-2',
      },
    ]);

    // Mark an intraday-paired row that should be excluded.
    insertTrades(db, acct.id, [
      {
        symbol: 'GAMMA-EQ',
        tradeDate: '2024-07-01',
        side: 'buy',
        qty: 5,
        price: 10,
        currency: 'INR',
        tradeId: 'INTRA-B',
      },
    ]);
    db.update(schema.trades)
      .set({ isIntradayPairId: 'pair-1' })
      .where(eq(schema.trades.tradeId, 'INTRA-B'))
      .run();

    const holdings = computeHoldings(db, p.id);
    const map = Object.fromEntries(holdings.map((h) => [h.symbol, h]));
    expect(Object.keys(map).sort()).toEqual(['ACME-EQ', 'BETA-EQ']);
    expect(map['ACME-EQ']?.netQty).toBe(70);
    expect(map['ACME-EQ']?.buyValue).toBe(5000);
    expect(map['ACME-EQ']?.sellValue).toBe(1800);
    expect(map['BETA-EQ']?.netQty).toBe(10);
    expect(map['BETA-EQ']?.tradeCount).toBe(1);
  });
});

describe('schema: instruments / prices_eod / fx_rates uniques', () => {
  it('rejects duplicate (symbol, date) on prices_eod', () => {
    db.insert(schema.pricesEod).values({ symbol: 'ACME-EQ', date: '2024-04-01', close: 100 }).run();
    expect(() =>
      db
        .insert(schema.pricesEod)
        .values({ symbol: 'ACME-EQ', date: '2024-04-01', close: 101 })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('rejects duplicate (date, base, quote) on fx_rates', () => {
    db.insert(schema.fxRates)
      .values({ date: '2024-04-01', base: 'USD', quote: 'INR', rate: 83.1 })
      .run();
    expect(() =>
      db
        .insert(schema.fxRates)
        .values({ date: '2024-04-01', base: 'USD', quote: 'INR', rate: 83.2 })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('instruments stores currency', () => {
    db.insert(schema.instruments)
      .values({ symbol: 'AAPL', isin: 'US0378331005', currency: 'USD' })
      .run();
    const row = db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.symbol, 'AAPL'))
      .get();
    expect(row?.currency).toBe('USD');
  });
});

describe('schema: codex tables roundtrip', () => {
  it('inserts investor, source, version, rule, citation; cascade on investor delete', () => {
    const inv = db
      .insert(schema.investors)
      .values({ slug: 'buffett', name: 'Warren Buffett' })
      .returning()
      .get();
    const src = db
      .insert(schema.codexSources)
      .values({
        investorId: inv.id,
        title: '1989 Letter',
        url: 'https://example.test/1989',
        kind: 'letter',
      })
      .returning()
      .get();
    const ver = db.insert(schema.codexVersions).values({ semver: '0.1.0' }).returning().get();
    const rule = db
      .insert(schema.codexRules)
      .values({
        versionId: ver.id,
        statement: 'Concentrated bets in your circle of competence',
        action: 'fresh_buy',
        conditionsJson: { valuation: 'P/E < 15', fundamentals: 'ROE > 20%' },
        weight: 0.8,
        evidenceStrength: 'strong',
      })
      .returning()
      .get();
    expect(rule.conditionsJson?.valuation).toBe('P/E < 15');

    db.insert(schema.codexRuleCitations)
      .values({
        ruleId: rule.id,
        sourceId: src.id,
        quote: 'Diversification is protection against ignorance.',
        pageOrTimestamp: 'p-14',
      })
      .run();

    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.codexRuleCitations)
        .get()?.n,
    ).toBe(1);

    db.delete(schema.investors).where(eq(schema.investors.id, inv.id)).run();
    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.codexSources)
        .get()?.n,
    ).toBe(0);
    // citations cascade through their own FK to source -> already gone
    expect(
      db
        .select({ n: sql<number>`count(*)` })
        .from(schema.codexRuleCitations)
        .get()?.n,
    ).toBe(0);
  });
});

describe('schema: research_runs / decisions JSON columns typed', () => {
  it('roundtrips JSON output_json on research_runs', () => {
    db.insert(schema.researchRuns)
      .values({
        symbol: 'ACME-EQ',
        skill: 'annual-report-summarize',
        inputHash: 'abc',
        outputJson: { foo: 'bar', n: 1 },
      })
      .run();
    const row = db.select().from(schema.researchRuns).get();
    expect(row?.outputJson).toEqual({ foo: 'bar', n: 1 });
  });

  it('roundtrips payload_json on decisions', () => {
    const p = createPortfolio(db, { name: 'Dec' });
    db.insert(schema.decisions)
      .values({
        portfolioId: p.id,
        symbol: 'ACME-EQ',
        action: 'hold',
        score: 0.42,
        ruleLibraryVersion: '0.1.0',
        payloadJson: {
          votes: [{ ruleId: 'r1', action: 'hold', weight: 0.5 }],
          inputs: { cmp: 100 },
        },
      })
      .run();
    const row = db.select().from(schema.decisions).get();
    expect(row?.payloadJson?.votes?.[0]?.ruleId).toBe('r1');
  });
});
