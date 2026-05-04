import { and, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { decisions, type DecisionPayload } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type DecisionRow = typeof decisions.$inferSelect;

export type DecisionAction = 'fresh_buy' | 'add' | 'hold' | 'trim_25' | 'trim_50' | 'exit';

export type InsertDecision = {
  portfolioId: string;
  symbol: string;
  action: DecisionAction;
  score: number;
  ruleLibraryVersion: string;
  payload: DecisionPayload;
};

export function insertDecisions(db: Db, rows: InsertDecision[]): number {
  if (rows.length === 0) return 0;
  const now = Date.now();
  db.transaction((tx) => {
    for (const r of rows) {
      tx.insert(decisions)
        .values({
          portfolioId: r.portfolioId,
          symbol: r.symbol,
          action: r.action,
          score: r.score,
          ruleLibraryVersion: r.ruleLibraryVersion,
          payloadJson: r.payload,
          snapshotAt: now,
        })
        .run();
    }
  });
  return rows.length;
}

/** Most-recent snapshot per symbol for a given portfolio. */
export function latestDecisionsByPortfolio(db: Db, portfolioId: string): DecisionRow[] {
  // Select rows whose snapshotAt equals the max for (portfolioId, symbol).
  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.portfolioId, portfolioId),
        sql`(${decisions.symbol}, ${decisions.snapshotAt}) in (
          select symbol, max(snapshot_at) from ${decisions}
          where portfolio_id = ${portfolioId}
          group by symbol
        )`,
      ),
    )
    .orderBy(decisions.symbol)
    .all();
}

/** Distinct snapshot_at values for the portfolio (for audit history). */
export function listDecisionSnapshots(
  db: Db,
  portfolioId: string,
): { snapshotAt: number; ruleLibraryVersion: string; n: number }[] {
  const rows = db
    .select({
      snapshotAt: decisions.snapshotAt,
      ruleLibraryVersion: decisions.ruleLibraryVersion,
      n: sql<number>`count(*)`,
    })
    .from(decisions)
    .where(eq(decisions.portfolioId, portfolioId))
    .groupBy(decisions.snapshotAt, decisions.ruleLibraryVersion)
    .orderBy(desc(decisions.snapshotAt))
    .all();
  return rows;
}

export function decisionsForSnapshot(
  db: Db,
  portfolioId: string,
  snapshotAt: number,
): DecisionRow[] {
  return db
    .select()
    .from(decisions)
    .where(and(eq(decisions.portfolioId, portfolioId), eq(decisions.snapshotAt, snapshotAt)))
    .orderBy(decisions.symbol)
    .all();
}

export function decisionsForVersion(db: Db, portfolioId: string, version: string): DecisionRow[] {
  // Latest snapshot per symbol restricted to a particular rule library version.
  return db
    .select()
    .from(decisions)
    .where(
      and(
        eq(decisions.portfolioId, portfolioId),
        eq(decisions.ruleLibraryVersion, version),
        sql`(${decisions.symbol}, ${decisions.snapshotAt}) in (
          select symbol, max(snapshot_at) from ${decisions}
          where portfolio_id = ${portfolioId} and rule_library_version = ${version}
          group by symbol
        )`,
      ),
    )
    .orderBy(decisions.symbol)
    .all();
}
