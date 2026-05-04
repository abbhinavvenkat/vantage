import { and, desc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import * as schema from '@/lib/db/schema';
import { theses, type ThesisChecklistItem } from '@/lib/db/schema';

type Db = BetterSQLite3Database<typeof schema>;

export type ThesisRow = typeof theses.$inferSelect;

export type UpsertThesisData = {
  thesisMd: string;
  checklist: ThesisChecklistItem[];
  entryDate?: string | null;
  targetReviewDate?: string | null;
};

const DEFAULT_REVIEW_WINDOW_DAYS = 90;

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function getThesis(db: Db, portfolioId: string, symbol: string): ThesisRow | null {
  const row = db
    .select()
    .from(theses)
    .where(and(eq(theses.portfolioId, portfolioId), eq(theses.symbol, symbol)))
    .get();
  return row ?? null;
}

export function listTheses(db: Db, portfolioId: string): ThesisRow[] {
  return db
    .select()
    .from(theses)
    .where(eq(theses.portfolioId, portfolioId))
    .orderBy(desc(theses.updatedAt))
    .all();
}

export function upsertThesis(
  db: Db,
  portfolioId: string,
  symbol: string,
  input: UpsertThesisData,
): ThesisRow {
  const now = Date.now();
  const existing = getThesis(db, portfolioId, symbol);

  const entryDate = input.entryDate ?? existing?.entryDate ?? null;
  let targetReviewDate = input.targetReviewDate ?? existing?.targetReviewDate ?? null;
  if (!targetReviewDate && entryDate) {
    targetReviewDate = addDaysISO(entryDate, DEFAULT_REVIEW_WINDOW_DAYS);
  }

  if (existing) {
    const updated = db
      .update(theses)
      .set({
        thesisMd: input.thesisMd,
        checklistJson: input.checklist,
        entryDate,
        targetReviewDate,
        updatedAt: now,
      })
      .where(and(eq(theses.portfolioId, portfolioId), eq(theses.symbol, symbol)))
      .returning()
      .get();
    return updated;
  }

  const inserted = db
    .insert(theses)
    .values({
      portfolioId,
      symbol,
      thesisMd: input.thesisMd,
      checklistJson: input.checklist,
      entryDate,
      targetReviewDate,
      lastReviewedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return inserted;
}

export function markReviewed(
  db: Db,
  portfolioId: string,
  symbol: string,
  reviewedAtISO: string,
): ThesisRow | null {
  const existing = getThesis(db, portfolioId, symbol);
  if (!existing) return null;
  const next = addDaysISO(reviewedAtISO, DEFAULT_REVIEW_WINDOW_DAYS);
  const updated = db
    .update(theses)
    .set({
      lastReviewedAt: reviewedAtISO,
      targetReviewDate: next,
      updatedAt: Date.now(),
    })
    .where(and(eq(theses.portfolioId, portfolioId), eq(theses.symbol, symbol)))
    .returning()
    .get();
  return updated ?? null;
}

export function reviewStatus(
  thesis: Pick<ThesisRow, 'targetReviewDate' | 'lastReviewedAt'>,
  todayISO: string,
): { status: 'up_to_date' | 'due_soon' | 'overdue' | 'unscheduled'; days: number | null } {
  const target = thesis.targetReviewDate;
  if (!target) return { status: 'unscheduled', days: null };
  const today = new Date(todayISO + 'T00:00:00Z').getTime();
  const due = new Date(target + 'T00:00:00Z').getTime();
  const days = Math.round((due - today) / (24 * 60 * 60 * 1000));
  if (days < 0) return { status: 'overdue', days };
  if (days <= 14) return { status: 'due_soon', days };
  return { status: 'up_to_date', days };
}
