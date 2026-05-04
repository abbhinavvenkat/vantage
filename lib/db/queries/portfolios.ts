import { and, asc, eq, isNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { portfolios } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type Portfolio = typeof portfolios.$inferSelect;
export type NewPortfolioInput = {
  name: string;
  baseCurrency?: string;
};

export function listPortfolios(db: Db): Portfolio[] {
  return db
    .select()
    .from(portfolios)
    .where(isNull(portfolios.archivedAt))
    .orderBy(asc(portfolios.createdAt))
    .all();
}

export function getPortfolio(db: Db, id: string): Portfolio | null {
  const row = db.select().from(portfolios).where(eq(portfolios.id, id)).get();
  return row ?? null;
}

export function createPortfolio(db: Db, input: NewPortfolioInput): Portfolio {
  const inserted = db
    .insert(portfolios)
    .values({
      name: input.name,
      baseCurrency: input.baseCurrency ?? 'INR',
    })
    .returning()
    .get();
  return inserted;
}

export function renamePortfolio(db: Db, id: string, name: string): Portfolio | null {
  const updated = db
    .update(portfolios)
    .set({ name })
    .where(eq(portfolios.id, id))
    .returning()
    .get();
  return updated ?? null;
}

export function archivePortfolio(db: Db, id: string): Portfolio | null {
  const updated = db
    .update(portfolios)
    .set({ archivedAt: Date.now() })
    .where(and(eq(portfolios.id, id), isNull(portfolios.archivedAt)))
    .returning()
    .get();
  return updated ?? null;
}
