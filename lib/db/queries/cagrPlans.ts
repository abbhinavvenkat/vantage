import { desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { cagrPlans, type CagrPlanJson } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type CagrPlanRow = typeof cagrPlans.$inferSelect;

export type InsertCagrPlan = {
  portfolioId: string;
  targetCagrPct: number;
  horizonYears: number;
  currentForecastCagr: number;
  proposedForecastCagr: number;
  plan: CagrPlanJson;
};

export function insertCagrPlan(db: Db, input: InsertCagrPlan): CagrPlanRow {
  const row = db
    .insert(cagrPlans)
    .values({
      portfolioId: input.portfolioId,
      targetCagrPct: input.targetCagrPct,
      horizonYears: input.horizonYears,
      currentForecastCagr: input.currentForecastCagr,
      proposedForecastCagr: input.proposedForecastCagr,
      planJson: input.plan,
    })
    .returning()
    .get();
  return row;
}

export function listCagrPlans(db: Db, portfolioId: string, limit = 20): CagrPlanRow[] {
  return db
    .select()
    .from(cagrPlans)
    .where(eq(cagrPlans.portfolioId, portfolioId))
    .orderBy(desc(cagrPlans.createdAt))
    .limit(limit)
    .all();
}

export function latestCagrPlan(db: Db, portfolioId: string): CagrPlanRow | null {
  const row = db
    .select()
    .from(cagrPlans)
    .where(eq(cagrPlans.portfolioId, portfolioId))
    .orderBy(desc(cagrPlans.createdAt))
    .limit(1)
    .get();
  return row ?? null;
}
