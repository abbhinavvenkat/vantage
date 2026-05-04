import { z } from 'zod';

import { ALERT_RULE_TYPES } from '@/lib/db/schema';

const symbolRegex = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

export const AlertRuleTypeSchema = z.enum(ALERT_RULE_TYPES);

export const CreateAlertRuleBody = z.object({
  symbol: z
    .string()
    .min(1)
    .max(32)
    .transform((s) => s.trim().toUpperCase())
    .refine((s) => symbolRegex.test(s), { message: 'invalid_symbol' })
    .nullable(),
  ruleType: AlertRuleTypeSchema,
  threshold: z.number().finite().positive(),
  enabled: z.boolean().optional(),
});

export const ToggleAlertRuleBody = z.object({
  enabled: z.boolean(),
});

export type CreateAlertRuleInput = z.infer<typeof CreateAlertRuleBody>;
