import { z } from 'zod';

export const CONVICTIONS = ['high', 'medium', 'low'] as const;
export type Conviction = (typeof CONVICTIONS)[number];

export function isValidConviction(value: unknown): value is Conviction {
  return typeof value === 'string' && (CONVICTIONS as readonly string[]).includes(value);
}

const symbolRegex = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

export const ConvictionSchema = z.enum(CONVICTIONS);

export const CreateWatchlistBody = z.object({
  symbol: z
    .string()
    .min(1)
    .max(32)
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => symbolRegex.test(s), { message: 'invalid_symbol' }),
  thesis: z.string().max(4000).nullable().optional(),
  targetBuyPrice: z.number().positive().finite().nullable().optional(),
  targetSellPrice: z.number().positive().finite().nullable().optional(),
  conviction: ConvictionSchema.optional(),
});

export const UpdateWatchlistBody = z
  .object({
    thesis: z.string().max(4000).nullable().optional(),
    targetBuyPrice: z.number().positive().finite().nullable().optional(),
    targetSellPrice: z.number().positive().finite().nullable().optional(),
    conviction: ConvictionSchema.optional(),
  })
  .refine(
    (v) =>
      v.thesis !== undefined ||
      v.targetBuyPrice !== undefined ||
      v.targetSellPrice !== undefined ||
      v.conviction !== undefined,
    { message: 'empty_update' },
  );

export type CreateWatchlistInput = z.infer<typeof CreateWatchlistBody>;
export type UpdateWatchlistInput = z.infer<typeof UpdateWatchlistBody>;
