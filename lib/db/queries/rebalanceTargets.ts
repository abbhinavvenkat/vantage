import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { rebalanceTargets, type RebalanceMode } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type RebalanceTargetRow = typeof rebalanceTargets.$inferSelect;

export type UpsertTargetInput = {
  mode: RebalanceMode;
  key: string;
  targetPct: number;
};

export function listTargets(
  db: Db,
  portfolioId: string,
  mode?: RebalanceMode,
): RebalanceTargetRow[] {
  const conds = [eq(rebalanceTargets.portfolioId, portfolioId)];
  if (mode) conds.push(eq(rebalanceTargets.mode, mode));
  return db
    .select()
    .from(rebalanceTargets)
    .where(and(...conds))
    .orderBy(asc(rebalanceTargets.key))
    .all();
}

export function upsertTarget(
  db: Db,
  portfolioId: string,
  input: UpsertTargetInput,
): RebalanceTargetRow {
  const now = Date.now();
  const existing = db
    .select()
    .from(rebalanceTargets)
    .where(
      and(
        eq(rebalanceTargets.portfolioId, portfolioId),
        eq(rebalanceTargets.mode, input.mode),
        eq(rebalanceTargets.key, input.key),
      ),
    )
    .get();

  if (existing) {
    const updated = db
      .update(rebalanceTargets)
      .set({ targetPct: input.targetPct, updatedAt: now })
      .where(eq(rebalanceTargets.id, existing.id))
      .returning()
      .get();
    return updated;
  }
  const inserted = db
    .insert(rebalanceTargets)
    .values({
      portfolioId,
      mode: input.mode,
      key: input.key,
      targetPct: input.targetPct,
    })
    .returning()
    .get();
  return inserted;
}

export function removeTarget(db: Db, portfolioId: string, id: string): RebalanceTargetRow | null {
  const removed = db
    .delete(rebalanceTargets)
    .where(and(eq(rebalanceTargets.portfolioId, portfolioId), eq(rebalanceTargets.id, id)))
    .returning()
    .get();
  return removed ?? null;
}

export function removeTargetByKey(
  db: Db,
  portfolioId: string,
  mode: RebalanceMode,
  key: string,
): RebalanceTargetRow | null {
  const removed = db
    .delete(rebalanceTargets)
    .where(
      and(
        eq(rebalanceTargets.portfolioId, portfolioId),
        eq(rebalanceTargets.mode, mode),
        eq(rebalanceTargets.key, key),
      ),
    )
    .returning()
    .get();
  return removed ?? null;
}
