import { z } from 'zod';

export const ChecklistExpectations = ['pass', 'fail', 'unknown'] as const;
export type ChecklistExpected = (typeof ChecklistExpectations)[number];

export const ChecklistItemSchema = z.object({
  item: z.string().min(1).max(500),
  expected: z.enum(ChecklistExpectations),
});

export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

export const UpsertThesisBody = z.object({
  thesisMd: z.string().max(20000).default(''),
  checklist: z.array(ChecklistItemSchema).max(50).default([]),
  entryDate: isoDate.nullable().optional(),
  targetReviewDate: isoDate.nullable().optional(),
});

export type UpsertThesisInput = z.infer<typeof UpsertThesisBody>;
