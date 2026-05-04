import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { alertEvents, alertRules, type AlertRuleType } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type AlertRule = typeof alertRules.$inferSelect;
export type AlertEvent = typeof alertEvents.$inferSelect;

export type NewAlertRuleInput = {
  symbol: string | null;
  ruleType: AlertRuleType;
  threshold: number;
  enabled?: boolean;
};

export type NewAlertEventInput = {
  ruleId: string;
  symbol: string;
  triggeredAt: string;
  currentValue: number;
  triggerValue: number;
  message: string;
};

export function listRules(db: Db, portfolioId: string): AlertRule[] {
  return db
    .select()
    .from(alertRules)
    .where(eq(alertRules.portfolioId, portfolioId))
    .orderBy(desc(alertRules.createdAt))
    .all();
}

export function listEnabledRules(db: Db, portfolioId: string): AlertRule[] {
  return db
    .select()
    .from(alertRules)
    .where(and(eq(alertRules.portfolioId, portfolioId), eq(alertRules.enabled, 1)))
    .all();
}

export function addRule(db: Db, portfolioId: string, input: NewAlertRuleInput): AlertRule {
  const inserted = db
    .insert(alertRules)
    .values({
      portfolioId,
      symbol: input.symbol,
      ruleType: input.ruleType,
      threshold: input.threshold,
      enabled: input.enabled === false ? 0 : 1,
    })
    .returning()
    .get();
  return inserted;
}

export function setRuleEnabled(
  db: Db,
  portfolioId: string,
  id: string,
  enabled: boolean,
): AlertRule | null {
  const updated = db
    .update(alertRules)
    .set({ enabled: enabled ? 1 : 0 })
    .where(and(eq(alertRules.portfolioId, portfolioId), eq(alertRules.id, id)))
    .returning()
    .get();
  return updated ?? null;
}

export function removeRule(db: Db, portfolioId: string, id: string): AlertRule | null {
  const removed = db
    .delete(alertRules)
    .where(and(eq(alertRules.portfolioId, portfolioId), eq(alertRules.id, id)))
    .returning()
    .get();
  return removed ?? null;
}

export type ListEventsFilter = {
  acked?: boolean; // undefined = all
};

export function listEvents(
  db: Db,
  portfolioId: string,
  filter: ListEventsFilter = {},
): AlertEvent[] {
  const conds = [eq(alertEvents.portfolioId, portfolioId)];
  if (filter.acked === true) conds.push(eq(alertEvents.isAcked, 1));
  if (filter.acked === false) conds.push(eq(alertEvents.isAcked, 0));

  return db
    .select()
    .from(alertEvents)
    .where(and(...conds))
    .orderBy(desc(alertEvents.triggeredAt))
    .all();
}

export function countUnackedEvents(db: Db, portfolioId: string): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(alertEvents)
    .where(and(eq(alertEvents.portfolioId, portfolioId), eq(alertEvents.isAcked, 0)))
    .get();
  return row?.n ?? 0;
}

export function insertEvent(db: Db, portfolioId: string, input: NewAlertEventInput): AlertEvent {
  return db
    .insert(alertEvents)
    .values({
      portfolioId,
      ruleId: input.ruleId,
      symbol: input.symbol,
      triggeredAt: input.triggeredAt,
      currentValue: input.currentValue,
      triggerValue: input.triggerValue,
      message: input.message,
    })
    .returning()
    .get();
}

/**
 * Returns true if there is already an unacked event for this rule on the given
 * date (YYYY-MM-DD prefix of triggeredAt). Used by the evaluator for dedupe.
 */
export function hasUnackedEventOnDate(db: Db, ruleId: string, isoDate: string): boolean {
  const row = db
    .select({ id: alertEvents.id })
    .from(alertEvents)
    .where(
      and(
        eq(alertEvents.ruleId, ruleId),
        eq(alertEvents.isAcked, 0),
        sql`substr(${alertEvents.triggeredAt}, 1, 10) = ${isoDate}`,
      ),
    )
    .get();
  return Boolean(row);
}

export function ackEvent(db: Db, portfolioId: string, id: string): AlertEvent | null {
  const updated = db
    .update(alertEvents)
    .set({ isAcked: 1 })
    .where(and(eq(alertEvents.portfolioId, portfolioId), eq(alertEvents.id, id)))
    .returning()
    .get();
  return updated ?? null;
}
