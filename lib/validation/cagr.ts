import { z } from 'zod';

export const BuildCagrPlanBody = z.object({
  targetCagrPct: z.number().finite().min(5).max(50),
  horizonYears: z.number().int().min(1).max(30),
});

export type BuildCagrPlanBodyT = z.infer<typeof BuildCagrPlanBody>;
