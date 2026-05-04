import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { events, type EventSource, type EventType } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type EventRow = typeof events.$inferSelect;

export type NewEventInput = {
  symbol: string;
  eventType: EventType;
  eventDate: string;
  title: string;
  notes?: string | null;
  source?: EventSource;
};

export type ListEventsFilter = {
  fromDate?: string; // inclusive ISO YYYY-MM-DD
  toDate?: string; // inclusive ISO YYYY-MM-DD
  order?: 'asc' | 'desc';
  symbol?: string;
};

export function listEvents(db: Db, portfolioId: string, filter: ListEventsFilter = {}): EventRow[] {
  const conditions = [eq(events.portfolioId, portfolioId)];
  if (filter.fromDate) conditions.push(gte(events.eventDate, filter.fromDate));
  if (filter.toDate) conditions.push(lte(events.eventDate, filter.toDate));
  if (filter.symbol) conditions.push(eq(events.symbol, filter.symbol));
  const orderFn = filter.order === 'desc' ? desc : asc;
  return db
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(orderFn(events.eventDate), asc(events.symbol))
    .all();
}

export function getEvent(db: Db, portfolioId: string, id: string): EventRow | null {
  const row = db
    .select()
    .from(events)
    .where(and(eq(events.portfolioId, portfolioId), eq(events.id, id)))
    .get();
  return row ?? null;
}

export function addEvent(db: Db, portfolioId: string, input: NewEventInput): EventRow {
  const inserted = db
    .insert(events)
    .values({
      portfolioId,
      symbol: input.symbol,
      eventType: input.eventType,
      eventDate: input.eventDate,
      title: input.title,
      notes: input.notes ?? null,
      source: input.source ?? 'manual',
      createdAt: Date.now(),
    })
    .returning()
    .get();
  return inserted;
}

export function removeEvent(db: Db, portfolioId: string, id: string): EventRow | null {
  const removed = db
    .delete(events)
    .where(and(eq(events.portfolioId, portfolioId), eq(events.id, id)))
    .returning()
    .get();
  return removed ?? null;
}

/**
 * Idempotent bulk import. Skips rows whose
 * (portfolioId, symbol, eventType, eventDate, title) already exist.
 * Returns counts of inserted vs skipped.
 */
export function bulkImportEvents(
  db: Db,
  portfolioId: string,
  rows: Array<NewEventInput>,
): { inserted: number; skipped: number } {
  let inserted = 0;
  let skipped = 0;
  for (const r of rows) {
    try {
      db.insert(events)
        .values({
          portfolioId,
          symbol: r.symbol,
          eventType: r.eventType,
          eventDate: r.eventDate,
          title: r.title,
          notes: r.notes ?? null,
          source: r.source ?? 'file',
          createdAt: Date.now(),
        })
        .run();
      inserted += 1;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('UNIQUE') || msg.includes('unique')) {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }
  return { inserted, skipped };
}
