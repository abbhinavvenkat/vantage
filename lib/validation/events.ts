import { z } from 'zod';

import { EVENT_SOURCES, EVENT_TYPES, type EventSource, type EventType } from '@/lib/db/schema';

export { EVENT_TYPES, EVENT_SOURCES };
export type { EventType, EventSource };

export const EVENT_TYPE_LABEL: Record<EventType, string> = {
  earnings: 'Earnings',
  agm: 'AGM',
  ex_div: 'Ex-Dividend',
  record_date: 'Record Date',
  other: 'Other',
};

export function isValidEventType(value: unknown): value is EventType {
  return typeof value === 'string' && (EVENT_TYPES as readonly string[]).includes(value);
}

export function isValidEventSource(value: unknown): value is EventSource {
  return typeof value === 'string' && (EVENT_SOURCES as readonly string[]).includes(value);
}

const symbolRegex = /^[A-Z0-9][A-Z0-9._-]{0,31}$/;
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const EventTypeSchema = z.enum(EVENT_TYPES);
export const EventSourceSchema = z.enum(EVENT_SOURCES);

export const SymbolSchema = z
  .string()
  .min(1)
  .max(32)
  .transform((s) => s.trim().toUpperCase())
  .refine((s) => symbolRegex.test(s), { message: 'invalid_symbol' });

export const EventDateSchema = z
  .string()
  .min(10)
  .max(10)
  .refine((s) => dateRegex.test(s), { message: 'invalid_date' });

export const CreateEventBody = z.object({
  symbol: SymbolSchema,
  eventType: EventTypeSchema,
  eventDate: EventDateSchema,
  title: z.string().min(1).max(200),
  notes: z.string().max(4000).nullable().optional(),
});

export type CreateEventInput = z.infer<typeof CreateEventBody>;

// JSON file import schema: { events: [{ eventType, eventDate, title, notes? }] }
export const EventsFileSchema = z.object({
  events: z.array(
    z.object({
      eventType: EventTypeSchema,
      eventDate: EventDateSchema,
      title: z.string().min(1).max(200),
      notes: z.string().max(4000).nullable().optional(),
    }),
  ),
});

export type EventsFile = z.infer<typeof EventsFileSchema>;
