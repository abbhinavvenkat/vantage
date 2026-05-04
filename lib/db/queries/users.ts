import { asc, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { users } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type User = typeof users.$inferSelect;

export function userCount(db: Db): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get();
  return row?.n ?? 0;
}

export function getSingleUser(db: Db): User | null {
  const row = db.select().from(users).orderBy(asc(users.createdAt)).limit(1).get();
  return row ?? null;
}

export function createUser(db: Db, passwordHash: string): User {
  return db.insert(users).values({ passwordHash }).returning().get();
}
