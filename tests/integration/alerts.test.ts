import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  evaluateRules,
  type EvaluatorRule,
  type PriceSnapshot,
} from '@/lib/analytics/alertEvaluator';
import {
  ackEvent,
  addRule,
  countUnackedEvents,
  hasUnackedEventOnDate,
  insertEvent,
  listEvents,
  listRules,
  removeRule,
  setRuleEnabled,
} from '@/lib/db/queries/alerts';
import * as schema from '@/lib/db/schema';
import { portfolios, users } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

let tmpDir: string;
let sqlite: Database.Database;
let db: Db;
let portfolioId: string;
let otherPortfolioId: string;

beforeAll(() => {
  tmpDir = mkdtempSync(resolve(tmpdir(), 'stock-platform-alerts-'));
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
  sqlite.exec('DELETE FROM alert_events;');
  sqlite.exec('DELETE FROM alert_rules;');
  sqlite.exec('DELETE FROM portfolios;');
  sqlite.exec('DELETE FROM users;');

  db.insert(users).values({ passwordHash: 'x' }).returning().get();
  const pf = db.insert(portfolios).values({ name: 'Primary' }).returning().get();
  const pf2 = db.insert(portfolios).values({ name: 'Secondary' }).returning().get();
  portfolioId = pf.id;
  otherPortfolioId = pf2.id;
});

describe('alerts queries (integration)', () => {
  it('rules: add, list (newest first), enable/disable, remove — portfolio-scoped', () => {
    const r1 = addRule(db, portfolioId, {
      symbol: 'ACME-EQ',
      ruleType: 'cmp_below',
      threshold: 100,
    });
    sqlite.prepare('UPDATE alert_rules SET created_at = ? WHERE id = ?').run(1000, r1.id);
    const r2 = addRule(db, portfolioId, {
      symbol: 'BRAVO-EQ',
      ruleType: 'cmp_above',
      threshold: 250,
    });
    sqlite.prepare('UPDATE alert_rules SET created_at = ? WHERE id = ?').run(2000, r2.id);
    addRule(db, otherPortfolioId, { symbol: 'ZULU-EQ', ruleType: 'cmp_below', threshold: 10 });

    const list = listRules(db, portfolioId);
    expect(list).toHaveLength(2);
    // newest first
    expect(list[0]?.id).toBe(r2.id);
    expect(list[1]?.id).toBe(r1.id);

    const disabled = setRuleEnabled(db, portfolioId, r1.id, false);
    expect(disabled?.enabled).toBe(0);

    // can't enable across portfolios
    expect(setRuleEnabled(db, otherPortfolioId, r1.id, true)).toBeNull();

    const removed = removeRule(db, portfolioId, r2.id);
    expect(removed?.id).toBe(r2.id);
    expect(listRules(db, portfolioId)).toHaveLength(1);
  });

  it('end-to-end: add rule, evaluate twice (second is no-op via dedupe), ack event', () => {
    const rule = addRule(db, portfolioId, {
      symbol: 'ACME-EQ',
      ruleType: 'cmp_below',
      threshold: 100,
    });

    const evalRules: EvaluatorRule[] = [
      {
        id: rule.id,
        symbol: rule.symbol!,
        ruleType: rule.ruleType,
        threshold: rule.threshold,
        enabled: rule.enabled === 1,
      },
    ];
    const prices = new Map<string, PriceSnapshot>([
      ['ACME-EQ', { symbol: 'ACME-EQ', close: 95, volume: null, date: '2026-05-03' }],
    ]);

    // First eval — should produce one event.
    const events1 = evaluateRules(evalRules, prices, new Map(), '2026-05-03', {
      alreadyFiredToday: (rid, d) => hasUnackedEventOnDate(db, rid, d),
    });
    expect(events1).toHaveLength(1);

    // Persist as the route would.
    for (const ev of events1) {
      insertEvent(db, portfolioId, {
        ruleId: ev.ruleId,
        symbol: ev.symbol,
        triggeredAt: ev.triggeredAt,
        currentValue: ev.currentValue,
        triggerValue: ev.triggerValue,
        message: ev.message,
      });
    }

    expect(countUnackedEvents(db, portfolioId)).toBe(1);
    expect(hasUnackedEventOnDate(db, rule.id, '2026-05-03')).toBe(true);

    // Second eval — same day, unacked → no new event.
    const events2 = evaluateRules(evalRules, prices, new Map(), '2026-05-03', {
      alreadyFiredToday: (rid, d) => hasUnackedEventOnDate(db, rid, d),
    });
    expect(events2).toHaveLength(0);
    expect(countUnackedEvents(db, portfolioId)).toBe(1);

    // Ack.
    const allEvents = listEvents(db, portfolioId, { acked: false });
    expect(allEvents).toHaveLength(1);
    const acked = ackEvent(db, portfolioId, allEvents[0]!.id);
    expect(acked?.isAcked).toBe(1);

    expect(countUnackedEvents(db, portfolioId)).toBe(0);
    expect(listEvents(db, portfolioId, { acked: false })).toHaveLength(0);
    expect(listEvents(db, portfolioId, { acked: true })).toHaveLength(1);
    expect(listEvents(db, portfolioId, {})).toHaveLength(1);

    // After ack, dedupe predicate is false → re-eval would fire again.
    expect(hasUnackedEventOnDate(db, rule.id, '2026-05-03')).toBe(false);
    const events3 = evaluateRules(evalRules, prices, new Map(), '2026-05-03', {
      alreadyFiredToday: (rid, d) => hasUnackedEventOnDate(db, rid, d),
    });
    expect(events3).toHaveLength(1);
  });

  it('listEvents and ackEvent are portfolio-scoped', () => {
    const r = addRule(db, portfolioId, {
      symbol: 'ACME-EQ',
      ruleType: 'cmp_below',
      threshold: 100,
    });
    const ev = insertEvent(db, portfolioId, {
      ruleId: r.id,
      symbol: 'ACME-EQ',
      triggeredAt: '2026-05-03T10:00:00.000Z',
      currentValue: 95,
      triggerValue: 100,
      message: 'test',
    });

    // Cross-portfolio ack must fail.
    expect(ackEvent(db, otherPortfolioId, ev.id)).toBeNull();
    expect(listEvents(db, otherPortfolioId, {})).toHaveLength(0);
    expect(listEvents(db, portfolioId, {})).toHaveLength(1);
  });

  it('cascade: removing a rule deletes its events', () => {
    const r = addRule(db, portfolioId, {
      symbol: 'ACME-EQ',
      ruleType: 'cmp_below',
      threshold: 100,
    });
    insertEvent(db, portfolioId, {
      ruleId: r.id,
      symbol: 'ACME-EQ',
      triggeredAt: '2026-05-03T10:00:00.000Z',
      currentValue: 95,
      triggerValue: 100,
      message: 'test',
    });
    expect(listEvents(db, portfolioId, {})).toHaveLength(1);
    removeRule(db, portfolioId, r.id);
    expect(listEvents(db, portfolioId, {})).toHaveLength(0);
  });
});
