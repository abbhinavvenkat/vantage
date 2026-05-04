import { and, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { accounts, brokers } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type Account = typeof accounts.$inferSelect;

function getOrCreateBroker(db: Db, code: string): string {
  const existing = db.select({ id: brokers.id }).from(brokers).where(eq(brokers.code, code)).get();
  if (existing) return existing.id;
  const created = db.insert(brokers).values({ code }).returning({ id: brokers.id }).get();
  return created.id;
}

/**
 * Returns the first account matching (portfolioId, brokerCode, alias),
 * creating it (and the broker row if needed) if absent.
 */
export function getOrCreateAccount(
  db: Db,
  portfolioId: string,
  brokerCode: string,
  alias: string,
): Account {
  const brokerId = getOrCreateBroker(db, brokerCode);

  const existing = db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.portfolioId, portfolioId),
        eq(accounts.brokerId, brokerId),
        eq(accounts.alias, alias),
      ),
    )
    .get();
  if (existing) return existing;

  return db
    .insert(accounts)
    .values({ portfolioId, brokerId, alias })
    .returning()
    .get();
}

export function listAccounts(db: Db, portfolioId: string): Account[] {
  return db
    .select()
    .from(accounts)
    .where(eq(accounts.portfolioId, portfolioId))
    .all();
}
