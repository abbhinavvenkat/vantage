import { z } from 'zod';

const symbolRegex = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;

export const NewsSymbolSchema = z
  .string()
  .min(1)
  .max(32)
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => symbolRegex.test(s), { message: 'invalid_symbol' });

/**
 * One news item produced by the news-fetch skill (Google News RSS or similar).
 */
export const NewsItemSchema = z.object({
  title: z.string().min(1).max(500),
  url: z.string().url().max(2000),
  publishedAt: z.string().min(1).max(64),
  source: z.string().min(1).max(200),
});

export type NewsItem = z.infer<typeof NewsItemSchema>;

/**
 * Per-symbol JSON file at `data/news/<SYMBOL>.json`.
 */
export const NewsFileSchema = z.object({
  items: z.array(NewsItemSchema),
});

export type NewsFile = z.infer<typeof NewsFileSchema>;

export const PatchNewsBody = z
  .object({
    isRead: z.boolean().optional(),
  })
  .refine((v) => v.isRead !== undefined, { message: 'empty_update' });

export type PatchNewsInput = z.infer<typeof PatchNewsBody>;
