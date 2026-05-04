import { z } from 'zod';

import { FILING_TRIAGES, FILING_TYPES } from '@/lib/db/schema';

export const FilingTypeSchema = z.enum(FILING_TYPES);
export const FilingTriageSchema = z.enum(FILING_TRIAGES);

export function isValidFilingTriage(value: unknown): boolean {
  return typeof value === 'string' && (FILING_TRIAGES as readonly string[]).includes(value);
}

export function isValidFilingType(value: unknown): boolean {
  return typeof value === 'string' && (FILING_TYPES as readonly string[]).includes(value);
}

/**
 * Maps the skill's freeform filing-type strings (per
 * `.claude/rules/research-output-schema.md` filings-triage section, which lists
 * "type" loosely) onto our DB enum.  Unknown types fall through to `other`.
 */
export function normalizeFilingType(input: unknown): (typeof FILING_TYPES)[number] {
  if (typeof input !== 'string') return 'other';
  const v = input
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if ((FILING_TYPES as readonly string[]).includes(v)) {
    return v as (typeof FILING_TYPES)[number];
  }
  if (v.includes('annual')) return 'annual_report';
  if (v.includes('quarter') || /(^|_)q\d?(_|$)/.test(v) || v.includes('results')) {
    return 'quarterly_results';
  }
  if (v.includes('presentation') || v.includes('investor_pres')) return 'investor_presentation';
  if (v.includes('announcement') || v.includes('press') || v.includes('release')) {
    return 'announcement';
  }
  return 'other';
}

/** Triage tag emitted by the filings-triage skill. */
export const FilingsTriageItem = z.object({
  url: z.string().url(),
  title: z.string().min(1),
  type: z.string().optional(),
  triage: FilingTriageSchema.optional(),
  summary_one_line: z.string().nullable().optional(),
  rationale: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
});

export const FilingsTriageBatch = z.object({
  symbol: z.string().min(1),
  batch_id: z.string().min(1),
  scanned_at: z.string().optional(),
  filings: z.array(FilingsTriageItem),
});

export type FilingsTriageBatchT = z.infer<typeof FilingsTriageBatch>;

export const PatchFilingBody = z
  .object({
    isRead: z.boolean().optional(),
  })
  .refine((v) => v.isRead !== undefined, { message: 'empty_update' });

export type PatchFilingInput = z.infer<typeof PatchFilingBody>;
