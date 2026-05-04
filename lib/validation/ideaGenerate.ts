import { z } from 'zod';

export const CONVICTION_LEVELS = ['high', 'medium', 'low'] as const;
export type ConvictionLevel = (typeof CONVICTION_LEVELS)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const ConvictionSchema = z.enum(CONVICTION_LEVELS);
export const RiskSchema = z.enum(RISK_LEVELS);

const symbolRegex = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

/** A `key_ratios` map: numeric scalar values keyed by ratio name. */
export const KeyRatiosSchema = z.record(z.string().min(1), z.number().finite()).default({});

export const EntryZonesSchema = z
  .object({
    fair: z.number().positive().finite().nullable().optional(),
    strong_buy: z.number().positive().finite().nullable().optional(),
  })
  .default({});

export const IdeaCandidateSchema = z.object({
  symbol: z
    .string()
    .min(1)
    .max(32)
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => symbolRegex.test(s), { message: 'invalid_symbol' }),
  name: z.string().min(1).max(200),
  thesis_md: z.string().min(1).max(20_000),
  key_ratios: KeyRatiosSchema.optional(),
  entry_zones: EntryZonesSchema.optional(),
  conviction: ConvictionSchema,
  risk: RiskSchema,
  matching_codex_rules: z.array(z.string().min(1)).default([]),
});

export const IdeaGenerateFile = z.object({
  portfolio_id: z.string().min(1),
  run_at: z.string().min(1),
  gaps_identified: z.array(z.string().min(1)).default([]),
  candidates: z.array(IdeaCandidateSchema).min(1),
});

export type IdeaCandidateT = z.infer<typeof IdeaCandidateSchema>;
export type IdeaGenerateFileT = z.infer<typeof IdeaGenerateFile>;
