import { z } from 'zod';

import { REBALANCE_MODES } from '@/lib/db/schema';

const symbolRegex = /^[A-Z0-9][A-Z0-9._&-]{0,63}$/;
const sectorRegex = /^[A-Za-z0-9 &/_-]{1,64}$/;

export const RebalanceModeSchema = z.enum(REBALANCE_MODES);

export const UpsertRebalanceTargetBody = z
  .object({
    mode: RebalanceModeSchema,
    key: z
      .string()
      .min(1)
      .max(64)
      .transform((s) => s.trim()),
    targetPct: z.number().finite().min(0).max(100),
  })
  .superRefine((val, ctx) => {
    if (val.mode === 'symbol') {
      const upper = val.key.toUpperCase();
      if (!symbolRegex.test(upper)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_symbol', path: ['key'] });
      }
    } else if (val.mode === 'sector') {
      if (!sectorRegex.test(val.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'invalid_sector', path: ['key'] });
      }
    }
  })
  .transform((val) => ({
    ...val,
    key: val.mode === 'symbol' ? val.key.toUpperCase() : val.key,
  }));

export type UpsertRebalanceTargetInput = z.infer<typeof UpsertRebalanceTargetBody>;
