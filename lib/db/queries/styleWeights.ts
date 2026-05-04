import { eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { portfolioStyleWeights, type StyleWeightsJson } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export function getStyleWeights(db: Db, portfolioId: string): StyleWeightsJson | null {
  const row = db
    .select()
    .from(portfolioStyleWeights)
    .where(eq(portfolioStyleWeights.portfolioId, portfolioId))
    .get();
  if (!row) return null;
  return row.weightsJson ?? {};
}

export function setStyleWeights(db: Db, portfolioId: string, weights: StyleWeightsJson): void {
  db.insert(portfolioStyleWeights)
    .values({
      portfolioId,
      weightsJson: weights,
      updatedAt: Date.now(),
    })
    .onConflictDoUpdate({
      target: portfolioStyleWeights.portfolioId,
      set: {
        weightsJson: weights,
        updatedAt: sql`${Date.now()}`,
      },
    })
    .run();
}

/** Normalise a weights map so non-negative values sum to 1.0. */
export function normaliseWeights(w: StyleWeightsJson): StyleWeightsJson {
  const cleaned: StyleWeightsJson = {};
  for (const [k, v] of Object.entries(w)) {
    if (typeof v === 'number' && v >= 0 && Number.isFinite(v)) cleaned[k] = v;
  }
  const total = Object.values(cleaned).reduce((a, b) => a + b, 0);
  if (total <= 0) return cleaned;
  const out: StyleWeightsJson = {};
  for (const [k, v] of Object.entries(cleaned)) out[k] = v / total;
  return out;
}
