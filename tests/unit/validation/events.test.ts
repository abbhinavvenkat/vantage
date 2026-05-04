import { describe, expect, it } from 'vitest';

import {
  CreateEventBody,
  EventsFileSchema,
  EVENT_TYPES,
  isValidEventSource,
  isValidEventType,
} from '@/lib/validation/events';

describe('event type validator', () => {
  it('accepts every canonical type', () => {
    for (const t of EVENT_TYPES) {
      expect(isValidEventType(t)).toBe(true);
    }
  });

  it('rejects garbage', () => {
    expect(isValidEventType('dividend')).toBe(false);
    expect(isValidEventType('EARNINGS')).toBe(false);
    expect(isValidEventType('')).toBe(false);
    expect(isValidEventType(null)).toBe(false);
    expect(isValidEventType(undefined)).toBe(false);
    expect(isValidEventType(42)).toBe(false);
  });

  it('isValidEventSource accepts manual|skill|file only', () => {
    expect(isValidEventSource('manual')).toBe(true);
    expect(isValidEventSource('skill')).toBe(true);
    expect(isValidEventSource('file')).toBe(true);
    expect(isValidEventSource('user')).toBe(false);
  });
});

describe('CreateEventBody', () => {
  it('parses + uppercases symbol', () => {
    const out = CreateEventBody.parse({
      symbol: 'acme-eq',
      eventType: 'earnings',
      eventDate: '2026-06-15',
      title: 'Q1 results',
    });
    expect(out.symbol).toBe('ACME-EQ');
    expect(out.eventType).toBe('earnings');
  });

  it('rejects invalid date', () => {
    const r = CreateEventBody.safeParse({
      symbol: 'ACME',
      eventType: 'earnings',
      eventDate: '06/15/2026',
      title: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects invalid eventType', () => {
    const r = CreateEventBody.safeParse({
      symbol: 'ACME',
      eventType: 'dividend',
      eventDate: '2026-06-15',
      title: 'x',
    });
    expect(r.success).toBe(false);
  });

  it('rejects empty title', () => {
    const r = CreateEventBody.safeParse({
      symbol: 'ACME',
      eventType: 'agm',
      eventDate: '2026-06-15',
      title: '',
    });
    expect(r.success).toBe(false);
  });
});

describe('EventsFileSchema', () => {
  it('parses a well-formed events file', () => {
    const out = EventsFileSchema.parse({
      events: [
        { eventType: 'earnings', eventDate: '2026-06-15', title: 'Q1 results' },
        { eventType: 'agm', eventDate: '2026-07-20', title: 'AGM', notes: 'virtual' },
      ],
    });
    expect(out.events).toHaveLength(2);
  });

  it('rejects missing events array', () => {
    expect(EventsFileSchema.safeParse({}).success).toBe(false);
  });
});
